import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  type AuthenticatedRequest,
  buildAuthSessionState,
  isEnterpriseAuthConfigured,
  parseConfiguredEnterpriseUsers,
  requireWorkspaceAccess,
  resolveActorFromRequest,
  signEnterpriseToken,
  verifyPasswordScrypt,
} from './auth.ts';
import {
  type AwsConnectorClients,
  COMMON_AWS_REGIONS,
  buildIamPermissionsPolicyJson,
  buildIamTrustPolicyJson,
  createDefaultAwsConnectorClients,
  testAwsAcmConnection,
  validateAwsConnectionConfig,
} from './aws-acm.ts';
import {
  MAX_UPLOAD_BYTES,
  containsArbitraryUrl,
  detectImportFormat,
  parseStructuredMetadataImport,
  parseX509CertificatePayload,
} from './crypto-parser.ts';
import { buildCsvDocument } from './csv-utils.ts';
import {
  LIVE_WORKSPACE_ID,
  SAMPLE_WORKSPACE_ID,
  buildSampleCsvFixture,
  sampleAssetTemplateCsv,
} from './seed-data.ts';
import { type EcdatStore, generateExternalId } from './store.ts';
import {
  DataSourceSyncService,
  SyncConflictError,
  getSchedulerStatus,
} from './sync-service.ts';
import type {
  DataSourcesSummary,
  ImportPreviewResult,
  OverviewStats,
  ParsedCandidateAsset,
  Role,
} from '../shared/types.ts';

const LoginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(200),
});

const ImportPayloadSchema = z.object({
  filename: z.string().min(1, 'Filename is required').max(180),
  format: z.enum(['csv', 'json', 'pem', 'der']).optional(),
  content: z.string().min(1, 'File content is empty'),
  defaults: z
    .object({
      environment: z.string().max(40).optional(),
      location: z.string().max(255).optional(),
      owner: z.string().max(160).optional(),
    })
    .optional(),
});

const RemediationPatchSchema = z.object({
  status: z.enum(['Open', 'In progress', 'Resolved', 'Accepted risk']).optional(),
  assignee: z.string().max(160).nullable().optional(),
  dueDate: z.string().max(64).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  acceptedReason: z.string().max(2000).nullable().optional(),
  acceptedReviewDate: z.string().max(64).nullable().optional(),
});

const SettingsPatchSchema = z.object({
  expiryWarningDays: z.number().int().min(1).max(365),
  minRsaKeyBits: z.number().int().min(1024).max(4096),
});

const MemberUpsertSchema = z.object({
  email: z.string().email().max(160),
  name: z.string().min(1).max(160),
  role: z.enum(['Admin', 'Analyst', 'Viewer']),
});

const DataSourceTestSchema = z.object({
  sourceId: z.string().max(120).optional(),
  authMode: z.enum(['workload_identity', 'sts_assume_role']),
  awsAccountId: z.string().max(20).nullable().optional(),
  roleArn: z.string().max(256).nullable().optional(),
  externalId: z.string().max(128).nullable().optional(),
  regions: z.array(z.string().min(2).max(40)).min(1).max(25),
});

const DataSourceCreateSchema = z.object({
  provider: z.literal('aws_acm').default('aws_acm'),
  name: z.string().min(2, 'Source name is required').max(120),
  authMode: z.enum(['workload_identity', 'sts_assume_role']),
  awsAccountId: z.string().max(20).nullable().optional(),
  roleArn: z.string().max(256).nullable().optional(),
  externalId: z.string().max(128).nullable().optional(),
  regions: z.array(z.string().min(2).max(40)).min(1).max(25),
  environmentDefault: z
    .enum(['production', 'staging', 'development', 'unknown'])
    .default('production'),
});

const DataSourcePatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  authMode: z.enum(['workload_identity', 'sts_assume_role']).optional(),
  awsAccountId: z.string().max(20).nullable().optional(),
  roleArn: z.string().max(256).nullable().optional(),
  externalId: z.string().max(128).nullable().optional(),
  regions: z.array(z.string().min(2).max(40)).min(1).max(25).optional(),
  environmentDefault: z
    .enum(['production', 'staging', 'development', 'unknown'])
    .optional(),
});

function parseImportContent(input: z.infer<typeof ImportPayloadSchema>): {
  format: 'csv' | 'json' | 'pem' | 'der';
  candidates: ParsedCandidateAsset[];
  errors: Array<{ rowNumber: number; field: string; message: string }>;
} {
  if (Buffer.byteLength(input.content, 'utf8') > MAX_UPLOAD_BYTES) {
    throw new Error(`Payload exceeds maximum upload limit of ${MAX_UPLOAD_BYTES / 1024} KB.`);
  }
  const format = detectImportFormat(input.filename, input.format);
  if (!format) {
    throw new Error(
      'Unsupported file type. Accepted formats: .csv, .json, .pem, .crt, .der, .cer.'
    );
  }
  if (format === 'csv' || format === 'json') {
    const parsed = parseStructuredMetadataImport(format, input.content);
    return { format, ...parsed };
  }
  const parsed = parseX509CertificatePayload(
    input.content,
    format,
    input.filename,
    input.defaults
  );
  return { format, ...parsed };
}

