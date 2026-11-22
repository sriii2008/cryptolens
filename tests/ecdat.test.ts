import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  parseStructuredMetadataImport,
  parseX509CertificatePayload,
} from '../server/crypto-parser.ts';
import { buildCsvDocument, escapeCsvFormula } from '../server/csv-utils.ts';
import { evaluateAssetRules, reconcileFindingsForAsset } from '../server/rules-engine.ts';
import { SqliteStore } from '../server/store.ts';
import { DataSourceSyncService } from '../server/sync-service.ts';
import { LIVE_WORKSPACE_ID, SAMPLE_WORKSPACE_ID } from '../server/seed-data.ts';
import type { AwsConnectorClients } from '../server/aws-acm.ts';
import type { CertificateDetail, CertificateSummary } from '@aws-sdk/client-acm';
import { hashPasswordScrypt, signEnterpriseToken } from '../server/auth.ts';
import { createApiRouter } from '../server/routes.ts';

function tempDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecdat-test-'));
  return path.join(dir, `${name}.sqlite`);
}

test('CSV formula injection escaping prefixes dangerous spreadsheet characters', () => {
  assert.equal(escapeCsvFormula('=cmd|"/C calc"!A0'), `'=cmd|"/C calc"!A0`);
  assert.equal(escapeCsvFormula('+1234'), `'+1234`);
  assert.equal(escapeCsvFormula('-1+1'), `'-1+1`);
  assert.equal(escapeCsvFormula('@SUM(A1:A2)'), `'@SUM(A1:A2)`);
  assert.equal(escapeCsvFormula('\t=HYPERLINK()'), `'\t=HYPERLINK()`);
  assert.equal(escapeCsvFormula(' =1+1'), `' =1+1`);
  assert.equal(escapeCsvFormula('normal-host.example'), 'normal-host.example');

  const csv = buildCsvDocument(['Name', 'Note'], [['=1+1', 'safe, "quoted"']]);
  assert.match(csv, /^Name,Note\r\n'=1\+1,"safe, ""quoted"""$/);
});

test('X.509 parser reads public PEM fixture and rejects private keys and URLs', () => {
  const pemPath = path.resolve(process.cwd(), 'fixtures', 'sample-public-cert.pem');
  const pem = fs.readFileSync(pemPath, 'utf8');

  const parsed = parseX509CertificatePayload(pem, 'pem', 'sample-public-cert.pem', {
    environment: 'production',
    location: 'us-east-1/edge-gw',
    owner: 'Edge SRE',
  });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].name, 'edge-gateway.demo.example');
  assert.equal(parsed.candidates[0].algorithm, 'RSA');
  assert.equal(parsed.candidates[0].keySize, 2048);
  assert.equal(parsed.candidates[0].signatureAlgorithm, 'SHA256withRSA');
  assert.match(parsed.candidates[0].fingerprintSha256 ?? '', /^[a-f0-9]{64}$/);

  const privKeyReject = parseX509CertificatePayload(
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg==\n-----END PRIVATE KEY-----',
    'pem',
    'secret.pem'
  );
  assert.equal(privKeyReject.candidates.length, 0);
  assert.match(privKeyReject.errors[0].message, /Private key material detected/i);

  const urlReject = parseX509CertificatePayload(pem, 'pem', 'sample-public-cert.pem', {
    location: 'https://evil.example/fetch',
  });
  assert.equal(urlReject.candidates.length, 0);
  assert.match(urlReject.errors[0].message, /URLs are rejected/i);
});

test('Structured CSV/JSON parser reports row-level errors and rejects malformed inputs', () => {
  const csv = [
    'name,location,algorithm,key_size,valid_to,owner',
    'valid.example,us-east-1/lb,RSA,2048,2027-01-01T00:00:00Z,Platform',
    'bad-date.example,us-east-1/lb,RSA,2048,not-a-date,Platform',
    'bad-url.example,https://internal.local/path,RSA,2048,2027-01-01T00:00:00Z,Platform',
  ].join('\n');

  const result = parseStructuredMetadataImport('csv', csv);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].rowNumber, 3);
  assert.equal(result.errors[1].rowNumber, 4);
});

