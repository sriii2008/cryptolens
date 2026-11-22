import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildDedupeKey } from './crypto-parser.ts';
import { reconcileFindingsForAsset } from './rules-engine.ts';
import {
  DEFAULT_RULE_SETTINGS,
  LIVE_WORKSPACE_ID,
  SAMPLE_WORKSPACE_ID,
  buildSampleWorkspaceSeed,
} from './seed-data.ts';
import type {
  AuditEvent,
  AwsAuthMode,
  CryptoAsset,
  DataSource,
  DataSourceProvider,
  DataSourceStatus,
  DetectionState,
  EnvironmentType,
  Finding,
  ImportFormat,
  ImportPreviewItem,
  ImportRecord,
  ParsedCandidateAsset,
  RemediationHistoryEntry,
  RemediationStatus,
  Role,
  RuleThresholdSettings,
  Severity,
  SyncRun,
  SyncRunRegionFailure,
  SyncRunStatus,
  SyncTrigger,
  Workspace,
  WorkspaceMember,
} from '../shared/types.ts';

export interface AssetQueryParams {
  search?: string;
  environment?: string;
  assetType?: string;
  algorithm?: string;
  expiration?: 'all' | 'expired' | 'expiring_30' | 'valid' | 'unknown';
  owner?: string;
  sourceId?: string;
  sortBy?: 'name' | 'validTo' | 'algorithm' | 'environment' | 'updatedAt';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface FindingQueryParams {
  search?: string;
  severity?: string;
  status?: string;
  detectionState?: string;
  environment?: string;
  ruleId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConfirmImportInput {
  workspaceId: string;
  filename: string;
  format: ImportFormat;
  actorEmail: string;
  actorRole: Role;
  candidates: ParsedCandidateAsset[];
  rejectedCount: number;
}

export interface UpdateRemediationInput {
  workspaceId: string;
  findingId: string;
  actorEmail: string;
  actorRole: Role;
  status?: RemediationStatus;
  assignee?: string | null;
  dueDate?: string | null;
  note?: string | null;
  acceptedReason?: string | null;
  acceptedReviewDate?: string | null;
}

export interface CreateDataSourceInput {
  workspaceId: string;
  provider: DataSourceProvider;
  name: string;
  authMode: AwsAuthMode;
  awsAccountId?: string | null;
  roleArn?: string | null;
  externalId?: string | null;
  regions: string[];
  environmentDefault: EnvironmentType;
  status?: DataSourceStatus;
  actorEmail: string;
  actorRole: Role;
}

export interface UpdateDataSourceInput {
  workspaceId: string;
  sourceId: string;
  name?: string;
  authMode?: AwsAuthMode;
  awsAccountId?: string | null;
  roleArn?: string | null;
  externalId?: string | null;
  regions?: string[];
  environmentDefault?: EnvironmentType;
  status?: DataSourceStatus;
  actorEmail: string;
  actorRole: Role;
}

export interface SyncedCertificateCandidate {
  externalArn: string;
  awsAccountId: string | null;
  awsRegion: string;
  acmStatus: string | null;
  inUseBy: string[];
  candidate: ParsedCandidateAsset;
}

export interface EcdatStore {
  readonly mode: 'sqlite' | 'file';
  readonly locationLabel: string;
  init(): void;
  listWorkspaces(): Workspace[];
  getWorkspace(workspaceId: string): Workspace | null;
  getWorkspaceMembers(workspaceId: string): WorkspaceMember[];
  upsertWorkspaceMember(
    workspaceId: string,
    email: string,
    name: string,
    role: Role,
    actorEmail: string,
    actorRole: Role
  ): WorkspaceMember;
  updateWorkspaceSettings(
    workspaceId: string,
    settings: RuleThresholdSettings,
    actorEmail: string,
    actorRole: Role
  ): Workspace;
  listAllAssets(workspaceId: string): CryptoAsset[];
  queryAssets(workspaceId: string, params: AssetQueryParams): PaginatedResult<CryptoAsset>;
  getAssetById(
    workspaceId: string,
    assetId: string
  ): {
    asset: CryptoAsset;
    findings: Finding[];
    sourceImport: ImportRecord | null;
    dataSource: DataSource | null;
  } | null;
  previewImport(
    workspaceId: string,
    candidates: ParsedCandidateAsset[]
  ): ImportPreviewItem[];
  confirmImport(input: ConfirmImportInput): {
    importRecord: ImportRecord;
    assetsAffected: number;
  };
  listImports(workspaceId: string): ImportRecord[];
  listAllFindings(workspaceId: string): Finding[];
  queryFindings(workspaceId: string, params: FindingQueryParams): PaginatedResult<Finding>;
  getFindingDetail(
    workspaceId: string,
    findingId: string
  ): {
    finding: Finding;
    asset: CryptoAsset;
    history: RemediationHistoryEntry[];
  } | null;
  updateRemediation(input: UpdateRemediationInput): {
    finding: Finding;
    historyEntry: RemediationHistoryEntry;
  };
  listAuditEvents(workspaceId: string, limit?: number): AuditEvent[];
  recordAuditEvent(evt: Omit<AuditEvent, 'id'>): void;
  resetSampleWorkspace(actorEmail: string): void;
  ensureEnterpriseWorkspace(ws: Workspace, members: WorkspaceMember[]): void;

  // Data Sources & Sync Runs
  listDataSources(workspaceId: string): DataSource[];
  listAllConnectedDataSources(): DataSource[];
  getDataSource(workspaceId: string, sourceId: string): DataSource | null;
  getDataSourceById(sourceId: string): DataSource | null;
  createDataSource(input: CreateDataSourceInput): DataSource;
  updateDataSource(input: UpdateDataSourceInput): DataSource;
  deleteDataSource(
    workspaceId: string,
    sourceId: string,
    actorEmail: string,
    actorRole: Role
  ): void;
  listSyncRuns(workspaceId: string, sourceId?: string, limit?: number): SyncRun[];
  hasRunningSyncForSource(sourceId: string): boolean;
  startSyncRun(input: {
    workspaceId: string;
    sourceId: string;
    trigger: SyncTrigger;
    actorEmail: string;
    regions: string[];
  }): SyncRun;
  applyRegionSyncSuccess(input: {
    workspaceId: string;
    sourceId: string;
    awsRegion: string;
    observedAtIso: string;
    actorEmail: string;
    records: SyncedCertificateCandidate[];
  }): {
    inserted: number;
    updated: number;
    unchanged: number;
    missing: number;
  };
  finalizeSyncRun(input: {
    workspaceId: string;
    sourceId: string;
    runId: string;
    status: SyncRunStatus;
    actorEmail: string;
    actorRole: Role;
    finishedAtIso: string;
    regionsChecked: string[];
    failedRegions: SyncRunRegionFailure[];
    insertedCount: number;
    updatedCount: number;
    unchangedCount: number;
    missingCount: number;
    totalObserved: number;
    resolvedAccountId?: string | null;
    errorMessage: string | null;
  }): { run: SyncRun; source: DataSource };
}

function matchesExpirationFilter(
  asset: CryptoAsset,
  expiration: AssetQueryParams['expiration'],
  nowMs: number,
  warningDays = 30
): boolean {
  if (!expiration || expiration === 'all') return true;
  if (expiration === 'unknown') return !asset.validTo;
  if (!asset.validTo) return false;
  const validToMs = Date.parse(asset.validTo);
  if (Number.isNaN(validToMs)) return false;
  if (expiration === 'expired') return validToMs < nowMs;
  const horizonMs = nowMs + warningDays * 24 * 60 * 60 * 1000;
  if (expiration === 'expiring_30') return validToMs >= nowMs && validToMs <= horizonMs;
  if (expiration === 'valid') return validToMs > horizonMs;
  return true;
}

function candidateDiffersFromAsset(
  candidate: ParsedCandidateAsset,
  existing: CryptoAsset
): boolean {
  return (
    existing.name !== candidate.name ||
    existing.assetType !== candidate.assetType ||
    existing.environment !== candidate.environment ||
    existing.subject !== candidate.subject ||
    existing.issuer !== candidate.issuer ||
    existing.serialNumber !== candidate.serialNumber ||
    existing.algorithm !== candidate.algorithm ||
    existing.keySize !== candidate.keySize ||
    existing.signatureAlgorithm !== candidate.signatureAlgorithm ||
    existing.validFrom !== candidate.validFrom ||
    existing.validTo !== candidate.validTo ||
    existing.owner !== candidate.owner ||
    JSON.stringify(existing.sanList) !== JSON.stringify(candidate.sanList)
  );
}

function computeSyncedChanges(
  rec: SyncedCertificateCandidate,
  existing: CryptoAsset
): string[] {
  const diffs: string[] = [];
  if (existing.name !== rec.candidate.name) diffs.push('domain');
  if (existing.issuer !== rec.candidate.issuer) diffs.push('issuer');
  if (existing.serialNumber !== rec.candidate.serialNumber) diffs.push('serialNumber');
  if (
    existing.algorithm !== rec.candidate.algorithm ||
    existing.keySize !== rec.candidate.keySize
  ) {
    diffs.push('keyAlgorithm');
  }
  if (existing.signatureAlgorithm !== rec.candidate.signatureAlgorithm) {
    diffs.push('signatureAlgorithm');
  }
  if (existing.validFrom !== rec.candidate.validFrom || existing.validTo !== rec.candidate.validTo) {
    diffs.push('validityDates');
  }
  if ((existing.acmStatus ?? null) !== (rec.acmStatus ?? null)) diffs.push('status');
  if (JSON.stringify(existing.inUseBy ?? []) !== JSON.stringify(rec.inUseBy ?? [])) {
    diffs.push('inUseBy');
  }
  if (JSON.stringify(existing.sanList) !== JSON.stringify(rec.candidate.sanList)) {
    diffs.push('sanList');
  }
  if (existing.missingFromSource) {
    diffs.push('restoredInSource');
  }
  return diffs;
}

export function generateExternalId(): string {
  return `ecdat-ext-${randomBytes(12).toString('hex')}`;
}

export class SqliteStore implements EcdatStore {
  public readonly mode = 'sqlite' as const;
  public readonly locationLabel: string;
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.locationLabel = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  private ensureAssetColumn(columnName: string, columnDef: string): void {
    const cols = this.db.prepare('PRAGMA table_info(assets)').all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === columnName)) {
      this.db.exec(`ALTER TABLE assets ADD COLUMN ${columnName} ${columnDef};`);
    }
  }