function normalizeAlgFamily(alg: string): string {
  const upper = alg.toUpperCase();
  if (upper.startsWith('ECDSA')) return 'ECDSA';
  if (upper.startsWith('RSA')) return 'RSA';
  if (upper.startsWith('ED25519') || upper.startsWith('ED448')) return 'EdDSA';
  if (upper.startsWith('DSA')) return 'DSA';
  return alg || 'Unknown';
}

function buildDataSourcesSummary(store: EcdatStore, workspaceId: string): DataSourcesSummary {
  const sources = store.listDataSources(workspaceId);
  const scheduler = getSchedulerStatus();
  if (sources.length === 0) {
    return {
      totalSources: 0,
      connectedCount: 0,
      syncingCount: 0,
      failedCount: 0,
      setupRequiredCount: 0,
      primarySourceId: null,
      primarySourceName: null,
      primaryStatus: 'unconfigured',
      lastSuccessfulSyncAt: null,
      lastSyncFinishedAt: null,
      lastSyncError: null,
      isStale: false,
      scheduler,
    };
  }

  const connectedCount = sources.filter((s) => s.status === 'connected').length;
  const syncingCount = sources.filter((s) => s.status === 'syncing').length;
  const failedCount = sources.filter((s) => s.status === 'failed').length;
  const setupRequiredCount = sources.filter((s) => s.status === 'setup_required').length;

  const primary =
    sources.find((s) => s.status === 'syncing') ??
    sources.find((s) => s.status === 'failed') ??
    sources[0];

  const primaryStatus =
    syncingCount > 0
      ? 'syncing'
      : failedCount > 0
        ? 'failed'
        : connectedCount > 0
          ? 'connected'
          : 'setup_required';

  const latestSuccess = sources
    .map((s) => s.lastSuccessfulSyncAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop() ?? null;

  const latestFinish = sources
    .map((s) => s.lastSyncFinishedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop() ?? null;

  return {
    totalSources: sources.length,
    connectedCount,
    syncingCount,
    failedCount,
    setupRequiredCount,
    primarySourceId: primary.id,
    primarySourceName: primary.name,
    primaryStatus,
    lastSuccessfulSyncAt: latestSuccess,
    lastSyncFinishedAt: latestFinish,
    lastSyncError: primary.lastSyncError,
    isStale: failedCount > 0,
    scheduler,
  };
}

function constantTimeMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ApiRouterOptions {
  syncService?: DataSourceSyncService;
  awsClientsFactory?: (region: string) => AwsConnectorClients;
}

export function createApiRouter(
  store: EcdatStore,
  options: ApiRouterOptions = {}
): express.Router {
  const awsClientsFactory =
    options.awsClientsFactory ?? ((region: string) => createDefaultAwsConnectorClients(region));
  const syncService =
    options.syncService ?? new DataSourceSyncService(store, awsClientsFactory);

  const router = express.Router();
  router.use(express.json({ limit: '768kb' }));

  // Malformed JSON error handler
  router.use((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Invalid JSON request body.' });
      return;
    }
    next(err);
  });

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      storageMode: store.mode,
      scheduler: getSchedulerStatus(),
    });
  });

  // Protected scheduler trigger for Cloud Scheduler / cron
  router.post('/internal/scheduled-sync', async (req: Request, res: Response) => {
    const secret = process.env.ECDAT_SCHEDULER_SECRET?.trim();
    if (!secret || secret.length < 16) {
      res.status(503).json({
        error:
          'Scheduled sync endpoint is disabled until ECDAT_SCHEDULER_SECRET (16+ chars) is configured on the server.',
      });
      return;
    }

    const authHeader = req.headers.authorization;
    const headerSecret = req.headers['x-ecdat-scheduler-secret'];
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : typeof headerSecret === 'string'
          ? headerSecret.trim()
          : '';

    if (!token || !constantTimeMatch(token, secret)) {
      res.status(401).json({ error: 'Unauthorized scheduler request.' });
      return;
    }

    const summary = await syncService.runScheduledSyncAll('cloud-scheduler@ecdat.system');
    res.json(summary);
  });

  router.get('/auth/status', (req: Request, res: Response) => {
    const actor = resolveActorFromRequest(req);
    res.json(buildAuthSessionState(store, actor));
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    if (!isEnterpriseAuthConfigured()) {
      res.status(403).json({
        error:
          'Enterprise authentication is not configured. Set ECDAT_ENTERPRISE_AUTH_SECRET and ECDAT_ENTERPRISE_USERS_JSON to enable enterprise sign-in.',
      });
      return;
    }

    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credentials format.' });
      return;
    }

    const users = parseConfiguredEnterpriseUsers();
    const user = users.find(
      (u) => u.email.toLowerCase() === parsed.data.email.trim().toLowerCase()
    );
    if (!user || !verifyPasswordScrypt(parsed.data.password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const nowIso = new Date().toISOString();
    for (const [wsId, role] of Object.entries(user.workspaces)) {
      if (wsId === SAMPLE_WORKSPACE_ID) continue;
      store.ensureEnterpriseWorkspace(
        {
          id: wsId,
          name:
            wsId === LIVE_WORKSPACE_ID
              ? 'Live Production Workspace'
              : wsId === 'ws-ent-prod'
                ? 'Enterprise Production PKI'
                : `Workspace ${wsId}`,
          slug: wsId,
          isSample: false,
          settings: { expiryWarningDays: 30, minRsaKeyBits: 2048 },
          createdAt: nowIso,
        },
        [
          {
            id: `mem-${wsId}-${user.email}`,
            workspaceId: wsId,
            email: user.email,
            name: user.name,
            role,
            createdAt: nowIso,
          },
        ]
      );
    }

    const token = signEnterpriseToken({
      sub: user.email,
      name: user.name,
      roles: user.workspaces,
    });
    const session = buildAuthSessionState(store, {
      authenticated: true,
      email: user.email,
      name: user.name,
      isSampleDemo: false,
      workspaceRoles: user.workspaces,
    });

    res.json({ token, session });
  });

  router.post('/auth/logout', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.get('/sample-fixtures/sample-inventory.csv', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sample-inventory.csv"');
    res.send(buildSampleCsvFixture());
  });

  router.get('/sample-fixtures/sample-cert.pem', (_req: Request, res: Response) => {
    const fixturePath = path.resolve(process.cwd(), 'fixtures', 'sample-public-cert.pem');
    if (!fs.existsSync(fixturePath)) {
      res.status(404).json({ error: 'Sample public certificate fixture not found.' });
      return;
    }
    const pem = fs.readFileSync(fixturePath, 'utf8');
    res.setHeader('Content-Type', 'application/x-pem-file; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sample-public-cert.pem"');
    res.send(pem);
  });

  router.get(
    '/workspaces/:wsId/overview',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const wsId = req.params.wsId;
      const ws = store.getWorkspace(wsId);
      if (!ws) {
        res.status(404).json({ error: 'Workspace not found.' });
        return;
      }

      const assets = store.listAllAssets(wsId);
      const findings = store.listAllFindings(wsId);
      const imports = store.listImports(wsId);
      const recentSyncRuns = store.listSyncRuns(wsId, undefined, 5);
      const dataSourcesSummary = buildDataSourcesSummary(store, wsId);

      const nowMs = Date.now();
      const warnMs = nowMs + ws.settings.expiryWarningDays * 24 * 60 * 60 * 1000;

      let expiredCount = 0;
      let expiringSoonCount = 0;
      let bucket7 = 0;
      let bucket30 = 0;
      let bucket90 = 0;
      let bucketLater = 0;
      let bucketUnknown = 0;

      const algMap = new Map<string, number>();

      for (const a of assets) {
        const algFamily = normalizeAlgFamily(a.algorithm);
        algMap.set(algFamily, (algMap.get(algFamily) ?? 0) + 1);

        if (!a.validTo) {
          bucketUnknown += 1;
          continue;
        }
        const ms = Date.parse(a.validTo);
        if (Number.isNaN(ms)) {
          bucketUnknown += 1;
          continue;
        }
        const days = Math.ceil((ms - nowMs) / (1000 * 60 * 60 * 24));
        if (ms < nowMs) {
          expiredCount += 1;
        } else {
          if (ms <= warnMs) {
            expiringSoonCount += 1;
          }
          if (days <= 7) bucket7 += 1;
          else if (days <= 30) bucket30 += 1;
          else if (days <= 90) bucket90 += 1;
          else bucketLater += 1;
        }
      }

      const openFindings = findings.filter(
        (f) => f.status === 'Open' || f.status === 'In progress'
      );
      const openHighFindings = openFindings.filter((f) => f.severity === 'High');

      const totalAssets = assets.length;
      const algorithmDistribution = Array.from(algMap.entries())
        .map(([algorithm, count]) => ({
          algorithm,
          count,
          percentage: totalAssets > 0 ? Math.round((count / totalAssets) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);

      const previewFinding =
        openFindings.find((f) => f.ruleId === 'EXPIRING_SOON') ??
        openHighFindings[0] ??
        findings[0] ??
        null;
      const previewAsset = previewFinding
        ? assets.find((a) => a.id === previewFinding.assetId) ?? assets[0] ?? null
        : assets[0] ?? null;

      const overview: OverviewStats = {
        totalAssets,
        expiringSoonCount,
        expiredCount,
        openHighFindingsCount: openHighFindings.length,
        openFindingsCount: openFindings.length,
        expiryTimeline: [
          { bucket: 'expired', label: 'Expired', count: expiredCount, filterKey: 'expired' },
          { bucket: '0_7d', label: '0–7 days', count: bucket7, filterKey: 'expiring_30' },
          { bucket: '8_30d', label: '8–30 days', count: bucket30, filterKey: 'expiring_30' },
          { bucket: '31_90d', label: '31–90 days', count: bucket90, filterKey: 'valid' },
          { bucket: '90d_plus', label: '90+ days', count: bucketLater, filterKey: 'valid' },
          { bucket: 'unknown', label: 'Unknown', count: bucketUnknown, filterKey: 'unknown' },
        ],
        algorithmDistribution,
        recentFindings: findings.slice(0, 5),
        recentImports: imports.slice(0, 4),
        recentSyncRuns,
        dataSourcesSummary,
        samplePreviewAsset: previewAsset
          ? { asset: previewAsset, topFinding: previewFinding }
          : null,
      };

      res.json(overview);
    }
  );

  // ==================== DATA SOURCES (AWS ACM) ====================

  router.get(
    '/workspaces/:wsId/data-sources',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const wsId = req.params.wsId;
      const ws = store.getWorkspace(wsId)!;
      const items = store.listDataSources(wsId);
      const recentRuns = store.listSyncRuns(wsId, undefined, 25);
      const trustedPrincipalArn =
        process.env.ECDAT_AWS_TRUSTED_PRINCIPAL_ARN?.trim() || null;
      const suggestedExternalId = generateExternalId();

      res.json({
        workspace: ws,
        items,
        recentRuns,
        scheduler: getSchedulerStatus(),
        supportedRegions: COMMON_AWS_REGIONS,
        trustedPrincipalArn,
        suggestedExternalId,
        iamPermissionsPolicy: buildIamPermissionsPolicyJson(),
        sampleTrustPolicy: buildIamTrustPolicyJson(
          trustedPrincipalArn ?? '',
          suggestedExternalId
        ),
        currentRole: req.ecdatWorkspaceRole ?? 'Viewer',
      });
    }
  );

  router.post(
    '/workspaces/:wsId/data-sources/test',
    requireWorkspaceAccess(store, 'Admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      if (ws.isSample) {
        res.status(400).json({
          error:
            'Live AWS ACM connectors must be tested and configured inside a Live Enterprise Workspace, not the fictional Sample Workspace.',
        });
        return;
      }

      const parsed = DataSourceTestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid AWS connector test payload.',
        });
        return;
      }

      const d = parsed.data;
      let externalId = d.externalId ?? null;
      if (d.sourceId) {
        const existing = store.getDataSource(ws.id, d.sourceId);
        if (existing && !externalId) {
          externalId = existing.externalId;
        }
      }

      const clients = awsClientsFactory(d.regions[0] || 'us-east-1');
      const result = await testAwsAcmConnection(
        {
          authMode: d.authMode,
          awsAccountId: d.awsAccountId ?? null,
          roleArn: d.roleArn ?? null,
          externalId,
          regions: d.regions,
        },
        clients
      );

      if (d.sourceId) {
        store.recordAuditEvent({
          workspaceId: ws.id,
          actorEmail: req.ecdatActor!.email,
          actorRole: req.ecdatWorkspaceRole ?? 'Admin',
          eventType: 'data_source_tested',
          targetType: 'data_source',
          targetId: d.sourceId,
          summary: `Connection test ${result.ok ? 'succeeded' : 'failed'}: ${result.message}`,
          detailsJson: JSON.stringify(result),
          createdAt: new Date().toISOString(),
        });
      }

      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    }
  );

  router.post(
    '/workspaces/:wsId/data-sources',
    requireWorkspaceAccess(store, 'Admin'),
    async (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      if (ws.isSample) {
        res.status(400).json({
          error:
            'Live AWS ACM connectors cannot be attached to the fictional Sample Workspace. Switch to a Live Enterprise Workspace.',
        });
        return;
      }

      const parsed = DataSourceCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid data source configuration.',
        });
        return;
      }

      const d = parsed.data;
      const externalId =
        d.authMode === 'sts_assume_role'
          ? d.externalId?.trim() || generateExternalId()
          : null;

      const validationErr = validateAwsConnectionConfig({
        authMode: d.authMode,
        awsAccountId: d.awsAccountId ?? null,
        roleArn: d.roleArn ?? null,
        externalId,
        regions: d.regions,
      });
      if (validationErr) {
        res.status(400).json({ error: validationErr });
        return;
      }

      const clients = awsClientsFactory(d.regions[0] || 'us-east-1');
      const testResult = await testAwsAcmConnection(
        {
          authMode: d.authMode,
          awsAccountId: d.awsAccountId ?? null,
          roleArn: d.roleArn ?? null,
          externalId,
          regions: d.regions,
        },
        clients
      );

      if (!testResult.ok) {
        res.status(400).json({
          error: testResult.message,
          testResult,
        });
        return;
      }

      const source = store.createDataSource({
        workspaceId: ws.id,
        provider: d.provider,
        name: d.name.trim(),
        authMode: d.authMode,
        awsAccountId: testResult.resolvedAccountId ?? d.awsAccountId ?? null,
        roleArn: d.roleArn?.trim() || null,
        externalId,
        regions: d.regions,
        environmentDefault: d.environmentDefault,
        status: 'connected',
        actorEmail: req.ecdatActor!.email,
        actorRole: req.ecdatWorkspaceRole ?? 'Admin',
      });

      const syncOutcome = await syncService.syncDataSource({
        workspaceId: ws.id,
        sourceId: source.id,
        trigger: 'initial',
        actorEmail: req.ecdatActor!.email,
        actorRole: req.ecdatWorkspaceRole ?? 'Admin',
      });

      res.status(201).json({
        dataSource: syncOutcome.source,
        syncRun: syncOutcome.run,
        testResult,
      });
    }
  );

  router.patch(
    '/workspaces/:wsId/data-sources/:sourceId',
    requireWorkspaceAccess(store, 'Admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      const existing = store.getDataSource(ws.id, req.params.sourceId);
      if (!existing) {
        res.status(404).json({ error: 'Data source not found in workspace.' });
        return;
      }
      if (syncService.isSyncRunning(existing.id)) {
        res.status(409).json({
          error: 'Cannot modify data source while a sync job is actively running.',
        });
        return;
      }

      const parsed = DataSourcePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid data source update.',
        });
        return;
      }

      const d = parsed.data;
      const nextAuthMode = d.authMode ?? existing.authMode;
      const nextRoleArn = d.roleArn !== undefined ? d.roleArn : existing.roleArn;
      const nextExternalId =
        nextAuthMode === 'sts_assume_role'
          ? d.externalId?.trim() || existing.externalId || generateExternalId()
          : null;
      const nextRegions = d.regions ?? existing.regions;
      const nextAccountId =
        d.awsAccountId !== undefined ? d.awsAccountId : existing.awsAccountId;

      const validationErr = validateAwsConnectionConfig({
        authMode: nextAuthMode,
        awsAccountId: nextAccountId,
        roleArn: nextRoleArn,
        externalId: nextExternalId,
        regions: nextRegions,
      });
      if (validationErr) {
        res.status(400).json({ error: validationErr });
        return;
      }

      const updated = store.updateDataSource({
        workspaceId: ws.id,
        sourceId: existing.id,
        name: d.name?.trim(),
        authMode: nextAuthMode,
        awsAccountId: nextAccountId,
        roleArn: nextRoleArn,
        externalId: nextExternalId,
        regions: nextRegions,
        environmentDefault: d.environmentDefault,
        actorEmail: req.ecdatActor!.email,
        actorRole: req.ecdatWorkspaceRole ?? 'Admin',
      });

      res.json({ dataSource: updated });
    }
  );

  router.delete(
    '/workspaces/:wsId/data-sources/:sourceId',
    requireWorkspaceAccess(store, 'Admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      const existing = store.getDataSource(ws.id, req.params.sourceId);
      if (!existing) {
        res.status(404).json({ error: 'Data source not found in workspace.' });
        return;
      }
      if (syncService.isSyncRunning(existing.id)) {
        res.status(409).json({
          error: 'Cannot remove data source while a sync job is actively running.',
        });
        return;
      }

      store.deleteDataSource(
        ws.id,
        existing.id,
        req.ecdatActor!.email,
        req.ecdatWorkspaceRole ?? 'Admin'
      );
      res.json({ ok: true });
    }
  );

  router.post(
    '/workspaces/:wsId/data-sources/:sourceId/sync',
    requireWorkspaceAccess(store, 'Analyst'),
    async (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      if (ws.isSample) {
        res.status(400).json({
          error: 'Sample Workspace uses fictional local records rather than live AWS syncs.',
        });
        return;
      }
      const existing = store.getDataSource(ws.id, req.params.sourceId);
      if (!existing) {
        res.status(404).json({ error: 'Data source not found in workspace.' });
        return;
      }

      try {
        const outcome = await syncService.syncDataSource({
          workspaceId: ws.id,
          sourceId: existing.id,
          trigger: 'manual',
          actorEmail: req.ecdatActor!.email,
          actorRole: req.ecdatWorkspaceRole ?? 'Analyst',
        });
        res.json({
          dataSource: outcome.source,
          syncRun: outcome.run,
        });
      } catch (err) {
        if (err instanceof SyncConflictError) {
          res.status(409).json({ error: err.message });
          return;
        }
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to execute sync.',
        });
      }
    }
  );

  router.get(
    '/workspaces/:wsId/data-sources/:sourceId/runs',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const wsId = req.params.wsId;
      const existing = store.getDataSource(wsId, req.params.sourceId);
      if (!existing) {
        res.status(404).json({ error: 'Data source not found in workspace.' });
        return;
      }
      res.json({ items: store.listSyncRuns(wsId, existing.id, 30) });
    }
  );

  // ==================== ASSETS & IMPORTS ====================

  router.get(
    '/workspaces/:wsId/assets',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const wsId = req.params.wsId;
      const q = req.query;
      const result = store.queryAssets(wsId, {
        search: typeof q.search === 'string' ? q.search : undefined,
        environment: typeof q.environment === 'string' ? q.environment : undefined,
        assetType: typeof q.assetType === 'string' ? q.assetType : undefined,
        algorithm: typeof q.algorithm === 'string' ? q.algorithm : undefined,
        expiration: (typeof q.expiration === 'string'
          ? q.expiration
          : 'all') as 'all' | 'expired' | 'expiring_30' | 'valid' | 'unknown',
        owner: typeof q.owner === 'string' ? q.owner : undefined,
        sourceId: typeof q.sourceId === 'string' ? q.sourceId : undefined,
        sortBy: (typeof q.sortBy === 'string' ? q.sortBy : 'validTo') as
          | 'name'
          | 'validTo'
          | 'algorithm'
          | 'environment'
          | 'updatedAt',
        sortDir: q.sortDir === 'desc' ? 'desc' : 'asc',
        page: q.page ? Math.max(1, Number(q.page) || 1) : 1,
        pageSize: q.pageSize ? Math.min(100, Math.max(1, Number(q.pageSize) || 15)) : 15,
      });
      res.json(result);
    }
  );

  router.get(
    '/workspaces/:wsId/assets/:assetId',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const detail = store.getAssetById(req.params.wsId, req.params.assetId);
      if (!detail) {
        res.status(404).json({ error: 'Asset not found in workspace.' });
        return;
      }
      res.json(detail);
    }
  );

  router.get(
    '/workspaces/:wsId/imports/template.csv',
    requireWorkspaceAccess(store, 'Viewer'),
    (_req: AuthenticatedRequest, res: Response) => {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="ecdat-inventory-template.csv"'
      );
      res.send(sampleAssetTemplateCsv());
    }
  );

  router.get(
    '/workspaces/:wsId/imports',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      res.json({ items: store.listImports(req.params.wsId) });
    }
  );

  router.post(
    '/workspaces/:wsId/imports/preview',
    requireWorkspaceAccess(store, 'Analyst'),
    (req: AuthenticatedRequest, res: Response) => {
      const validated = ImportPayloadSchema.safeParse(req.body);
      if (!validated.success) {
        res.status(400).json({
          error: validated.error.issues[0]?.message || 'Invalid import payload.',
        });
        return;
      }

      try {
        const { format, candidates, errors } = parseImportContent(validated.data);
        const previewItems = store.previewImport(req.params.wsId, candidates);

        const result: ImportPreviewResult = {
          filename: validated.data.filename,
          format,
          totalRows: candidates.length + errors.length,
          insertedCount: previewItems.filter((i) => i.action === 'insert').length,
          updatedCount: previewItems.filter((i) => i.action === 'update').length,
          skippedCount: previewItems.filter((i) => i.action === 'skip').length,
          rejectedCount: errors.length,
          items: previewItems,
          errors,
        };
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to parse import file.',
        });
      }
    }
  );

  router.post(
    '/workspaces/:wsId/imports/confirm',
    requireWorkspaceAccess(store, 'Analyst'),
    (req: AuthenticatedRequest, res: Response) => {
      const validated = ImportPayloadSchema.safeParse(req.body);
      if (!validated.success) {
        res.status(400).json({
          error: validated.error.issues[0]?.message || 'Invalid import payload.',
        });
        return;
      }

      try {
        const { format, candidates, errors } = parseImportContent(validated.data);
        if (candidates.length === 0) {
          res.status(400).json({
            error:
              errors[0]?.message ||
              'No valid cryptographic assets found to import.',
            errors,
          });
          return;
        }

        const actor = req.ecdatActor!;
        const role: Role = req.ecdatWorkspaceRole ?? 'Analyst';
        const outcome = store.confirmImport({
          workspaceId: req.params.wsId,
          filename: validated.data.filename,
          format,
          actorEmail: actor.email,
          actorRole: role,
          candidates,
          rejectedCount: errors.length,
        });

        res.status(201).json({
          importRecord: outcome.importRecord,
          assetsAffected: outcome.assetsAffected,
          rejectedErrors: errors,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to confirm import.',
        });
      }
    }
  );

  // ==================== FINDINGS & REMEDIATION ====================

  router.get(
    '/workspaces/:wsId/findings',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const q = req.query;
      const result = store.queryFindings(req.params.wsId, {
        search: typeof q.search === 'string' ? q.search : undefined,
        severity: typeof q.severity === 'string' ? q.severity : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        detectionState:
          typeof q.detectionState === 'string' ? q.detectionState : undefined,
        environment: typeof q.environment === 'string' ? q.environment : undefined,
        ruleId: typeof q.ruleId === 'string' ? q.ruleId : undefined,
        page: q.page ? Math.max(1, Number(q.page) || 1) : 1,
        pageSize: q.pageSize ? Math.min(100, Math.max(1, Number(q.pageSize) || 15)) : 15,
      });
      res.json(result);
    }
  );

  router.get(
    '/workspaces/:wsId/findings/:findingId',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const detail = store.getFindingDetail(req.params.wsId, req.params.findingId);
      if (!detail) {
        res.status(404).json({ error: 'Finding not found in workspace.' });
        return;
      }
      res.json(detail);
    }
  );

  router.patch(
    '/workspaces/:wsId/findings/:findingId/remediation',
    requireWorkspaceAccess(store, 'Analyst'),
    (req: AuthenticatedRequest, res: Response) => {
      const parsed = RemediationPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid remediation payload.',
        });
        return;
      }

      const d = parsed.data;
      if (
        containsArbitraryUrl(d.assignee) ||
        containsArbitraryUrl(d.note) ||
        containsArbitraryUrl(d.acceptedReason)
      ) {
        res.status(400).json({
          error: 'Arbitrary URLs are not permitted in remediation text fields.',
        });
        return;
      }

      let normalizedDue: string | null | undefined = d.dueDate;
      if (typeof d.dueDate === 'string' && d.dueDate.trim()) {
        const ms = Date.parse(d.dueDate.trim());
        if (Number.isNaN(ms)) {
          res.status(400).json({ error: 'Invalid due date format.' });
          return;
        }
        normalizedDue = new Date(ms).toISOString();
      } else if (d.dueDate === '') {
        normalizedDue = null;
      }

      let normalizedReview: string | null | undefined = d.acceptedReviewDate;
      if (typeof d.acceptedReviewDate === 'string' && d.acceptedReviewDate.trim()) {
        const ms = Date.parse(d.acceptedReviewDate.trim());
        if (Number.isNaN(ms)) {
          res.status(400).json({ error: 'Invalid accepted-risk review date format.' });
          return;
        }
        normalizedReview = new Date(ms).toISOString();
      } else if (d.acceptedReviewDate === '') {
        normalizedReview = null;
      }

      try {
        const actor = req.ecdatActor!;
        const role: Role = req.ecdatWorkspaceRole ?? 'Analyst';
        const result = store.updateRemediation({
          workspaceId: req.params.wsId,
          findingId: req.params.findingId,
          actorEmail: actor.email,
          actorRole: role,
          status: d.status,
          assignee: d.assignee === '' ? null : d.assignee,
          dueDate: normalizedDue,
          note: d.note,
          acceptedReason: d.acceptedReason,
          acceptedReviewDate: normalizedReview,
        });
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Unable to update remediation.',
        });
      }
    }
  );

  // ==================== REPORTS & SETTINGS ====================

  router.get(
    '/workspaces/:wsId/reports/summary',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      const env = typeof req.query.environment === 'string' ? req.query.environment : 'all';
      const sev = typeof req.query.severity === 'string' ? req.query.severity : 'all';
      const status = typeof req.query.status === 'string' ? req.query.status : 'all';

      let assets = store.listAllAssets(ws.id);
      let findings = store.listAllFindings(ws.id);

      if (env !== 'all') {
        assets = assets.filter((a) => a.environment === env);
        findings = findings.filter((f) => f.assetEnvironment === env);
      }
      if (sev !== 'all') {
        findings = findings.filter((f) => f.severity === sev);
      }
      if (status !== 'all') {
        findings = findings.filter((f) => f.status === status);
      }

      res.json({
        workspace: {
          id: ws.id,
          name: ws.name,
          isSample: ws.isSample,
        },
        dataSourcesSummary: buildDataSourcesSummary(store, ws.id),
        filters: {
          environment: env,
          severity: sev,
          status,
        },
        generatedAtUtc: new Date().toISOString(),
        counts: {
          assets: assets.length,
          findings: findings.length,
          highFindings: findings.filter((f) => f.severity === 'High').length,
          mediumFindings: findings.filter((f) => f.severity === 'Medium').length,
          lowFindings: findings.filter((f) => f.severity === 'Low').length,
          openFindings: findings.filter(
            (f) => f.status === 'Open' || f.status === 'In progress'
          ).length,
          resolvedFindings: findings.filter((f) => f.status === 'Resolved').length,
          acceptedRiskFindings: findings.filter((f) => f.status === 'Accepted risk').length,
        },
        findings: findings.slice(0, 50),
        assets: assets.slice(0, 50),
      });
    }
  );

  router.get(
    '/workspaces/:wsId/reports/export.csv',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      const exportType = req.query.type === 'assets' ? 'assets' : 'findings';
      const env = typeof req.query.environment === 'string' ? req.query.environment : 'all';
      const sev = typeof req.query.severity === 'string' ? req.query.severity : 'all';
      const status = typeof req.query.status === 'string' ? req.query.status : 'all';
      const generatedAt = new Date().toISOString();

      if (exportType === 'assets') {
        let assets = store.listAllAssets(ws.id);
        if (env !== 'all') {
          assets = assets.filter((a) => a.environment === env);
        }
        const headers = [
          'Workspace',
          'Report Generated (UTC)',
          'Filter Environment',
          'Asset ID',
          'Name',
          'Source',
          'Last Observed (UTC)',
          'Type',
          'Environment',
          'Location',
          'Algorithm',
          'Key Size',
          'Signature Algorithm',
          'Valid From (UTC)',
          'Valid To (UTC)',
          'Owner',
          'SHA-256 Fingerprint',
          'Subject',
          'Issuer',
        ];
        const rows = assets.map((a) => [
          ws.name,
          generatedAt,
          env,
          a.id,
          a.name,
          a.sourceName ?? (a.sourceImportId ? 'File Import' : 'Unknown'),
          a.lastObservedAt ?? 'Unknown',
          a.assetType,
          a.environment,
          a.location,
          a.algorithm,
          a.keySize ?? 'Unknown',
          a.signatureAlgorithm ?? 'Unknown',
          a.validFrom ?? 'Unknown',
          a.validTo ?? 'Unknown',
          a.owner ?? 'Unknown',
          a.fingerprintSha256 ?? 'Unknown',
          a.subject ?? 'Unknown',
          a.issuer ?? 'Unknown',
        ]);
        const csv = buildCsvDocument(headers, rows);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="ecdat-assets-${ws.slug}.csv"`
        );
        res.send(csv);
        return;
      }

      let findings = store.listAllFindings(ws.id);
      if (env !== 'all') findings = findings.filter((f) => f.assetEnvironment === env);
      if (sev !== 'all') findings = findings.filter((f) => f.severity === sev);
      if (status !== 'all') findings = findings.filter((f) => f.status === status);

      const headers = [
        'Workspace',
        'Report Generated (UTC)',
        'Filter Environment',
        'Filter Severity',
        'Filter Status',
        'Finding ID',
        'Rule ID',
        'Rule Version',
        'Severity',
        'Title',
        'Asset Name',
        'Source',
        'Environment',
        'Location',
        'Detection State',
        'Remediation Status',
        'Assignee',
        'Due Date (UTC)',
        'Accepted Risk Reason',
        'Accepted Review Date (UTC)',
        'Evidence',
        'Recommendation',
        'First Observed (UTC)',
        'Last Observed (UTC)',
      ];
      const rows = findings.map((f) => [
        ws.name,
        generatedAt,
        env,
        sev,
        status,
        f.id,
        f.ruleId,
        f.ruleVersion,
        f.severity,
        f.title,
        f.assetName ?? 'Unknown',
        f.assetSourceName ?? 'File Import',
        f.assetEnvironment ?? 'unknown',
        f.assetLocation ?? 'Unknown',
        f.detectionState,
        f.status,
        f.assignee ?? 'Unassigned',
        f.dueDate ?? '',
        f.acceptedReason ?? '',
        f.acceptedReviewDate ?? '',
        f.evidence,
        f.recommendation,
        f.firstObservedAt,
        f.lastObservedAt,
      ]);

      const csv = buildCsvDocument(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="ecdat-findings-${ws.slug}.csv"`
      );
      res.send(csv);
    }
  );

  router.get(
    '/workspaces/:wsId/settings',
    requireWorkspaceAccess(store, 'Viewer'),
    (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      res.json({
        workspace: ws,
        members: store.getWorkspaceMembers(ws.id),
        auditEvents: store.listAuditEvents(ws.id, 100),
        storageMode: store.mode,
        enterpriseAuthConfigured: isEnterpriseAuthConfigured(),
        scheduler: getSchedulerStatus(),
        currentRole: req.ecdatWorkspaceRole ?? 'Viewer',
      });
    }
  );

  router.patch(
    '/workspaces/:wsId/settings',
    requireWorkspaceAccess(store, 'Analyst'),
    (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId)!;
      if (!ws.isSample && req.ecdatWorkspaceRole !== 'Admin') {
        res.status(403).json({ error: 'Forbidden: only Admin can update workspace rules.' });
        return;
      }

      const parsed = SettingsPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid rule threshold settings.',
        });
        return;
      }

      const updated = store.updateWorkspaceSettings(
        ws.id,
        parsed.data,
        req.ecdatActor!.email,
        req.ecdatWorkspaceRole ?? 'Analyst'
      );
      res.json({ workspace: updated });
    }
  );

  router.post(
    '/workspaces/:wsId/members',
    requireWorkspaceAccess(store, 'Admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const parsed = MemberUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid member details.',
        });
        return;
      }
      const member = store.upsertWorkspaceMember(
        req.params.wsId,
        parsed.data.email.trim(),
        parsed.data.name.trim(),
        parsed.data.role,
        req.ecdatActor!.email,
        req.ecdatWorkspaceRole ?? 'Admin'
      );
      res.status(201).json({ member });
    }
  );

  router.post(
    '/workspaces/:wsId/reset-sample',
    requireWorkspaceAccess(store, 'Analyst'),
    (req: AuthenticatedRequest, res: Response) => {
      const ws = store.getWorkspace(req.params.wsId);
      if (!ws || !ws.isSample) {
        res.status(400).json({ error: 'Only the sample workspace can be reset.' });
        return;
      }
      store.resetSampleWorkspace(req.ecdatActor!.email);
      res.json({ ok: true });
    }
  );

  return router;
}