test('Deterministic rules engine evaluates UTC expiry, weak RSA, legacy SHA1, and missing owner', () => {
  const now = new Date('2026-11-22T00:00:00.000Z');
  const settings = { expiryWarningDays: 30, minRsaKeyBits: 2048 };

  const observations = evaluateAssetRules(
    {
      name: 'legacy-gw.example',
      assetType: 'certificate',
      environment: 'production',
      algorithm: 'RSA',
      keySize: 1024,
      signatureAlgorithm: 'SHA1withRSA',
      validTo: '2026-11-10T00:00:00.000Z',
      owner: null,
      fingerprintSha256: null,
    },
    settings,
    now
  );

  const ruleIds = observations.map((o) => o.ruleId).sort();
  assert.deepEqual(ruleIds, [
    'EXPIRED_CERT',
    'LEGACY_SIGNATURE_ALG',
    'MISSING_OWNER',
    'WEAK_RSA_KEY',
  ]);
  assert.equal(observations.find((o) => o.ruleId === 'EXPIRED_CERT')?.severity, 'High');
  assert.equal(observations.find((o) => o.ruleId === 'MISSING_OWNER')?.severity, 'Medium');
});

test('Reconcile findings preserves manual remediation status separately from detectionState', () => {
  const now = new Date('2026-11-22T00:00:00.000Z');
  const settings = { expiryWarningDays: 30, minRsaKeyBits: 2048 };
  const asset = {
    id: 'ast-1',
    workspaceId: 'ws-sample',
    sourceRecordId: null,
    fingerprintSha256: null,
    name: 'gw.example',
    assetType: 'certificate' as const,
    environment: 'production' as const,
    location: 'us-east-1/lb',
    subject: null,
    issuer: null,
    serialNumber: null,
    algorithm: 'RSA',
    keySize: 2048,
    signatureAlgorithm: 'SHA256withRSA',
    validFrom: null,
    validTo: '2027-06-01T00:00:00.000Z',
    owner: 'NetSec Team', // fixed owner!
    sanList: [],
    sourceImportId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const existingFinding = {
    id: 'fnd-1',
    workspaceId: 'ws-sample',
    assetId: 'ast-1',
    ruleId: 'MISSING_OWNER',
    ruleVersion: '1.0.0',
    title: 'Missing asset owner assignment',
    severity: 'Medium' as const,
    rationale: 'r',
    recommendation: 'rec',
    evidence: 'owner=Unknown',
    detectionState: 'Active' as const,
    status: 'In progress' as const,
    assignee: 'alice@corp.example',
    dueDate: null,
    acceptedReason: null,
    acceptedReviewDate: null,
    firstObservedAt: '2026-11-01T00:00:00.000Z',
    lastObservedAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };

  const plan = reconcileFindingsForAsset('ws-sample', asset, [existingFinding], settings, now);
  assert.equal(plan.toClear.length, 1);
  assert.equal(plan.toClear[0].existing.status, 'In progress');
});

test('SqliteStore deduplicates identical reimports, preserves distinct locations, and persists remediation', () => {
  const store = new SqliteStore(tempDbPath('dedupe'));
  store.init();

  const pem = fs.readFileSync(
    path.resolve(process.cwd(), 'fixtures', 'sample-public-cert.pem'),
    'utf8'
  );
  const parsedLocA = parseX509CertificatePayload(pem, 'pem', 'cert.pem', {
    environment: 'production',
    location: 'us-east-1/alb-01',
    owner: 'Edge Team',
  });

  // 1. First import
  const first = store.confirmImport({
    workspaceId: SAMPLE_WORKSPACE_ID,
    filename: 'cert.pem',
    format: 'pem',
    actorEmail: 'analyst@sample.ecdat.local',
    actorRole: 'Analyst',
    candidates: parsedLocA.candidates,
    rejectedCount: 0,
  });
  assert.equal(first.importRecord.insertedCount, 1);
  assert.equal(first.importRecord.skippedCount, 0);

  // 2. Duplicate import same location -> skipped
  const second = store.confirmImport({
    workspaceId: SAMPLE_WORKSPACE_ID,
    filename: 'cert.pem',
    format: 'pem',
    actorEmail: 'analyst@sample.ecdat.local',
    actorRole: 'Analyst',
    candidates: parsedLocA.candidates,
    rejectedCount: 0,
  });
  assert.equal(second.importRecord.insertedCount, 0);
  assert.equal(second.importRecord.skippedCount, 1);

  // 3. Same fingerprint at distinct location -> inserted
  const parsedLocB = parseX509CertificatePayload(pem, 'pem', 'cert.pem', {
    environment: 'staging',
    location: 'eu-west-1/alb-02',
    owner: 'Edge Team',
  });
  const third = store.confirmImport({
    workspaceId: SAMPLE_WORKSPACE_ID,
    filename: 'cert.pem',
    format: 'pem',
    actorEmail: 'analyst@sample.ecdat.local',
    actorRole: 'Analyst',
    candidates: parsedLocB.candidates,
    rejectedCount: 0,
  });
  assert.equal(third.importRecord.insertedCount, 1);

  const assets = store
    .listAllAssets(SAMPLE_WORKSPACE_ID)
    .filter((a) => a.fingerprintSha256 === parsedLocA.candidates[0].fingerprintSha256);
  assert.equal(assets.length, 2);

  // 4. Remediation accepted-risk requires reason + review date
  const findings = store.listAllFindings(SAMPLE_WORKSPACE_ID);
  assert.ok(findings.length > 0);
  const targetFinding = findings[0];
  assert.throws(
    () =>
      store.updateRemediation({
        workspaceId: SAMPLE_WORKSPACE_ID,
        findingId: targetFinding.id,
        actorEmail: 'analyst@sample.ecdat.local',
        actorRole: 'Analyst',
        status: 'Accepted risk',
      }),
    /Accepted risk requires a written justification reason/
  );

  const updated = store.updateRemediation({
    workspaceId: SAMPLE_WORKSPACE_ID,
    findingId: targetFinding.id,
    actorEmail: 'analyst@sample.ecdat.local',
    actorRole: 'Analyst',
    status: 'Accepted risk',
    acceptedReason: 'Compensating mTLS firewall policy active during migration.',
    acceptedReviewDate: '2027-01-15T00:00:00.000Z',
    note: 'Approved by security committee',
  });
  assert.equal(updated.finding.status, 'Accepted risk');

  const audit = store.listAuditEvents(SAMPLE_WORKSPACE_ID);
  assert.ok(audit.some((e) => e.eventType === 'remediation_updated' && e.targetId === targetFinding.id));
});

test('Enterprise RBAC and workspace isolation enforce roles and block unauthorized access', async () => {
  const prevSecret = process.env.ECDAT_ENTERPRISE_AUTH_SECRET;
  const prevUsers = process.env.ECDAT_ENTERPRISE_USERS_JSON;

  try {
    process.env.ECDAT_ENTERPRISE_AUTH_SECRET = 'test-enterprise-secret-key-0123456789';
    const pwHash = hashPasswordScrypt('S3curePass!', '0011223344556677');
    process.env.ECDAT_ENTERPRISE_USERS_JSON = JSON.stringify([
      {
        email: 'viewer@corp.example',
        name: 'Corp Viewer',
        passwordHash: pwHash,
        workspaces: { 'ws-ent-prod': 'Viewer' },
      },
      {
        email: 'admin@corp.example',
        name: 'Corp Admin',
        passwordHash: pwHash,
        workspaces: { 'ws-ent-prod': 'Admin' },
      },
    ]);

    const store = new SqliteStore(tempDbPath('rbac'));
    store.init();
    const nowIso = new Date().toISOString();
    store.ensureEnterpriseWorkspace(
      {
        id: 'ws-ent-prod',
        name: 'Corp Prod',
        slug: 'corp-prod',
        isSample: false,
        settings: { expiryWarningDays: 30, minRsaKeyBits: 2048 },
        createdAt: nowIso,
      },
      [
        {
          id: 'm1',
          workspaceId: 'ws-ent-prod',
          email: 'viewer@corp.example',
          name: 'Corp Viewer',
          role: 'Viewer',
          createdAt: nowIso,
        },
        {
          id: 'm2',
          workspaceId: 'ws-ent-prod',
          email: 'admin@corp.example',
          name: 'Corp Admin',
          role: 'Admin',
          createdAt: nowIso,
        },
      ]
    );
    store.ensureEnterpriseWorkspace(
      {
        id: 'ws-ent-other',
        name: 'Other Org',
        slug: 'other-org',
        isSample: false,
        settings: { expiryWarningDays: 30, minRsaKeyBits: 2048 },
        createdAt: nowIso,
      },
      []
    );

    const app = express();
    app.use('/api', createApiRouter(store));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}/api`;

      // Unauthenticated request to enterprise workspace -> 401
      const unauth = await fetch(`${base}/workspaces/ws-ent-prod/overview`);
      assert.equal(unauth.status, 401);

      const viewerToken = signEnterpriseToken({
        sub: 'viewer@corp.example',
        name: 'Corp Viewer',
        roles: { 'ws-ent-prod': 'Viewer' },
      });

      // Viewer can read allowed workspace
      const viewerRead = await fetch(`${base}/workspaces/ws-ent-prod/overview`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      assert.equal(viewerRead.status, 200);

      // Viewer cannot access isolated second workspace -> 403
      const crossWs = await fetch(`${base}/workspaces/ws-ent-other/overview`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      assert.equal(crossWs.status, 403);

      // Viewer cannot mutate settings or imports -> 403
      const viewerSettings = await fetch(`${base}/workspaces/ws-ent-prod/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${viewerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiryWarningDays: 45, minRsaKeyBits: 2048 }),
      });
      assert.equal(viewerSettings.status, 403);

      // Admin can mutate settings -> 200
      const adminToken = signEnterpriseToken({
        sub: 'admin@corp.example',
        name: 'Corp Admin',
        roles: { 'ws-ent-prod': 'Admin' },
      });
      const adminSettings = await fetch(`${base}/workspaces/ws-ent-prod/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiryWarningDays: 45, minRsaKeyBits: 2048 }),
      });
      assert.equal(adminSettings.status, 200);
    } finally {
      server.close();
    }
  } finally {
    if (prevSecret === undefined) delete process.env.ECDAT_ENTERPRISE_AUTH_SECRET;
    else process.env.ECDAT_ENTERPRISE_AUTH_SECRET = prevSecret;
    if (prevUsers === undefined) delete process.env.ECDAT_ENTERPRISE_USERS_JSON;
    else process.env.ECDAT_ENTERPRISE_USERS_JSON = prevUsers;
  }
});

test('AWS ACM sync paginates regions, includes ACME/EC keys, deduplicates repeats, preserves manual remediation on change, isolates failures, and enforces RBAC & scheduler auth', async () => {
  const prevSecret = process.env.ECDAT_ENTERPRISE_AUTH_SECRET;
  const prevUsers = process.env.ECDAT_ENTERPRISE_USERS_JSON;
  const prevSched = process.env.ECDAT_SCHEDULER_SECRET;

  try {
    process.env.ECDAT_ENTERPRISE_AUTH_SECRET = 'test-enterprise-secret-key-0123456789';
    delete process.env.ECDAT_SCHEDULER_SECRET;

    const nowMs = Date.now();
    const soonDate = new Date(nowMs + 10 * 24 * 60 * 60 * 1000);
    const futureDate = new Date(nowMs + 180 * 24 * 60 * 60 * 1000);
    const issuedDate = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);

    const arnEast1 = 'arn:aws:acm:us-east-1:123456789012:certificate/east-ec-acme-1';
    const arnEast2 = 'arn:aws:acm:us-east-1:123456789012:certificate/east-rsa-2';
    const arnWest1 = 'arn:aws:acm:us-west-2:123456789012:certificate/west-weak-1';

    type MockCertMap = Record<string, CertificateDetail[]>;
    let failAssumeRole = false;
    let failWestRegion = false;
    let capturedListParams: Array<{
      CertificateKeyPairOrigins?: string[];
      Includes?: { keyTypes?: string[] };
    }> = [];

    let regionState: MockCertMap = {
      'us-east-1': [
        {
          CertificateArn: arnEast1,
          DomainName: 'acme-edge.corp.example',
          SubjectAlternativeNames: ['acme-edge.corp.example', '*.acme-edge.corp.example'],
          Subject: 'CN=acme-edge.corp.example',
          Issuer: 'Amazon',
          Serial: 'AA:BB:CC:01',
          Status: 'ISSUED',
          Type: 'AMAZON_ISSUED',
          KeyAlgorithm: 'EC_prime256v1',
          SignatureAlgorithm: 'SHA256WITHECDSA',
          NotBefore: issuedDate,
          NotAfter: soonDate,
          InUseBy: ['arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/edge/1'],
        },
        {
          CertificateArn: arnEast2,
          DomainName: 'api.corp.example',
          SubjectAlternativeNames: ['api.corp.example'],
          Subject: 'CN=api.corp.example',
          Issuer: 'Amazon',
          Serial: 'AA:BB:CC:02',
          Status: 'ISSUED',
          Type: 'AMAZON_ISSUED',
          KeyAlgorithm: 'RSA_2048',
          SignatureAlgorithm: 'SHA256WITHRSA',
          NotBefore: issuedDate,
          NotAfter: futureDate,
          InUseBy: [],
        },
      ],
      'us-west-2': [
        {
          CertificateArn: arnWest1,
          DomainName: 'legacy-west.corp.example',
          SubjectAlternativeNames: ['legacy-west.corp.example'],
          Subject: 'CN=legacy-west.corp.example',
          Issuer: 'Internal Imported CA',
          Serial: 'DD:EE:FF:03',
          Status: 'ISSUED',
          Type: 'IMPORTED',
          KeyAlgorithm: 'RSA_1024',
          SignatureAlgorithm: 'SHA256WITHRSA',
          NotBefore: issuedDate,
          NotAfter: futureDate,
          InUseBy: ['arn:aws:cloudfront::123456789012:distribution/E123456'],
        },
      ],
    };

    const mockClientsFactory = (): AwsConnectorClients => ({
      async getCallerIdentity() {
        return { Account: '999988887777', Arn: 'arn:aws:iam::999988887777:role/ecdat-server' };
      },
      async assumeRole({ externalId, roleArn }) {
        if (failAssumeRole) {
          const err = new Error('User is not authorized to perform: sts:AssumeRole');
          err.name = 'AccessDenied';
          throw err;
        }
        assert.ok(externalId && externalId.length >= 8);
        assert.ok(roleArn.includes(':role/'));
        return {
          credentials: {
            accessKeyId: 'ASIA_TEMP_ACCESS_KEY',
            secretAccessKey: 'temp-secret-key',
            sessionToken: 'temp-session-token',
          },
          assumedRoleArn: 'arn:aws:sts::123456789012:assumed-role/ecdat-readonly/session',
        };
      },
      createAcmClient(region) {
        return {
          async listCertificates(params) {
            capturedListParams.push({
              CertificateKeyPairOrigins: params.CertificateKeyPairOrigins,
              Includes: params.Includes,
            });
            if (region === 'us-west-2' && failWestRegion) {
              const err = new Error('AccessDeniedException: User is not authorized to list certificates in us-west-2');
              err.name = 'AccessDeniedException';
              throw err;
            }
            const list = regionState[region] ?? [];
            // Simulate 1 item per page pagination when > 1 item exists
            if (list.length > 1) {
              if (!params.NextToken) {
                const summary: CertificateSummary = {
                  CertificateArn: list[0].CertificateArn,
                  DomainName: list[0].DomainName,
                  KeyAlgorithm: list[0].KeyAlgorithm,
                  Status: list[0].Status,
                };
                return {
                  CertificateSummaryList: [summary],
                  NextToken: 'page-2',
                  $metadata: {},
                };
              }
              return {
                CertificateSummaryList: list.slice(1).map((c) => ({
                  CertificateArn: c.CertificateArn,
                  DomainName: c.DomainName,
                  KeyAlgorithm: c.KeyAlgorithm,
                  Status: c.Status,
                })),
                $metadata: {},
              };
            }
            return {
              CertificateSummaryList: list.map((c) => ({
                CertificateArn: c.CertificateArn,
                DomainName: c.DomainName,
                KeyAlgorithm: c.KeyAlgorithm,
                Status: c.Status,
              })),
              $metadata: {},
            };
          },
          async describeCertificate(certificateArn) {
            const list = regionState[region] ?? [];
            const found = list.find((c) => c.CertificateArn === certificateArn);
            return { Certificate: found };
          },
        };
      },
    });

    const store = new SqliteStore(tempDbPath('aws-acm-sync'));
    store.init();
    const syncService = new DataSourceSyncService(store, mockClientsFactory);

    const app = express();
    app.use(
      '/api',
      createApiRouter(store, {
        syncService,
        awsClientsFactory: mockClientsFactory,
      })
    );

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}/api`;

      const adminToken = signEnterpriseToken({
        sub: 'admin@corp.example',
        name: 'Corp Admin',
        roles: { [LIVE_WORKSPACE_ID]: 'Admin' },
      });
      const analystToken = signEnterpriseToken({
        sub: 'analyst@corp.example',
        name: 'Corp Analyst',
        roles: { [LIVE_WORKSPACE_ID]: 'Analyst' },
      });
      const viewerToken = signEnterpriseToken({
        sub: 'viewer@corp.example',
        name: 'Corp Viewer',
        roles: { [LIVE_WORKSPACE_ID]: 'Viewer' },
      });

      // 1. RBAC: Viewer & Analyst cannot test or create data sources; Sample cannot attach data sources
      const analystCreate = await fetch(`${base}/workspaces/${LIVE_WORKSPACE_ID}/data-sources`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${analystToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Blocked',
          authMode: 'sts_assume_role',
          roleArn: 'arn:aws:iam::123456789012:role/ecdat-acm-readonly',
          externalId: 'ecdat-ext-blocked-01',
          regions: ['us-east-1'],
        }),
      });
      assert.equal(analystCreate.status, 403);

      const sampleCreate = await fetch(`${base}/workspaces/${SAMPLE_WORKSPACE_ID}/data-sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Blocked Sample',
          authMode: 'workload_identity',
          regions: ['us-east-1'],
        }),
      });
      assert.equal(sampleCreate.status, 403);

      // 2. Admin tests connection -> verifies real provider call + ACME/EC filters
      const testRes = await fetch(`${base}/workspaces/${LIVE_WORKSPACE_ID}/data-sources/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authMode: 'sts_assume_role',
          awsAccountId: '123456789012',
          roleArn: 'arn:aws:iam::123456789012:role/ecdat-acm-readonly',
          externalId: 'ecdat-ext-test-0001',
          regions: ['us-east-1', 'us-west-2'],
        }),
      });
      assert.equal(testRes.status, 200);
      const testBody = (await testRes.json()) as { ok: boolean; resolvedAccountId: string };
      assert.equal(testBody.ok, true);
      assert.equal(testBody.resolvedAccountId, '123456789012');
      assert.ok(
        capturedListParams.some(
          (p) =>
            p.CertificateKeyPairOrigins?.includes('ACME') &&
            p.Includes?.keyTypes?.includes('EC_prime256v1') &&
            p.Includes?.keyTypes?.includes('RSA_1024')
        )
      );

      // 3. Admin saves valid connection -> runs initial sync across both paginated regions
      const createRes = await fetch(`${base}/workspaces/${LIVE_WORKSPACE_ID}/data-sources`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'AWS Prod ACM',
          authMode: 'sts_assume_role',
          awsAccountId: '123456789012',
          roleArn: 'arn:aws:iam::123456789012:role/ecdat-acm-readonly',
          externalId: 'ecdat-ext-prod-0001',
          regions: ['us-east-1', 'us-west-2'],
          environmentDefault: 'production',
        }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as {
        dataSource: { id: string; status: string; lastSuccessfulSyncAt: string | null };
        syncRun: { status: string; insertedCount: number; totalObserved: number };
      };
      assert.equal(created.dataSource.status, 'connected');
      assert.equal(created.syncRun.status, 'completed');
      assert.equal(created.syncRun.insertedCount, 3);
      assert.equal(created.syncRun.totalObserved, 3);
      assert.ok(created.dataSource.lastSuccessfulSyncAt);

      const assetsAfterFirst = store.listAllAssets(LIVE_WORKSPACE_ID);
      assert.equal(assetsAfterFirst.length, 3);
      const acmeCert = assetsAfterFirst.find((a) => a.externalArn === arnEast1)!;
      assert.equal(acmeCert.algorithm, 'ECDSA (P-256)');
      assert.equal(acmeCert.keySize, 256);
      assert.equal(acmeCert.owner, null); // unavailable field left unknown
      assert.equal(acmeCert.sourceName, 'AWS Prod ACM');
      assert.ok(acmeCert.lastObservedAt);

      // Sample workspace stays completely isolated
      assert.ok(
        store.listAllAssets(SAMPLE_WORKSPACE_ID).every((a) => a.externalArn == null)
      );

      // 4. Repeat sync produces zero duplicates
      const repeatSyncRes = await fetch(
        `${base}/workspaces/${LIVE_WORKSPACE_ID}/data-sources/${created.dataSource.id}/sync`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${analystToken}` },
        }
      );
      assert.equal(repeatSyncRes.status, 200);
      const repeatBody = (await repeatSyncRes.json()) as {
        syncRun: { insertedCount: number; updatedCount: number; unchangedCount: number };
      };
      assert.equal(repeatBody.syncRun.insertedCount, 0);
      assert.equal(repeatBody.syncRun.updatedCount, 0);
      assert.equal(repeatBody.syncRun.unchangedCount, 3);
      assert.equal(store.listAllAssets(LIVE_WORKSPACE_ID).length, 3);

      // 5. Assign remediation on WEAK_RSA_KEY finding, then update cert in AWS -> remediation preserved!
      const weakFinding = store
        .listAllFindings(LIVE_WORKSPACE_ID)
        .find((f) => f.ruleId === 'WEAK_RSA_KEY');
      assert.ok(weakFinding);
      store.updateRemediation({
        workspaceId: LIVE_WORKSPACE_ID,
        findingId: weakFinding.id,
        actorEmail: 'analyst@corp.example',
        actorRole: 'Analyst',
        status: 'In progress',
        assignee: 'edge-infra@corp.example',
        note: 'Provisioning RSA 2048 replacement',
      });

      // Mutate west cert to RSA_2048 so WEAK_RSA_KEY clears while remediation remains 'In progress'
      regionState['us-west-2'][0] = {
        ...regionState['us-west-2'][0],
        KeyAlgorithm: 'RSA_2048',
        NotAfter: new Date(nowMs + 250 * 24 * 60 * 60 * 1000),
      };

      const changedSync = await syncService.syncDataSource({
        workspaceId: LIVE_WORKSPACE_ID,
        sourceId: created.dataSource.id,
        trigger: 'manual',
        actorEmail: 'analyst@corp.example',
        actorRole: 'Analyst',
      });
      assert.equal(changedSync.run.updatedCount, 1);
      const updatedWestAsset = store
        .listAllAssets(LIVE_WORKSPACE_ID)
        .find((a) => a.externalArn === arnWest1)!;
      assert.equal(updatedWestAsset.keySize, 2048);
      assert.ok(updatedWestAsset.changeSummary);

      const postChangeFindingDetail = store.getFindingDetail(
        LIVE_WORKSPACE_ID,
        weakFinding.id
      )!;
      assert.equal(postChangeFindingDetail.finding.detectionState, 'Cleared');
      assert.equal(postChangeFindingDetail.finding.status, 'In progress');
      assert.equal(postChangeFindingDetail.finding.assignee, 'edge-infra@corp.example');
      assert.ok(postChangeFindingDetail.history.length >= 2);

      // 6. Partial failure: us-east-1 succeeds without arnEast2 (marked missing), us-west-2 fails (NOT marked missing)
      regionState['us-east-1'] = [regionState['us-east-1'][0]];
      failWestRegion = true;
      const partialSync = await syncService.syncDataSource({
        workspaceId: LIVE_WORKSPACE_ID,
        sourceId: created.dataSource.id,
        trigger: 'manual',
        actorEmail: 'analyst@corp.example',
        actorRole: 'Analyst',
      });
      assert.equal(partialSync.run.status, 'partial');
      assert.equal(partialSync.run.missingCount, 1);

      const assetsAfterPartial = store.listAllAssets(LIVE_WORKSPACE_ID);
      assert.equal(
        assetsAfterPartial.find((a) => a.externalArn === arnEast2)?.missingFromSource,
        true
      );
      assert.equal(
        assetsAfterPartial.find((a) => a.externalArn === arnWest1)?.missingFromSource,
        false
      );

      // 7. Full STS failure preserves existing snapshot untouched and marks source 'failed'
      failAssumeRole = true;
      failWestRegion = false;
      const failedSync = await syncService.syncDataSource({
        workspaceId: LIVE_WORKSPACE_ID,
        sourceId: created.dataSource.id,
        trigger: 'manual',
        actorEmail: 'analyst@corp.example',
        actorRole: 'Analyst',
      });
      assert.equal(failedSync.run.status, 'failed');
      assert.equal(failedSync.source.status, 'failed');
      assert.equal(store.listAllAssets(LIVE_WORKSPACE_ID).length, 3);

      // 8. Empty AWS account finishes completed with 0 certs and checked regions recorded
      failAssumeRole = false;
      regionState = { 'us-east-1': [], 'us-west-2': [] };
      const emptySync = await syncService.syncDataSource({
        workspaceId: LIVE_WORKSPACE_ID,
        sourceId: created.dataSource.id,
        trigger: 'manual',
        actorEmail: 'analyst@corp.example',
        actorRole: 'Analyst',
      });
      assert.equal(emptySync.run.status, 'completed');
      assert.equal(emptySync.run.totalObserved, 0);
      assert.deepEqual(emptySync.run.regionsChecked, ['us-east-1', 'us-west-2']);

      // 9. Scheduled sync endpoint requires valid ECDAT_SCHEDULER_SECRET
      const unconfSched = await fetch(`${base}/internal/scheduled-sync`, { method: 'POST' });
      assert.equal(unconfSched.status, 503);

      process.env.ECDAT_SCHEDULER_SECRET = 'super-secret-scheduler-token-12345';
      const badSched = await fetch(`${base}/internal/scheduled-sync`, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
      });
      assert.equal(badSched.status, 401);

      const okSched = await fetch(`${base}/internal/scheduled-sync`, {
        method: 'POST',
        headers: { Authorization: 'Bearer super-secret-scheduler-token-12345' },
      });
      assert.equal(okSched.status, 200);
      const schedBody = (await okSched.json()) as {
        sourcesProcessed: number;
        results: Array<{ sourceId: string; status: string }>;
      };
      assert.equal(schedBody.sourcesProcessed, 1);
      assert.equal(schedBody.results[0].status, 'completed');

      // 10. CSV Export includes Source and Last Observed (UTC) headers & Viewer can download
      const csvRes = await fetch(
        `${base}/workspaces/${LIVE_WORKSPACE_ID}/reports/export.csv?type=assets`,
        { headers: { Authorization: `Bearer ${viewerToken}` } }
      );
      assert.equal(csvRes.status, 200);
      const csvText = await csvRes.text();
      assert.match(csvText, /Name,Source,Last Observed \(UTC\),Type/);
    } finally {
      server.close();
    }
  } finally {
    if (prevSecret === undefined) delete process.env.ECDAT_ENTERPRISE_AUTH_SECRET;
    else process.env.ECDAT_ENTERPRISE_AUTH_SECRET = prevSecret;
    if (prevUsers === undefined) delete process.env.ECDAT_ENTERPRISE_USERS_JSON;
    else process.env.ECDAT_ENTERPRISE_USERS_JSON = prevUsers;
    if (prevSched === undefined) delete process.env.ECDAT_SCHEDULER_SECRET;
    else process.env.ECDAT_SCHEDULER_SECRET = prevSched;
  }
});