  public init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        is_sample INTEGER NOT NULL DEFAULT 0,
        expiry_warning_days INTEGER NOT NULL DEFAULT 30,
        min_rsa_key_bits INTEGER NOT NULL DEFAULT 2048,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_members (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, email)
      );

      CREATE TABLE IF NOT EXISTS imports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        format TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        inserted_count INTEGER NOT NULL,
        updated_count INTEGER NOT NULL,
        skipped_count INTEGER NOT NULL,
        rejected_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        summary_note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS data_sources (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        auth_mode TEXT NOT NULL,
        aws_account_id TEXT,
        role_arn TEXT,
        external_id TEXT,
        regions_json TEXT NOT NULL,
        environment_default TEXT NOT NULL DEFAULT 'production',
        last_sync_started_at TEXT,
        last_sync_finished_at TEXT,
        last_successful_sync_at TEXT,
        last_sync_error TEXT,
        last_checked_regions_json TEXT NOT NULL DEFAULT '[]',
        last_sync_counts_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        regions_checked_json TEXT NOT NULL DEFAULT '[]',
        failed_regions_json TEXT NOT NULL DEFAULT '[]',
        inserted_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        unchanged_count INTEGER NOT NULL DEFAULT 0,
        missing_count INTEGER NOT NULL DEFAULT 0,
        total_observed INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        dedupe_key TEXT NOT NULL,
        source_record_id TEXT,
        fingerprint_sha256 TEXT,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        environment TEXT NOT NULL,
        location TEXT NOT NULL,
        subject TEXT,
        issuer TEXT,
        serial_number TEXT,
        algorithm TEXT NOT NULL,
        key_size INTEGER,
        signature_algorithm TEXT,
        valid_from TEXT,
        valid_to TEXT,
        owner TEXT,
        san_list_json TEXT NOT NULL,
        source_import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
        source_id TEXT REFERENCES data_sources(id) ON DELETE SET NULL,
        external_arn TEXT,
        aws_account_id TEXT,
        aws_region TEXT,
        acm_status TEXT,
        in_use_by_json TEXT NOT NULL DEFAULT '[]',
        last_observed_at TEXT,
        missing_from_source INTEGER NOT NULL DEFAULT 0,
        change_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, dedupe_key)
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        title TEXT NOT NULL,
        severity TEXT NOT NULL,
        rationale TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        evidence TEXT NOT NULL,
        detection_state TEXT NOT NULL,
        status TEXT NOT NULL,
        assignee TEXT,
        due_date TEXT,
        accepted_reason TEXT,
        accepted_review_date TEXT,
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, asset_id, rule_id)
      );

      CREATE TABLE IF NOT EXISTS remediation_history (
        id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_email TEXT NOT NULL,
        action TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        note TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_email TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        event_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_assets_ws ON assets(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_findings_ws ON findings(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_events(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sources_ws ON data_sources(workspace_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_sync_runs_src ON sync_runs(source_id, started_at DESC);
    `);

    // Migrate pre-existing assets table safely if upgrading in place
    this.ensureAssetColumn('source_id', 'TEXT REFERENCES data_sources(id) ON DELETE SET NULL');
    this.ensureAssetColumn('external_arn', 'TEXT');
    this.ensureAssetColumn('aws_account_id', 'TEXT');
    this.ensureAssetColumn('aws_region', 'TEXT');
    this.ensureAssetColumn('acm_status', 'TEXT');
    this.ensureAssetColumn('in_use_by_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureAssetColumn('last_observed_at', 'TEXT');
    this.ensureAssetColumn('missing_from_source', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureAssetColumn('change_summary', 'TEXT');

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_assets_source_arn ON assets(workspace_id, source_id, external_arn);
    `);

    // Recover any interrupted 'running' sync runs left behind by an unclean process crash
    const interruptedNow = new Date().toISOString();
    const staleRunning = this.db
      .prepare("SELECT id, source_id FROM sync_runs WHERE status = 'running'")
      .all() as Array<{ id: string; source_id: string }>;
    for (const row of staleRunning) {
      this.db
        .prepare(
          "UPDATE sync_runs SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?"
        )
        .run(
          interruptedNow,
          'Sync interrupted by server restart before completion. Last successful snapshot preserved.',
          row.id
        );
      this.db
        .prepare(
          "UPDATE data_sources SET status = 'failed', last_sync_finished_at = ?, last_sync_error = ?, updated_at = ? WHERE id = ? AND status = 'syncing'"
        )
        .run(
          interruptedNow,
          'Previous sync was interrupted before completion.',
          interruptedNow,
          row.source_id
        );
    }

    const existingSample = this.getWorkspace(SAMPLE_WORKSPACE_ID);
    if (!existingSample) {
      this.seedSampleWorkspace('system-seed@ecdat.local');
    }

    // Ensure a clean, empty Live Production Workspace exists (no fictional records)
    const existingLive = this.getWorkspace(LIVE_WORKSPACE_ID);
    if (!existingLive) {
      const nowIso = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO workspaces (id, name, slug, is_sample, expiry_warning_days, min_rsa_key_bits, created_at)
           VALUES (?, ?, ?, 0, ?, ?, ?)`
        )
        .run(
          LIVE_WORKSPACE_ID,
          'Live Production Workspace',
          'live-production',
          DEFAULT_RULE_SETTINGS.expiryWarningDays,
          DEFAULT_RULE_SETTINGS.minRsaKeyBits,
          nowIso
        );
    }
  }

  private runInTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private mapWorkspace(row: Record<string, unknown>): Workspace {
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      isSample: Number(row.is_sample) === 1,
      settings: {
        expiryWarningDays: Number(row.expiry_warning_days),
        minRsaKeyBits: Number(row.min_rsa_key_bits),
      },
      createdAt: String(row.created_at),
    };
  }

  private mapDataSource(row: Record<string, unknown>): DataSource {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      provider: row.provider as DataSourceProvider,
      name: String(row.name),
      status: row.status as DataSourceStatus,
      authMode: row.auth_mode as AwsAuthMode,
      awsAccountId: row.aws_account_id ? String(row.aws_account_id) : null,
      roleArn: row.role_arn ? String(row.role_arn) : null,
      externalId: row.external_id ? String(row.external_id) : null,
      regions: JSON.parse(String(row.regions_json || '[]')) as string[],
      environmentDefault: (row.environment_default
        ? String(row.environment_default)
        : 'production') as EnvironmentType,
      lastSyncStartedAt: row.last_sync_started_at ? String(row.last_sync_started_at) : null,
      lastSyncFinishedAt: row.last_sync_finished_at
        ? String(row.last_sync_finished_at)
        : null,
      lastSuccessfulSyncAt: row.last_successful_sync_at
        ? String(row.last_successful_sync_at)
        : null,
      lastSyncError: row.last_sync_error ? String(row.last_sync_error) : null,
      lastCheckedRegions: JSON.parse(
        String(row.last_checked_regions_json || '[]')
      ) as string[],
      lastSyncCounts: row.last_sync_counts_json
        ? (JSON.parse(String(row.last_sync_counts_json)) as DataSource['lastSyncCounts'])
        : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapSyncRun(row: Record<string, unknown>): SyncRun {
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      workspaceId: String(row.workspace_id),
      trigger: row.trigger_type as SyncTrigger,
      status: row.status as SyncRunStatus,
      actorEmail: String(row.actor_email),
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      regionsChecked: JSON.parse(String(row.regions_checked_json || '[]')) as string[],
      failedRegions: JSON.parse(
        String(row.failed_regions_json || '[]')
      ) as SyncRunRegionFailure[],
      insertedCount: Number(row.inserted_count ?? 0),
      updatedCount: Number(row.updated_count ?? 0),
      unchangedCount: Number(row.unchanged_count ?? 0),
      missingCount: Number(row.missing_count ?? 0),
      totalObserved: Number(row.total_observed ?? 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
    };
  }

  private mapAsset(row: Record<string, unknown>): CryptoAsset {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      sourceRecordId: row.source_record_id ? String(row.source_record_id) : null,
      fingerprintSha256: row.fingerprint_sha256 ? String(row.fingerprint_sha256) : null,
      name: String(row.name),
      assetType: row.asset_type as CryptoAsset['assetType'],
      environment: row.environment as EnvironmentType,
      location: String(row.location),
      subject: row.subject ? String(row.subject) : null,
      issuer: row.issuer ? String(row.issuer) : null,
      serialNumber: row.serial_number ? String(row.serial_number) : null,
      algorithm: String(row.algorithm),
      keySize: row.key_size !== null && row.key_size !== undefined ? Number(row.key_size) : null,
      signatureAlgorithm: row.signature_algorithm ? String(row.signature_algorithm) : null,
      validFrom: row.valid_from ? String(row.valid_from) : null,
      validTo: row.valid_to ? String(row.valid_to) : null,
      owner: row.owner ? String(row.owner) : null,
      sanList: JSON.parse(String(row.san_list_json || '[]')) as string[],
      sourceImportId: row.source_import_id ? String(row.source_import_id) : null,
      sourceId: row.source_id ? String(row.source_id) : null,
      sourceName: row.source_name ? String(row.source_name) : null,
      sourceProvider: row.source_provider
        ? (String(row.source_provider) as DataSourceProvider)
        : null,
      externalArn: row.external_arn ? String(row.external_arn) : null,
      awsAccountId: row.aws_account_id ? String(row.aws_account_id) : null,
      awsRegion: row.aws_region ? String(row.aws_region) : null,
      acmStatus: row.acm_status ? String(row.acm_status) : null,
      inUseBy: JSON.parse(String(row.in_use_by_json || '[]')) as string[],
      lastObservedAt: row.last_observed_at
        ? String(row.last_observed_at)
        : row.updated_at
          ? String(row.updated_at)
          : null,
      missingFromSource: Number(row.missing_from_source ?? 0) === 1,
      changeSummary: row.change_summary ? String(row.change_summary) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapFinding(row: Record<string, unknown>): Finding {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      assetId: String(row.asset_id),
      ruleId: String(row.rule_id),
      ruleVersion: String(row.rule_version),
      title: String(row.title),
      severity: row.severity as Severity,
      rationale: String(row.rationale),
      recommendation: String(row.recommendation),
      evidence: String(row.evidence),
      detectionState: row.detection_state as DetectionState,
      status: row.status as RemediationStatus,
      assignee: row.assignee ? String(row.assignee) : null,
      dueDate: row.due_date ? String(row.due_date) : null,
      acceptedReason: row.accepted_reason ? String(row.accepted_reason) : null,
      acceptedReviewDate: row.accepted_review_date ? String(row.accepted_review_date) : null,
      firstObservedAt: String(row.first_observed_at),
      lastObservedAt: String(row.last_observed_at),
      updatedAt: String(row.updated_at),
      assetName: row.asset_name ? String(row.asset_name) : undefined,
      assetEnvironment: row.asset_environment
        ? (String(row.asset_environment) as EnvironmentType)
        : undefined,
      assetLocation: row.asset_location ? String(row.asset_location) : undefined,
      assetFingerprint:
        row.asset_fingerprint !== undefined && row.asset_fingerprint !== null
          ? String(row.asset_fingerprint)
          : null,
      assetOwner:
        row.asset_owner !== undefined && row.asset_owner !== null
          ? String(row.asset_owner)
          : null,
      assetSourceName: row.asset_source_name ? String(row.asset_source_name) : null,
    };
  }

  private mapImport(row: Record<string, unknown>): ImportRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      filename: String(row.filename),
      format: row.format as ImportFormat,
      actorEmail: String(row.actor_email),
      insertedCount: Number(row.inserted_count),
      updatedCount: Number(row.updated_count),
      skippedCount: Number(row.skipped_count),
      rejectedCount: Number(row.rejected_count),
      status: row.status as ImportRecord['status'],
      summaryNote: String(row.summary_note),
      createdAt: String(row.created_at),
    };
  }

  public listWorkspaces(): Workspace[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces ORDER BY is_sample ASC, created_at ASC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapWorkspace(r));
  }

  public getWorkspace(workspaceId: string): Workspace | null {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(workspaceId) as Record<string, unknown> | undefined;
    return row ? this.mapWorkspace(row) : null;
  }

  public getWorkspaceMembers(workspaceId: string): WorkspaceMember[] {
    const rows = this.db
      .prepare('SELECT * FROM workspace_members WHERE workspace_id = ? ORDER BY created_at ASC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      email: String(r.email),
      name: String(r.name),
      role: r.role as Role,
      createdAt: String(r.created_at),
    }));
  }

  public upsertWorkspaceMember(
    workspaceId: string,
    email: string,
    name: string,
    role: Role,
    actorEmail: string,
    actorRole: Role
  ): WorkspaceMember {
    const nowIso = new Date().toISOString();
    return this.runInTransaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM workspace_members WHERE workspace_id = ? AND email = ?')
        .get(workspaceId, email) as Record<string, unknown> | undefined;
      const memberId = existing ? String(existing.id) : `mem-${randomUUID()}`;
      if (existing) {
        this.db
          .prepare('UPDATE workspace_members SET name = ?, role = ? WHERE id = ?')
          .run(name, role, memberId);
      } else {
        this.db
          .prepare(
            'INSERT INTO workspace_members (id, workspace_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(memberId, workspaceId, email, name, role, nowIso);
      }

      this.insertAuditEvent({
        workspaceId,
        actorEmail,
        actorRole,
        eventType: 'member_updated',
        targetType: 'member',
        targetId: memberId,
        summary: `${existing ? 'Updated' : 'Added'} member ${email} with role ${role}`,
        detailsJson: JSON.stringify({ email, role }),
        createdAt: nowIso,
      });

      return {
        id: memberId,
        workspaceId,
        email,
        name,
        role,
        createdAt: existing ? String(existing.created_at) : nowIso,
      };
    });
  }

  public updateWorkspaceSettings(
    workspaceId: string,
    settings: RuleThresholdSettings,
    actorEmail: string,
    actorRole: Role
  ): Workspace {
    const nowIso = new Date().toISOString();
    return this.runInTransaction(() => {
      this.db
        .prepare(
          'UPDATE workspaces SET expiry_warning_days = ?, min_rsa_key_bits = ? WHERE id = ?'
        )
        .run(settings.expiryWarningDays, settings.minRsaKeyBits, workspaceId);

      // Re-evaluate all assets against updated thresholds
      const assets = this.listAllAssets(workspaceId);
      for (const asset of assets) {
        this.reconcileAssetFindingsInternal(
          workspaceId,
          asset,
          settings,
          actorEmail,
          new Date(nowIso)
        );
      }

      this.insertAuditEvent({
        workspaceId,
        actorEmail,
        actorRole,
        eventType: 'settings_updated',
        targetType: 'workspace',
        targetId: workspaceId,
        summary: `Updated analysis thresholds (expiryWarningDays=${settings.expiryWarningDays}, minRsaKeyBits=${settings.minRsaKeyBits})`,
        detailsJson: JSON.stringify(settings),
        createdAt: nowIso,
      });

      const updated = this.getWorkspace(workspaceId);
      if (!updated) throw new Error('Workspace not found after update');
      return updated;
    });
  }

  public listAllAssets(workspaceId: string): CryptoAsset[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, ds.name AS source_name, ds.provider AS source_provider
         FROM assets a
         LEFT JOIN data_sources ds ON ds.id = a.source_id
         WHERE a.workspace_id = ?
         ORDER BY a.updated_at DESC, a.name ASC`
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.mapAsset(r));
  }

  public queryAssets(
    workspaceId: string,
    params: AssetQueryParams
  ): PaginatedResult<CryptoAsset> {
    const ws = this.getWorkspace(workspaceId);
    const warningDays = ws?.settings.expiryWarningDays ?? DEFAULT_RULE_SETTINGS.expiryWarningDays;
    let list = this.listAllAssets(workspaceId);
    const nowMs = Date.now();

    if (params.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.location.toLowerCase().includes(q) ||
          (a.fingerprintSha256 ?? '').toLowerCase().includes(q) ||
          (a.externalArn ?? '').toLowerCase().includes(q) ||
          (a.subject ?? '').toLowerCase().includes(q) ||
          (a.issuer ?? '').toLowerCase().includes(q) ||
          (a.owner ?? '').toLowerCase().includes(q) ||
          (a.sourceName ?? '').toLowerCase().includes(q)
      );
    }
    if (params.environment && params.environment !== 'all') {
      list = list.filter((a) => a.environment === params.environment);
    }
    if (params.assetType && params.assetType !== 'all') {
      list = list.filter((a) => a.assetType === params.assetType);
    }
    if (params.algorithm && params.algorithm !== 'all') {
      const alg = params.algorithm.toLowerCase();
      list = list.filter((a) => a.algorithm.toLowerCase().includes(alg));
    }
    if (params.owner && params.owner !== 'all') {
      if (params.owner === 'unassigned') {
        list = list.filter((a) => !a.owner || a.owner.trim() === '');
      } else {
        list = list.filter((a) => (a.owner ?? '') === params.owner);
      }
    }
    if (params.sourceId && params.sourceId !== 'all') {
      if (params.sourceId === 'manual_import') {
        list = list.filter((a) => !a.sourceId);
      } else {
        list = list.filter((a) => a.sourceId === params.sourceId);
      }
    }
    list = list.filter((a) =>
      matchesExpirationFilter(a, params.expiration, nowMs, warningDays)
    );

    const sortBy = params.sortBy ?? 'validTo';
    const dir = params.sortDir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      if (sortBy === 'validTo') {
        const av = a.validTo ? Date.parse(a.validTo) : Number.MAX_SAFE_INTEGER;
        const bv = b.validTo ? Date.parse(b.validTo) : Number.MAX_SAFE_INTEGER;
        return (av - bv) * dir;
      }
      const sa = String(a[sortBy] ?? '').toLowerCase();
      const sb = String(b[sortBy] ?? '').toLowerCase();
      return sa.localeCompare(sb) * dir;
    });

    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const page = Math.max(1, params.page ?? 1);
    const total = list.length;
    const start = (page - 1) * pageSize;
    return {
      items: list.slice(start, start + pageSize),
      total,
      page,
      pageSize,
    };
  }

  public getAssetById(workspaceId: string, assetId: string) {
    const row = this.db
      .prepare(
        `SELECT a.*, ds.name AS source_name, ds.provider AS source_provider
         FROM assets a
         LEFT JOIN data_sources ds ON ds.id = a.source_id
         WHERE a.workspace_id = ? AND a.id = ?`
      )
      .get(workspaceId, assetId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const asset = this.mapAsset(row);

    const findingRows = this.db
      .prepare(
        `SELECT f.*, a.name AS asset_name, a.environment AS asset_environment, a.location AS asset_location, a.fingerprint_sha256 AS asset_fingerprint, a.owner AS asset_owner, ds.name AS asset_source_name
         FROM findings f
         JOIN assets a ON a.id = f.asset_id
         LEFT JOIN data_sources ds ON ds.id = a.source_id
         WHERE f.workspace_id = ? AND f.asset_id = ?
         ORDER BY CASE f.severity WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, f.last_observed_at DESC`
      )
      .all(workspaceId, assetId) as Record<string, unknown>[];

    let sourceImport: ImportRecord | null = null;
    if (asset.sourceImportId) {
      const impRow = this.db
        .prepare('SELECT * FROM imports WHERE workspace_id = ? AND id = ?')
        .get(workspaceId, asset.sourceImportId) as Record<string, unknown> | undefined;
      if (impRow) sourceImport = this.mapImport(impRow);
    }

    let dataSource: DataSource | null = null;
    if (asset.sourceId) {
      dataSource = this.getDataSource(workspaceId, asset.sourceId);
    }

    return {
      asset,
      findings: findingRows.map((r) => this.mapFinding(r)),
      sourceImport,
      dataSource,
    };
  }

  public previewImport(
    workspaceId: string,
    candidates: ParsedCandidateAsset[]
  ): ImportPreviewItem[] {
    const existingRows = this.db
      .prepare('SELECT * FROM assets WHERE workspace_id = ?')
      .all(workspaceId) as Record<string, unknown>[];
    const byDedupe = new Map<string, CryptoAsset>();
    for (const row of existingRows) {
      byDedupe.set(String(row.dedupe_key), this.mapAsset(row));
    }

    const seenInBatch = new Set<string>();
    return candidates.map((candidate, idx) => {
      const key = buildDedupeKey(candidate);
      if (seenInBatch.has(key)) {
        return {
          rowNumber: idx + 1,
          action: 'skip',
          reason: 'Duplicate record within the same import batch.',
          candidate,
        };
      }
      seenInBatch.add(key);

      const existing = byDedupe.get(key);
      if (!existing) {
        return {
          rowNumber: idx + 1,
          action: 'insert',
          reason: candidate.fingerprintSha256
            ? 'New certificate/location pair.'
            : 'New metadata record.',
          candidate,
        };
      }
      if (candidateDiffersFromAsset(candidate, existing)) {
        return {
          rowNumber: idx + 1,
          action: 'update',
          reason: 'Matches existing fingerprint + location with updated metadata.',
          candidate,
        };
      }
      return {
        rowNumber: idx + 1,
        action: 'skip',
        reason: 'Identical record already present in workspace.',
        candidate,
      };
    });
  }

  public confirmImport(input: ConfirmImportInput): {
    importRecord: ImportRecord;
    assetsAffected: number;
  } {
    const ws = this.getWorkspace(input.workspaceId);
    if (!ws) throw new Error('Workspace not found');
    const now = new Date();
    const nowIso = now.toISOString();
    const importId = `imp-${randomUUID()}`;

    return this.runInTransaction(() => {
      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const seenKeys = new Set<string>();
      const touchedAssets: CryptoAsset[] = [];

      this.db
        .prepare(
          `INSERT INTO imports (id, workspace_id, filename, format, actor_email, inserted_count, updated_count, skipped_count, rejected_count, status, summary_note, created_at)
           VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`
        )
        .run(
          importId,
          input.workspaceId,
          input.filename,
          input.format,
          input.actorEmail,
          input.rejectedCount,
          input.rejectedCount > 0 ? 'partial' : 'completed',
          'Processing',
          nowIso
        );

      for (const candidate of input.candidates) {
        const dedupeKey = buildDedupeKey(candidate);
        if (seenKeys.has(dedupeKey)) {
          skippedCount += 1;
          continue;
        }
        seenKeys.add(dedupeKey);

        const existingRow = this.db
          .prepare('SELECT * FROM assets WHERE workspace_id = ? AND dedupe_key = ?')
          .get(input.workspaceId, dedupeKey) as Record<string, unknown> | undefined;

        if (!existingRow) {
          const assetId = `ast-${randomUUID()}`;
          this.db
            .prepare(
              `INSERT INTO assets (
                id, workspace_id, dedupe_key, source_record_id, fingerprint_sha256,
                name, asset_type, environment, location, subject, issuer, serial_number,
                algorithm, key_size, signature_algorithm, valid_from, valid_to, owner,
                san_list_json, source_import_id, last_observed_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              assetId,
              input.workspaceId,
              dedupeKey,
              candidate.sourceRecordId,
              candidate.fingerprintSha256,
              candidate.name,
              candidate.assetType,
              candidate.environment,
              candidate.location,
              candidate.subject,
              candidate.issuer,
              candidate.serialNumber,
              candidate.algorithm,
              candidate.keySize,
              candidate.signatureAlgorithm,
              candidate.validFrom,
              candidate.validTo,
              candidate.owner,
              JSON.stringify(candidate.sanList),
              importId,
              nowIso,
              nowIso,
              nowIso
            );
          insertedCount += 1;
          const insertedRow = this.db
            .prepare('SELECT * FROM assets WHERE id = ?')
            .get(assetId) as Record<string, unknown>;
          touchedAssets.push(this.mapAsset(insertedRow));
        } else {
          const existing = this.mapAsset(existingRow);
          if (candidateDiffersFromAsset(candidate, existing)) {
            this.db
              .prepare(
                `UPDATE assets SET
                  source_record_id = ?, name = ?, asset_type = ?, environment = ?,
                  subject = ?, issuer = ?, serial_number = ?, algorithm = ?, key_size = ?,
                  signature_algorithm = ?, valid_from = ?, valid_to = ?, owner = ?,
                  san_list_json = ?, source_import_id = ?, last_observed_at = ?, updated_at = ?
                 WHERE id = ?`
              )
              .run(
                candidate.sourceRecordId,
                candidate.name,
                candidate.assetType,
                candidate.environment,
                candidate.subject,
                candidate.issuer,
                candidate.serialNumber,
                candidate.algorithm,
                candidate.keySize,
                candidate.signatureAlgorithm,
                candidate.validFrom,
                candidate.validTo,
                candidate.owner,
                JSON.stringify(candidate.sanList),
                importId,
                nowIso,
                nowIso,
                existing.id
              );
            updatedCount += 1;
            const updatedRow = this.db
              .prepare('SELECT * FROM assets WHERE id = ?')
              .get(existing.id) as Record<string, unknown>;
            touchedAssets.push(this.mapAsset(updatedRow));
          } else {
            skippedCount += 1;
          }
        }
      }

      for (const asset of touchedAssets) {
        this.reconcileAssetFindingsInternal(
          input.workspaceId,
          asset,
          ws.settings,
          input.actorEmail,
          now
        );
      }

      const summaryNote = `${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped, ${input.rejectedCount} rejected`;
      this.db
        .prepare(
          `UPDATE imports SET inserted_count = ?, updated_count = ?, skipped_count = ?, status = ?, summary_note = ? WHERE id = ?`
        )
        .run(
          insertedCount,
          updatedCount,
          skippedCount,
          input.rejectedCount > 0 ? 'partial' : 'completed',
          summaryNote,
          importId
        );

      this.insertAuditEvent({
        workspaceId: input.workspaceId,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
        eventType: 'import_confirmed',
        targetType: 'import',
        targetId: importId,
        summary: `Confirmed ${input.format.toUpperCase()} import "${input.filename}" (${summaryNote})`,
        detailsJson: JSON.stringify({
          filename: input.filename,
          format: input.format,
          insertedCount,
          updatedCount,
          skippedCount,
          rejectedCount: input.rejectedCount,
        }),
        createdAt: nowIso,
      });

      const impRow = this.db
        .prepare('SELECT * FROM imports WHERE id = ?')
        .get(importId) as Record<string, unknown>;

      return {
        importRecord: this.mapImport(impRow),
        assetsAffected: touchedAssets.length,
      };
    });
  }

  private reconcileAssetFindingsInternal(
    workspaceId: string,
    asset: CryptoAsset,
    settings: RuleThresholdSettings,
    actorEmail: string,
    nowUtc: Date
  ): void {
    const existingRows = this.db
      .prepare('SELECT * FROM findings WHERE workspace_id = ? AND asset_id = ?')
      .all(workspaceId, asset.id) as Record<string, unknown>[];
    const existing = existingRows.map((r) => this.mapFinding(r));
    const plan = reconcileFindingsForAsset(workspaceId, asset, existing, settings, nowUtc);
    const nowIso = nowUtc.toISOString();

    for (const item of plan.toInsert) {
      const findingId = `fnd-${randomUUID()}`;
      this.db
        .prepare(
          `INSERT INTO findings (
            id, workspace_id, asset_id, rule_id, rule_version, title, severity,
            rationale, recommendation, evidence, detection_state, status,
            assignee, due_date, accepted_reason, accepted_review_date,
            first_observed_at, last_observed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          findingId,
          item.workspaceId,
          item.assetId,
          item.ruleId,
          item.ruleVersion,
          item.title,
          item.severity,
          item.rationale,
          item.recommendation,
          item.evidence,
          item.detectionState,
          item.status,
          item.assignee,
          item.dueDate,
          item.acceptedReason,
          item.acceptedReviewDate,
          item.firstObservedAt,
          item.lastObservedAt,
          item.updatedAt
        );
      this.db
        .prepare(
          `INSERT INTO remediation_history (id, finding_id, workspace_id, actor_email, action, from_status, to_status, note, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `rh-${randomUUID()}`,
          findingId,
          workspaceId,
          actorEmail,
          'finding_detected',
          null,
          'Open',
          `Rule ${item.ruleId} (${item.ruleVersion}) detected issue: ${item.evidence}`,
          null,
          nowIso
        );
    }

    for (const upd of plan.toUpdate) {
      this.db
        .prepare(
          `UPDATE findings SET
            rule_version = ?, title = ?, severity = ?, rationale = ?, recommendation = ?,
            evidence = ?, detection_state = ?, last_observed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          upd.next.ruleVersion,
          upd.next.title,
          upd.next.severity,
          upd.next.rationale,
          upd.next.recommendation,
          upd.next.evidence,
          upd.next.detectionState,
          upd.next.lastObservedAt,
          upd.next.updatedAt,
          upd.existing.id
        );

      if (upd.evidenceChanged || upd.reactivated) {
        this.db
          .prepare(
            `INSERT INTO remediation_history (id, finding_id, workspace_id, actor_email, action, from_status, to_status, note, metadata_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            `rh-${randomUUID()}`,
            upd.existing.id,
            workspaceId,
            actorEmail,
            upd.reactivated ? 'finding_reactivated' : 'evidence_updated',
            upd.existing.status,
            upd.existing.status,
            `Updated observation: ${upd.next.evidence}`,
            JSON.stringify({ previousEvidence: upd.existing.evidence }),
            nowIso
          );
      }
    }

    for (const clr of plan.toClear) {
      this.db
        .prepare(
          `UPDATE findings SET detection_state = 'Cleared', updated_at = ? WHERE id = ?`
        )
        .run(clr.clearedAt, clr.existing.id);

      this.db
        .prepare(
          `INSERT INTO remediation_history (id, finding_id, workspace_id, actor_email, action, from_status, to_status, note, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `rh-${randomUUID()}`,
          clr.existing.id,
          workspaceId,
          actorEmail,
          'detection_cleared',
          clr.existing.status,
          clr.existing.status,
          'Updated asset metadata no longer triggers this rule. Manual remediation status preserved.',
          null,
          clr.clearedAt
        );
    }
  }

  public listImports(workspaceId: string): ImportRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM imports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.mapImport(r));
  }

  public listAllFindings(workspaceId: string): Finding[] {
    const rows = this.db
      .prepare(
        `SELECT f.*, a.name AS asset_name, a.environment AS asset_environment, a.location AS asset_location, a.fingerprint_sha256 AS asset_fingerprint, a.owner AS asset_owner, ds.name AS asset_source_name
         FROM findings f
         JOIN assets a ON a.id = f.asset_id
         LEFT JOIN data_sources ds ON ds.id = a.source_id
         WHERE f.workspace_id = ?
         ORDER BY CASE f.severity WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, f.last_observed_at DESC`
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.mapFinding(r));
  }

  public queryFindings(
    workspaceId: string,
    params: FindingQueryParams
  ): PaginatedResult<Finding> {
    let list = this.listAllFindings(workspaceId);
    if (params.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      list = list.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.evidence.toLowerCase().includes(q) ||
          f.ruleId.toLowerCase().includes(q) ||
          (f.assetName ?? '').toLowerCase().includes(q) ||
          (f.assignee ?? '').toLowerCase().includes(q) ||
          (f.assetSourceName ?? '').toLowerCase().includes(q)
      );
    }
    if (params.severity && params.severity !== 'all') {
      list = list.filter((f) => f.severity === params.severity);
    }
    if (params.status && params.status !== 'all') {
      list = list.filter((f) => f.status === params.status);
    }
    if (params.detectionState && params.detectionState !== 'all') {
      list = list.filter((f) => f.detectionState === params.detectionState);
    }
    if (params.environment && params.environment !== 'all') {
      list = list.filter((f) => f.assetEnvironment === params.environment);
    }
    if (params.ruleId && params.ruleId !== 'all') {
      list = list.filter((f) => f.ruleId === params.ruleId);
    }

    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const page = Math.max(1, params.page ?? 1);
    const total = list.length;
    const start = (page - 1) * pageSize;
    return {
      items: list.slice(start, start + pageSize),
      total,
      page,
      pageSize,
    };
  }

  public getFindingDetail(workspaceId: string, findingId: string) {
    const row = this.db
      .prepare(
        `SELECT f.*, a.name AS asset_name, a.environment AS asset_environment, a.location AS asset_location, a.fingerprint_sha256 AS asset_fingerprint, a.owner AS asset_owner, ds.name AS asset_source_name
         FROM findings f
         JOIN assets a ON a.id = f.asset_id
         LEFT JOIN data_sources ds ON ds.id = a.source_id
         WHERE f.workspace_id = ? AND f.id = ?`
      )
      .get(workspaceId, findingId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const finding = this.mapFinding(row);

    const assetRow = this.db
      .prepare(
        `SELECT a.*, ds.name AS source_name, ds.provider AS source_provider
         FROM assets a
         LEFT JOIN data_sources ds ON ds.id = a.source_id
         WHERE a.workspace_id = ? AND a.id = ?`
      )
      .get(workspaceId, finding.assetId) as Record<string, unknown>;
    const historyRows = this.db
      .prepare(
        'SELECT * FROM remediation_history WHERE workspace_id = ? AND finding_id = ? ORDER BY created_at DESC'
      )
      .all(workspaceId, findingId) as Record<string, unknown>[];

    return {
      finding,
      asset: this.mapAsset(assetRow),
      history: historyRows.map((h) => ({
        id: String(h.id),
        findingId: String(h.finding_id),
        workspaceId: String(h.workspace_id),
        actorEmail: String(h.actor_email),
        action: String(h.action),
        fromStatus: h.from_status ? (String(h.from_status) as RemediationStatus) : null,
        toStatus: h.to_status ? (String(h.to_status) as RemediationStatus) : null,
        note: h.note ? String(h.note) : null,
        metadataJson: h.metadata_json ? String(h.metadata_json) : null,
        createdAt: String(h.created_at),
      })),
    };
  }

  public updateRemediation(input: UpdateRemediationInput): {
    finding: Finding;
    historyEntry: RemediationHistoryEntry;
  } {
    const nowIso = new Date().toISOString();
    return this.runInTransaction(() => {
      const existingRow = this.db
        .prepare('SELECT * FROM findings WHERE workspace_id = ? AND id = ?')
        .get(input.workspaceId, input.findingId) as Record<string, unknown> | undefined;
      if (!existingRow) {
        throw new Error('Finding not found in workspace');
      }
      const existing = this.mapFinding(existingRow);
      const nextStatus = input.status ?? existing.status;
      const nextAssignee =
        input.assignee !== undefined ? input.assignee : existing.assignee;
      const nextDueDate =
        input.dueDate !== undefined ? input.dueDate : existing.dueDate;
      const nextAcceptedReason =
        nextStatus === 'Accepted risk'
          ? (input.acceptedReason ?? existing.acceptedReason)
          : input.status !== undefined && input.status !== 'Accepted risk'
            ? null
            : existing.acceptedReason;
      const nextAcceptedReviewDate =
        nextStatus === 'Accepted risk'
          ? (input.acceptedReviewDate ?? existing.acceptedReviewDate)
          : input.status !== undefined && input.status !== 'Accepted risk'
            ? null
            : existing.acceptedReviewDate;

      if (nextStatus === 'Accepted risk') {
        if (!nextAcceptedReason || !nextAcceptedReason.trim()) {
          throw new Error('Accepted risk requires a written justification reason.');
        }
        if (!nextAcceptedReviewDate || Number.isNaN(Date.parse(nextAcceptedReviewDate))) {
          throw new Error('Accepted risk requires a valid review date.');
        }
      }

      this.db
        .prepare(
          `UPDATE findings SET
            status = ?, assignee = ?, due_date = ?, accepted_reason = ?, accepted_review_date = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`
        )
        .run(
          nextStatus,
          nextAssignee,
          nextDueDate,
          nextAcceptedReason,
          nextAcceptedReviewDate,
          nowIso,
          input.findingId,
          input.workspaceId
        );

      const historyId = `rh-${randomUUID()}`;
      const changes: string[] = [];
      if (nextStatus !== existing.status) {
        changes.push(`status ${existing.status} -> ${nextStatus}`);
      }
      if (nextAssignee !== existing.assignee) {
        changes.push(`assignee -> ${nextAssignee || 'Unassigned'}`);
      }
      if (nextDueDate !== existing.dueDate) {
        changes.push(`dueDate -> ${nextDueDate || 'Cleared'}`);
      }
      const actionLabel =
        nextStatus !== existing.status ? 'status_changed' : 'remediation_updated';

      this.db
        .prepare(
          `INSERT INTO remediation_history (id, finding_id, workspace_id, actor_email, action, from_status, to_status, note, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          historyId,
          input.findingId,
          input.workspaceId,
          input.actorEmail,
          actionLabel,
          existing.status,
          nextStatus,
          input.note ?? (changes.length > 0 ? changes.join('; ') : 'Updated remediation details'),
          JSON.stringify({
            assignee: nextAssignee,
            dueDate: nextDueDate,
            acceptedReason: nextAcceptedReason,
            acceptedReviewDate: nextAcceptedReviewDate,
          }),
          nowIso
        );

      this.insertAuditEvent({
        workspaceId: input.workspaceId,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
        eventType: 'remediation_updated',
        targetType: 'finding',
        targetId: input.findingId,
        summary: `Updated finding ${existing.ruleId} (${changes.join(', ') || 'note added'})`,
        detailsJson: JSON.stringify({
          fromStatus: existing.status,
          toStatus: nextStatus,
          assignee: nextAssignee,
          dueDate: nextDueDate,
          note: input.note ?? null,
        }),
        createdAt: nowIso,
      });

      const detail = this.getFindingDetail(input.workspaceId, input.findingId);
      if (!detail) throw new Error('Finding missing after update');
      return {
        finding: detail.finding,
        historyEntry: detail.history[0],
      };
    });
  }

  public recordAuditEvent(evt: Omit<AuditEvent, 'id'>): void {
    this.insertAuditEvent(evt);
  }

  private insertAuditEvent(evt: Omit<AuditEvent, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO audit_events (id, workspace_id, actor_email, actor_role, event_type, target_type, target_id, summary, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `aud-${randomUUID()}`,
        evt.workspaceId,
        evt.actorEmail,
        evt.actorRole,
        evt.eventType,
        evt.targetType,
        evt.targetId,
        evt.summary,
        evt.detailsJson,
        evt.createdAt
      );
  }

  public listAuditEvents(workspaceId: string, limit = 100): AuditEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(workspaceId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      actorEmail: String(r.actor_email),
      actorRole: r.actor_role as Role,
      eventType: r.event_type as AuditEvent['eventType'],
      targetType: r.target_type as AuditEvent['targetType'],
      targetId: String(r.target_id),
      summary: String(r.summary),
      detailsJson: r.details_json ? String(r.details_json) : null,
      createdAt: String(r.created_at),
    }));
  }

  // ==================== DATA SOURCES & SYNC RUNS ====================

  public listDataSources(workspaceId: string): DataSource[] {
    const rows = this.db
      .prepare('SELECT * FROM data_sources WHERE workspace_id = ? ORDER BY created_at ASC')
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.mapDataSource(r));
  }

  public listAllConnectedDataSources(): DataSource[] {
    const rows = this.db
      .prepare(
        "SELECT ds.* FROM data_sources ds JOIN workspaces w ON w.id = ds.workspace_id WHERE w.is_sample = 0 AND ds.status != 'setup_required' ORDER BY ds.created_at ASC"
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapDataSource(r));
  }

  public getDataSource(workspaceId: string, sourceId: string): DataSource | null {
    const row = this.db
      .prepare('SELECT * FROM data_sources WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, sourceId) as Record<string, unknown> | undefined;
    return row ? this.mapDataSource(row) : null;
  }

  public getDataSourceById(sourceId: string): DataSource | null {
    const row = this.db
      .prepare('SELECT * FROM data_sources WHERE id = ?')
      .get(sourceId) as Record<string, unknown> | undefined;
    return row ? this.mapDataSource(row) : null;
  }

  public createDataSource(input: CreateDataSourceInput): DataSource {
    const nowIso = new Date().toISOString();
    const id = `src-${randomUUID()}`;
    const externalId =
      input.authMode === 'sts_assume_role'
        ? input.externalId?.trim() || generateExternalId()
        : null;
    const status: DataSourceStatus = input.status ?? 'connected';

    return this.runInTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO data_sources (
            id, workspace_id, provider, name, status, auth_mode, aws_account_id,
            role_arn, external_id, regions_json, environment_default,
            last_checked_regions_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
        )
        .run(
          id,
          input.workspaceId,
          input.provider,
          input.name,
          status,
          input.authMode,
          input.awsAccountId ?? null,
          input.roleArn ?? null,
          externalId,
          JSON.stringify(input.regions),
          input.environmentDefault,
          nowIso,
          nowIso
        );

      this.insertAuditEvent({
        workspaceId: input.workspaceId,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
        eventType: 'data_source_created',
        targetType: 'data_source',
        targetId: id,
        summary: `Configured AWS ACM data source "${input.name}" (${input.authMode}, regions: ${input.regions.join(', ')})`,
        detailsJson: JSON.stringify({
          provider: input.provider,
          authMode: input.authMode,
          awsAccountId: input.awsAccountId ?? null,
          roleArn: input.roleArn ?? null,
          regions: input.regions,
        }),
        createdAt: nowIso,
      });

      const created = this.getDataSource(input.workspaceId, id);
      if (!created) throw new Error('Failed to create data source');
      return created;
    });
  }

  public updateDataSource(input: UpdateDataSourceInput): DataSource {
    const nowIso = new Date().toISOString();
    return this.runInTransaction(() => {
      const existing = this.getDataSource(input.workspaceId, input.sourceId);
      if (!existing) throw new Error('Data source not found in workspace');

      const nextName = input.name ?? existing.name;
      const nextAuthMode = input.authMode ?? existing.authMode;
      const nextAccountId =
        input.awsAccountId !== undefined ? input.awsAccountId : existing.awsAccountId;
      const nextRoleArn =
        nextAuthMode === 'sts_assume_role'
          ? input.roleArn !== undefined
            ? input.roleArn
            : existing.roleArn
          : null;
      const nextExternalId =
        nextAuthMode === 'sts_assume_role'
          ? input.externalId?.trim() || existing.externalId || generateExternalId()
          : null;
      const nextRegions = input.regions ?? existing.regions;
      const nextEnvDefault = input.environmentDefault ?? existing.environmentDefault;
      const nextStatus = input.status ?? existing.status;

      this.db
        .prepare(
          `UPDATE data_sources SET
            name = ?, auth_mode = ?, aws_account_id = ?, role_arn = ?, external_id = ?,
            regions_json = ?, environment_default = ?, status = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`
        )
        .run(
          nextName,
          nextAuthMode,
          nextAccountId,
          nextRoleArn,
          nextExternalId,
          JSON.stringify(nextRegions),
          nextEnvDefault,
          nextStatus,
          nowIso,
          input.sourceId,
          input.workspaceId
        );

      this.insertAuditEvent({
        workspaceId: input.workspaceId,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
        eventType: 'data_source_updated',
        targetType: 'data_source',
        targetId: input.sourceId,
        summary: `Updated data source "${nextName}" (${nextAuthMode}, regions: ${nextRegions.join(', ')})`,
        detailsJson: JSON.stringify({
          authMode: nextAuthMode,
          awsAccountId: nextAccountId,
          roleArn: nextRoleArn,
          regions: nextRegions,
        }),
        createdAt: nowIso,
      });

      const updated = this.getDataSource(input.workspaceId, input.sourceId);
      if (!updated) throw new Error('Data source missing after update');
      return updated;
    });
  }

  public deleteDataSource(
    workspaceId: string,
    sourceId: string,
    actorEmail: string,
    actorRole: Role
  ): void {
    const nowIso = new Date().toISOString();
    this.runInTransaction(() => {
      const existing = this.getDataSource(workspaceId, sourceId);
      if (!existing) throw new Error('Data source not found in workspace');
      // Remove synchronized assets from that source or mark them unlinked? Keep assets if user wants, or delete source rows cleanly.
      // Deleting the data source sets assets.source_id = NULL via ON DELETE SET NULL; remove synced assets belonging exclusively to deleted source:
      this.db
        .prepare('DELETE FROM assets WHERE workspace_id = ? AND source_id = ?')
        .run(workspaceId, sourceId);
      this.db
        .prepare('DELETE FROM data_sources WHERE workspace_id = ? AND id = ?')
        .run(workspaceId, sourceId);

      this.insertAuditEvent({
        workspaceId,
        actorEmail,
        actorRole,
        eventType: 'data_source_deleted',
        targetType: 'data_source',
        targetId: sourceId,
        summary: `Removed data source "${existing.name}" and its synchronized inventory`,
        detailsJson: JSON.stringify({ name: existing.name, provider: existing.provider }),
        createdAt: nowIso,
      });
    });
  }

  public listSyncRuns(workspaceId: string, sourceId?: string, limit = 25): SyncRun[] {
    const rows = sourceId
      ? (this.db
          .prepare(
            'SELECT * FROM sync_runs WHERE workspace_id = ? AND source_id = ? ORDER BY started_at DESC LIMIT ?'
          )
          .all(workspaceId, sourceId, limit) as Record<string, unknown>[])
      : (this.db
          .prepare(
            'SELECT * FROM sync_runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ?'
          )
          .all(workspaceId, limit) as Record<string, unknown>[]);
    return rows.map((r) => this.mapSyncRun(r));
  }

  public hasRunningSyncForSource(sourceId: string): boolean {
    const row = this.db
      .prepare("SELECT id FROM sync_runs WHERE source_id = ? AND status = 'running' LIMIT 1")
      .get(sourceId) as { id: string } | undefined;
    return Boolean(row);
  }

  public startSyncRun(input: {
    workspaceId: string;
    sourceId: string;
    trigger: SyncTrigger;
    actorEmail: string;
    regions: string[];
  }): SyncRun {
    const startedAt = new Date().toISOString();
    const runId = `run-${randomUUID()}`;
    return this.runInTransaction(() => {
      const running = this.db
        .prepare("SELECT id FROM sync_runs WHERE source_id = ? AND status = 'running' LIMIT 1")
        .get(input.sourceId) as { id: string } | undefined;
      if (running) {
        throw new Error('A sync job is already running for this data source.');
      }

      this.db
        .prepare(
          `INSERT INTO sync_runs (
            id, source_id, workspace_id, trigger_type, status, actor_email,
            started_at, regions_checked_json, failed_regions_json
          ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, '[]')`
        )
        .run(
          runId,
          input.sourceId,
          input.workspaceId,
          input.trigger,
          input.actorEmail,
          startedAt,
          JSON.stringify(input.regions)
        );

      this.db
        .prepare(
          `UPDATE data_sources SET status = 'syncing', last_sync_started_at = ?, updated_at = ? WHERE id = ?`
        )
        .run(startedAt, startedAt, input.sourceId);

      const row = this.db
        .prepare('SELECT * FROM sync_runs WHERE id = ?')
        .get(runId) as Record<string, unknown>;
      return this.mapSyncRun(row);
    });
  }

  public applyRegionSyncSuccess(input: {
    workspaceId: string;
    sourceId: string;
    awsRegion: string;
    observedAtIso: string;
    actorEmail: string;
    records: SyncedCertificateCandidate[];
  }): {
    inserted: number;
    updated: number;
    unchanged: number;
    missing: number;
  } {
    const ws = this.getWorkspace(input.workspaceId);
    if (!ws) throw new Error('Workspace not found');
    const nowDate = new Date(input.observedAtIso);

    return this.runInTransaction(() => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      let missing = 0;
      const observedArns = new Set<string>();
      const touchedAssets: CryptoAsset[] = [];

      for (const rec of input.records) {
        observedArns.add(rec.externalArn);
        const dedupeKey = `src:${input.sourceId}|arn:${rec.externalArn}`;

        const existingRow = this.db
          .prepare(
            `SELECT a.*, ds.name AS source_name, ds.provider AS source_provider
             FROM assets a
             LEFT JOIN data_sources ds ON ds.id = a.source_id
             WHERE a.workspace_id = ? AND a.dedupe_key = ?`
          )
          .get(input.workspaceId, dedupeKey) as Record<string, unknown> | undefined;

        if (!existingRow) {
          const assetId = `ast-${randomUUID()}`;
          this.db
            .prepare(
              `INSERT INTO assets (
                id, workspace_id, dedupe_key, source_record_id, fingerprint_sha256,
                name, asset_type, environment, location, subject, issuer, serial_number,
                algorithm, key_size, signature_algorithm, valid_from, valid_to, owner,
                san_list_json, source_import_id, source_id, external_arn, aws_account_id,
                aws_region, acm_status, in_use_by_json, last_observed_at,
                missing_from_source, change_summary, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
            )
            .run(
              assetId,
              input.workspaceId,
              dedupeKey,
              rec.externalArn,
              rec.candidate.fingerprintSha256,
              rec.candidate.name,
              rec.candidate.assetType,
              rec.candidate.environment,
              rec.candidate.location,
              rec.candidate.subject,
              rec.candidate.issuer,
              rec.candidate.serialNumber,
              rec.candidate.algorithm,
              rec.candidate.keySize,
              rec.candidate.signatureAlgorithm,
              rec.candidate.validFrom,
              rec.candidate.validTo,
              rec.candidate.owner,
              JSON.stringify(rec.candidate.sanList),
              input.sourceId,
              rec.externalArn,
              rec.awsAccountId,
              rec.awsRegion,
              rec.acmStatus,
              JSON.stringify(rec.inUseBy),
              input.observedAtIso,
              'Initial discovery from AWS ACM',
              input.observedAtIso,
              input.observedAtIso
            );
          inserted += 1;
          const insertedRow = this.db
            .prepare(
              `SELECT a.*, ds.name AS source_name, ds.provider AS source_provider
               FROM assets a LEFT JOIN data_sources ds ON ds.id = a.source_id WHERE a.id = ?`
            )
            .get(assetId) as Record<string, unknown>;
          touchedAssets.push(this.mapAsset(insertedRow));
        } else {
          const existing = this.mapAsset(existingRow);
          const diffs = computeSyncedChanges(rec, existing);
          // Preserve locally assigned owner if source provides null
          const resolvedOwner = rec.candidate.owner ?? existing.owner;
          if (diffs.length > 0) {
            const changeSummary = `Detected changes (${input.observedAtIso.slice(0, 10)}): ${diffs.join(', ')}`;
            this.db
              .prepare(
                `UPDATE assets SET
                  name = ?, location = ?, subject = ?, issuer = ?, serial_number = ?,
                  algorithm = ?, key_size = ?, signature_algorithm = ?,
                  valid_from = ?, valid_to = ?, owner = ?, san_list_json = ?,
                  aws_account_id = ?, aws_region = ?, acm_status = ?, in_use_by_json = ?,
                  last_observed_at = ?, missing_from_source = 0, change_summary = ?, updated_at = ?
                 WHERE id = ?`
              )
              .run(
                rec.candidate.name,
                rec.candidate.location,
                rec.candidate.subject,
                rec.candidate.issuer,
                rec.candidate.serialNumber,
                rec.candidate.algorithm,
                rec.candidate.keySize,
                rec.candidate.signatureAlgorithm,
                rec.candidate.validFrom,
                rec.candidate.validTo,
                resolvedOwner,
                JSON.stringify(rec.candidate.sanList),
                rec.awsAccountId,
                rec.awsRegion,
                rec.acmStatus,
                JSON.stringify(rec.inUseBy),
                input.observedAtIso,
                changeSummary,
                input.observedAtIso,
                existing.id
              );
            updated += 1;
            const updatedRow = this.db
              .prepare(
                `SELECT a.*, ds.name AS source_name, ds.provider AS source_provider
                 FROM assets a LEFT JOIN data_sources ds ON ds.id = a.source_id WHERE a.id = ?`
              )
              .get(existing.id) as Record<string, unknown>;
            touchedAssets.push(this.mapAsset(updatedRow));
          } else {
            // Unchanged: refresh last_observed_at without altering findings/remediation
            this.db
              .prepare(
                `UPDATE assets SET last_observed_at = ?, missing_from_source = 0 WHERE id = ?`
              )
              .run(input.observedAtIso, existing.id);
            unchanged += 1;
            // Re-run rule evaluation in case UTC time threshold crossed (e.g. entered expiry window)
            const refreshedRow = this.db
              .prepare(
                `SELECT a.*, ds.name AS source_name, ds.provider AS source_provider
                 FROM assets a LEFT JOIN data_sources ds ON ds.id = a.source_id WHERE a.id = ?`
              )
              .get(existing.id) as Record<string, unknown>;
            touchedAssets.push(this.mapAsset(refreshedRow));
          }
        }
      }

      // Only after a complete successful sync of THIS region, mark certificates in THIS region missing
      const existingInRegion = this.db
        .prepare(
          `SELECT id, external_arn, missing_from_source FROM assets
           WHERE workspace_id = ? AND source_id = ? AND aws_region = ?`
        )
        .all(input.workspaceId, input.sourceId, input.awsRegion) as Array<{
        id: string;
        external_arn: string | null;
        missing_from_source: number;
      }>;

      for (const row of existingInRegion) {
        if (row.external_arn && !observedArns.has(row.external_arn)) {
          if (Number(row.missing_from_source ?? 0) === 0) {
            this.db
              .prepare(
                `UPDATE assets SET missing_from_source = 1, change_summary = ?, updated_at = ? WHERE id = ?`
              )
              .run(
                `Missing from ${input.awsRegion} on ${input.observedAtIso.slice(0, 10)} sync`,
                input.observedAtIso,
                row.id
              );
          }
          missing += 1;
        }
      }

      for (const asset of touchedAssets) {
        this.reconcileAssetFindingsInternal(
          input.workspaceId,
          asset,
          ws.settings,
          input.actorEmail,
          nowDate
        );
      }

      return { inserted, updated, unchanged, missing };
    });
  }

  public finalizeSyncRun(input: {
    workspaceId: string;
    sourceId: string;
    runId: string;
    status: SyncRunStatus;
    actorEmail: string;
    actorRole: Role;
    finishedAtIso: string;
    regionsChecked: string[];
    failedRegions: SyncRunRegionFailure[];
    insertedCount: number;
    updatedCount: number;
    unchangedCount: number;
    missingCount: number;
    totalObserved: number;
    resolvedAccountId?: string | null;
    errorMessage: string | null;
  }): { run: SyncRun; source: DataSource } {
    return this.runInTransaction(() => {
      const existingSource = this.getDataSource(input.workspaceId, input.sourceId);
      if (!existingSource) throw new Error('Data source not found');

      this.db
        .prepare(
          `UPDATE sync_runs SET
            status = ?, finished_at = ?, regions_checked_json = ?, failed_regions_json = ?,
            inserted_count = ?, updated_count = ?, unchanged_count = ?, missing_count = ?,
            total_observed = ?, error_message = ?
           WHERE id = ?`
        )
        .run(
          input.status,
          input.finishedAtIso,
          JSON.stringify(input.regionsChecked),
          JSON.stringify(input.failedRegions),
          input.insertedCount,
          input.updatedCount,
          input.unchangedCount,
          input.missingCount,
          input.totalObserved,
          input.errorMessage,
          input.runId
        );

      const sourceSucceededAtLeastPartially =
        input.status === 'completed' || input.status === 'partial';
      const nextSourceStatus: DataSourceStatus =
        input.status === 'failed' ? 'failed' : 'connected';
      const nextSuccessfulSyncAt = sourceSucceededAtLeastPartially
        ? input.finishedAtIso
        : existingSource.lastSuccessfulSyncAt;
      const nextCounts = sourceSucceededAtLeastPartially
        ? {
            inserted: input.insertedCount,
            updated: input.updatedCount,
            unchanged: input.unchangedCount,
            missing: input.missingCount,
            totalObserved: input.totalObserved,
          }
        : existingSource.lastSyncCounts;

      this.db
        .prepare(
          `UPDATE data_sources SET
            status = ?,
            aws_account_id = COALESCE(?, aws_account_id),
            last_sync_finished_at = ?,
            last_successful_sync_at = ?,
            last_sync_error = ?,
            last_checked_regions_json = ?,
            last_sync_counts_json = ?,
            updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextSourceStatus,
          input.resolvedAccountId ?? null,
          input.finishedAtIso,
          nextSuccessfulSyncAt,
          input.errorMessage,
          JSON.stringify(input.regionsChecked),
          nextCounts ? JSON.stringify(nextCounts) : null,
          input.finishedAtIso,
          input.sourceId
        );

      this.insertAuditEvent({
        workspaceId: input.workspaceId,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
        eventType: input.status === 'failed' ? 'sync_failed' : 'sync_completed',
        targetType: 'sync_run',
        targetId: input.runId,
        summary:
          input.status === 'failed'
            ? `AWS ACM sync failed for "${existingSource.name}": ${input.errorMessage ?? 'Unknown error'}`
            : `AWS ACM sync ${input.status} for "${existingSource.name}" (${input.totalObserved} observed: ${input.insertedCount} inserted, ${input.updatedCount} updated, ${input.missingCount} missing)`,
        detailsJson: JSON.stringify({
          sourceId: input.sourceId,
          status: input.status,
          regionsChecked: input.regionsChecked,
          failedRegions: input.failedRegions,
          errorMessage: input.errorMessage,
        }),
        createdAt: input.finishedAtIso,
      });

      const runRow = this.db
        .prepare('SELECT * FROM sync_runs WHERE id = ?')
        .get(input.runId) as Record<string, unknown>;
      const updatedSource = this.getDataSource(input.workspaceId, input.sourceId);
      if (!updatedSource) throw new Error('Data source missing after sync');

      return {
        run: this.mapSyncRun(runRow),
        source: updatedSource,
      };
    });
  }

  public resetSampleWorkspace(actorEmail: string): void {
    this.runInTransaction(() => {
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(SAMPLE_WORKSPACE_ID);
      this.seedSampleWorkspaceInternal(actorEmail, true);
    });
  }

  private seedSampleWorkspace(actorEmail: string): void {
    this.runInTransaction(() => {
      this.seedSampleWorkspaceInternal(actorEmail, false);
    });
  }

  private seedSampleWorkspaceInternal(actorEmail: string, isReset: boolean): void {
    const now = new Date();
    const nowIso = now.toISOString();
    const seed = buildSampleWorkspaceSeed(now);

    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, slug, is_sample, expiry_warning_days, min_rsa_key_bits, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        seed.workspace.id,
        seed.workspace.name,
        seed.workspace.slug,
        1,
        seed.workspace.settings.expiryWarningDays,
        seed.workspace.settings.minRsaKeyBits,
        seed.workspace.createdAt
      );

    for (const m of seed.members) {
      this.db
        .prepare(
          `INSERT INTO workspace_members (id, workspace_id, email, name, role, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(m.id, m.workspaceId, m.email, m.name, m.role, m.createdAt);
    }

    this.db
      .prepare(
        `INSERT INTO imports (id, workspace_id, filename, format, actor_email, inserted_count, updated_count, skipped_count, rejected_count, status, summary_note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        seed.initialImport.id,
        seed.initialImport.workspaceId,
        seed.initialImport.filename,
        seed.initialImport.format,
        seed.initialImport.actorEmail,
        seed.initialImport.insertedCount,
        seed.initialImport.updatedCount,
        seed.initialImport.skippedCount,
        seed.initialImport.rejectedCount,
        seed.initialImport.status,
        seed.initialImport.summaryNote,
        seed.initialImport.createdAt
      );

    for (const candidate of seed.candidates) {
      const assetId = `ast-${randomUUID()}`;
      const dedupeKey = buildDedupeKey(candidate);
      this.db
        .prepare(
          `INSERT INTO assets (
            id, workspace_id, dedupe_key, source_record_id, fingerprint_sha256,
            name, asset_type, environment, location, subject, issuer, serial_number,
            algorithm, key_size, signature_algorithm, valid_from, valid_to, owner,
            san_list_json, source_import_id, last_observed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          assetId,
          SAMPLE_WORKSPACE_ID,
          dedupeKey,
          candidate.sourceRecordId,
          candidate.fingerprintSha256,
          candidate.name,
          candidate.assetType,
          candidate.environment,
          candidate.location,
          candidate.subject,
          candidate.issuer,
          candidate.serialNumber,
          candidate.algorithm,
          candidate.keySize,
          candidate.signatureAlgorithm,
          candidate.validFrom,
          candidate.validTo,
          candidate.owner,
          JSON.stringify(candidate.sanList),
          seed.initialImport.id,
          seed.initialImport.createdAt,
          seed.initialImport.createdAt,
          seed.initialImport.createdAt
        );

      const assetRow = this.db
        .prepare('SELECT * FROM assets WHERE id = ?')
        .get(assetId) as Record<string, unknown>;
      this.reconcileAssetFindingsInternal(
        SAMPLE_WORKSPACE_ID,
        this.mapAsset(assetRow),
        seed.workspace.settings,
        seed.initialImport.actorEmail,
        now
      );
    }

    const partnerFinding = this.db
      .prepare(
        `SELECT f.id FROM findings f JOIN assets a ON a.id = f.asset_id
         WHERE f.workspace_id = ? AND a.name = 'partner-webhook-ingress.example' AND f.rule_id = 'EXPIRING_SOON'`
      )
      .get(SAMPLE_WORKSPACE_ID) as { id: string } | undefined;

    if (partnerFinding) {
      const dueIso = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
      this.db
        .prepare(
          `UPDATE findings SET status = 'In progress', assignee = 'Integrations Squad', due_date = ?, updated_at = ? WHERE id = ?`
        )
        .run(dueIso, nowIso, partnerFinding.id);
      this.db
        .prepare(
          `INSERT INTO remediation_history (id, finding_id, workspace_id, actor_email, action, from_status, to_status, note, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `rh-${randomUUID()}`,
          partnerFinding.id,
          SAMPLE_WORKSPACE_ID,
          'analyst@sample.ecdat.local',
          'status_changed',
          'Open',
          'In progress',
          'ACME renewal ticket opened with Integrations Squad.',
          null,
          nowIso
        );
    }

    this.insertAuditEvent({
      workspaceId: SAMPLE_WORKSPACE_ID,
      actorEmail,
      actorRole: 'Analyst',
      eventType: isReset ? 'sample_reset' : 'import_confirmed',
      targetType: isReset ? 'workspace' : 'import',
      targetId: isReset ? SAMPLE_WORKSPACE_ID : seed.initialImport.id,
      summary: isReset
        ? 'Sample workspace reset to clean fictional baseline (10 assets)'
        : 'Initialized Northstar Sample Workspace with 10 fictional cryptographic assets',
      detailsJson: null,
      createdAt: nowIso,
    });
  }

  public ensureEnterpriseWorkspace(ws: Workspace, members: WorkspaceMember[]): void {
    this.runInTransaction(() => {
      const existing = this.getWorkspace(ws.id);
      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO workspaces (id, name, slug, is_sample, expiry_warning_days, min_rsa_key_bits, created_at)
             VALUES (?, ?, ?, 0, ?, ?, ?)`
          )
          .run(
            ws.id,
            ws.name,
            ws.slug,
            ws.settings.expiryWarningDays,
            ws.settings.minRsaKeyBits,
            ws.createdAt
          );
      }
      for (const m of members) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO workspace_members (id, workspace_id, email, name, role, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(m.id, ws.id, m.email, m.name, m.role, m.createdAt);
      }
    });
  }
}

export function createEcdatStore(dbPath?: string): EcdatStore {
  const resolved =
    dbPath || process.env.ECDAT_DB_PATH || path.resolve(process.cwd(), 'data', 'ecdat.sqlite');
  const store = new SqliteStore(resolved);
  store.init();
  return store;
}
