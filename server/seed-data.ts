import { createHash } from 'node:crypto';
import type {
  CryptoAsset,
  ImportRecord,
  ParsedCandidateAsset,
  RuleThresholdSettings,
  Workspace,
  WorkspaceMember,
} from '../shared/types.ts';

export const SAMPLE_WORKSPACE_ID = 'ws-sample';
export const LIVE_WORKSPACE_ID = 'ws-live';

export const DEFAULT_RULE_SETTINGS: RuleThresholdSettings = {
  expiryWarningDays: 30,
  minRsaKeyBits: 2048,
};

function addDaysUtc(base: Date, days: number): string {
  const d = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function deterministicFingerprint(label: string): string {
  return createHash('sha256').update(`ecdat-sample:${label}`).digest('hex');
}

export function buildSampleWorkspaceSeed(now: Date = new Date()): {
  workspace: Workspace;
  members: WorkspaceMember[];
  initialImport: ImportRecord;
  candidates: ParsedCandidateAsset[];
} {
  const createdAt = addDaysUtc(now, -30);

  const workspace: Workspace = {
    id: SAMPLE_WORKSPACE_ID,
    name: 'Northstar Sample Workspace',
    slug: 'sample-workspace',
    isSample: true,
    settings: { ...DEFAULT_RULE_SETTINGS },
    createdAt,
  };

  const members: WorkspaceMember[] = [
    {
      id: 'mem-sample-1',
      workspaceId: SAMPLE_WORKSPACE_ID,
      email: 'analyst@sample.ecdat.local',
      name: 'Local Sample Analyst',
      role: 'Analyst',
      createdAt,
    },
    {
      id: 'mem-sample-2',
      workspaceId: SAMPLE_WORKSPACE_ID,
      email: 'sec-admin@sample.ecdat.local',
      name: 'Sample Security Admin',
      role: 'Admin',
      createdAt,
    },
  ];

  const initialImport: ImportRecord = {
    id: 'imp-sample-seed-01',
    workspaceId: SAMPLE_WORKSPACE_ID,
    filename: 'northstar-sample-inventory.json',
    format: 'json',
    actorEmail: 'analyst@sample.ecdat.local',
    insertedCount: 10,
    updatedCount: 0,
    skippedCount: 0,
    rejectedCount: 0,
    status: 'completed',
    summaryNote: 'Initial sample dataset loaded (fictional records)',
    createdAt: addDaysUtc(now, -2),
  };

  const candidates: ParsedCandidateAsset[] = [
    {
      sourceRecordId: 'sample-cert-001',
      fingerprintSha256: deterministicFingerprint('api-gateway.internal.example'),
      name: 'api-gateway.internal.example',
      assetType: 'certificate',
      environment: 'production',
      location: 'us-east-1/alb-edge-prod-01',
      subject: 'CN=api-gateway.internal.example, O=Northstar Sample Org',
      issuer: 'CN=Northstar Internal Issuing CA G2, O=Northstar Sample Org',
      serialNumber: '4A19F802C31100E4',
      algorithm: 'ECDSA (P-256)',
      keySize: 256,
      signatureAlgorithm: 'SHA256withECDSA',
      validFrom: addDaysUtc(now, -170),
      validTo: addDaysUtc(now, 195),
      owner: 'Platform Edge Team',
      sanList: ['api-gateway.internal.example', 'api-v2.internal.example'],
    },
    {
      sourceRecordId: 'sample-cert-002',
      fingerprintSha256: deterministicFingerprint('legacy-billing-edge.example'),
      name: 'legacy-billing-edge.example',
      assetType: 'certificate',
      environment: 'production',
      location: 'us-west-2/nginx-billing-04',
      subject: 'CN=legacy-billing-edge.example, O=Northstar Sample Org',
      issuer: 'CN=Northstar External RSA CA, O=Northstar Sample Org',
      serialNumber: '19B03C7710A2981D',
      algorithm: 'RSA',
      keySize: 2048,
      signatureAlgorithm: 'SHA256withRSA',
      validFrom: addDaysUtc(now, -379),
      validTo: addDaysUtc(now, -14),
      owner: 'Payments Core',
      sanList: ['legacy-billing-edge.example'],
    },
    {
      sourceRecordId: 'sample-cert-003',
      fingerprintSha256: deterministicFingerprint('partner-webhook-ingress.example'),
      name: 'partner-webhook-ingress.example',
      assetType: 'certificate',
      environment: 'production',
      location: 'eu-central-1/ingress-gw-02',
      subject: 'CN=partner-webhook-ingress.example, O=Northstar Sample Org',
      issuer: 'CN=Northstar External RSA CA, O=Northstar Sample Org',
      serialNumber: '77E49A12008812BB',
      algorithm: 'RSA',
      keySize: 2048,
      signatureAlgorithm: 'SHA256withRSA',
      validFrom: addDaysUtc(now, -354),
      validTo: addDaysUtc(now, 11),
      owner: 'Integrations Squad',
      sanList: ['partner-webhook-ingress.example', 'hooks.northstar.example'],
    },
    {
      sourceRecordId: 'sample-cert-004',
      fingerprintSha256: deterministicFingerprint('vpn-concentrator-02.example'),
      name: 'vpn-concentrator-02.example',
      assetType: 'tls_endpoint',
      environment: 'production',
      location: 'dc-iad-01/vpn-gw-02:443',
      subject: 'CN=vpn-concentrator-02.example, OU=Network Ops',
      issuer: 'CN=Northstar Legacy Device CA',
      serialNumber: '0098A1104F2E',
      algorithm: 'RSA',
      keySize: 1024,
      signatureAlgorithm: 'SHA256withRSA',
      validFrom: addDaysUtc(now, -270),
      validTo: addDaysUtc(now, 88),
      owner: 'Corporate Network',
      sanList: ['vpn-concentrator-02.example'],
    },
    {
      sourceRecordId: 'sample-cert-005',
      fingerprintSha256: deterministicFingerprint('smtp-relay-legacy.example'),
      name: 'smtp-relay-legacy.example',
      assetType: 'certificate',
      environment: 'staging',
      location: 'us-east-1/postfix-relay-01',
      subject: 'CN=smtp-relay-legacy.example, O=Northstar Sample Org',
      issuer: 'CN=Northstar Legacy Device CA',
      serialNumber: '33C90118BA710012',
      algorithm: 'RSA',
      keySize: 2048,
      signatureAlgorithm: 'SHA1withRSA',
      validFrom: addDaysUtc(now, -313),
      validTo: addDaysUtc(now, 52),
      owner: 'Messaging Infra',
      sanList: ['smtp-relay-legacy.example'],
    },
    {
      sourceRecordId: 'sample-cert-006',
      fingerprintSha256: deterministicFingerprint('dev-sandbox-ingress.example'),
      name: 'dev-sandbox-ingress.example',
      assetType: 'certificate',
      environment: 'development',
      location: 'us-west-2/k8s-dev-ingress',
      subject: 'CN=dev-sandbox-ingress.example, OU=Sandbox',
      issuer: 'CN=Northstar Internal Issuing CA G2, O=Northstar Sample Org',
      serialNumber: '5F810099CA218801',
      algorithm: 'ECDSA (P-256)',
      keySize: 256,
      signatureAlgorithm: 'SHA256withECDSA',
      validFrom: addDaysUtc(now, -60),
      validTo: addDaysUtc(now, 140),
      owner: null,
      sanList: ['dev-sandbox-ingress.example'],
    },
    {
      sourceRecordId: 'kms-key-091',
      fingerprintSha256: null,
      name: 'auth-token-signer-v3',
      assetType: 'kms_key',
      environment: 'production',
      location: 'aws-kms/us-east-1/key-091',
      subject: null,
      issuer: null,
      serialNumber: null,
      algorithm: 'Ed25519',
      keySize: 256,
      signatureAlgorithm: 'Ed25519',
      validFrom: addDaysUtc(now, -55),
      validTo: addDaysUtc(now, 310),
      owner: 'Identity Platform',
      sanList: [],
    },
    {
      sourceRecordId: 'sample-cert-008',
      fingerprintSha256: deterministicFingerprint('checkout-cdn-edge.example'),
      name: 'checkout-cdn-edge.example',
      assetType: 'certificate',
      environment: 'staging',
      location: 'global/cdn-staging-pop',
      subject: 'CN=checkout-cdn-edge.example, O=Northstar Sample Org',
      issuer: 'CN=Northstar External RSA CA, O=Northstar Sample Org',
      serialNumber: '8821DA400192CC11',
      algorithm: 'RSA',
      keySize: 4096,
      signatureAlgorithm: 'SHA384withRSA',
      validFrom: addDaysUtc(now, -341),
      validTo: addDaysUtc(now, 24),
      owner: 'Web Platform',
      sanList: ['checkout-cdn-edge.example'],
    },
    {
      sourceRecordId: 'sample-cert-009',
      fingerprintSha256: deterministicFingerprint('internal-grpc-mesh.example'),
      name: 'internal-grpc-mesh.example',
      assetType: 'tls_endpoint',
      environment: 'production',
      location: 'eu-west-1/istio-ingress-01',
      subject: 'CN=internal-grpc-mesh.example, OU=Service Mesh',
      issuer: 'CN=Northstar Mesh Root G3',
      serialNumber: '90AB112000FF4519',
      algorithm: 'ECDSA (P-384)',
      keySize: 384,
      signatureAlgorithm: 'SHA384withECDSA',
      validFrom: addDaysUtc(now, -90),
      validTo: addDaysUtc(now, 275),
      owner: 'Service Mesh',
      sanList: ['internal-grpc-mesh.example'],
    },
    {
      sourceRecordId: 'sample-cert-010',
      fingerprintSha256: deterministicFingerprint('qa-test-ca-intermediate.example'),
      name: 'qa-test-ca-intermediate.example',
      assetType: 'certificate',
      environment: 'development',
      location: 'us-east-1/qa-vault-pki',
      subject: 'CN=qa-test-ca-intermediate.example',
      issuer: 'CN=Northstar QA Root',
      serialNumber: '12FE883090AA1120',
      algorithm: 'RSA',
      keySize: 2048,
      signatureAlgorithm: 'SHA256withRSA',
      validFrom: addDaysUtc(now, -360),
      validTo: addDaysUtc(now, 5),
      owner: null,
      sanList: ['qa-test-ca-intermediate.example'],
    },
  ];

  return { workspace, members, initialImport, candidates };
}

export function sampleAssetTemplateCsv(): string {
  return [
    'source_record_id,fingerprint_sha256,name,asset_type,environment,location,subject,issuer,serial_number,algorithm,key_size,signature_algorithm,valid_from,valid_to,owner,sans',
    'inv-101,e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855,edge-api.corp.example,certificate,production,us-east-1/alb-01,"CN=edge-api.corp.example, O=Corp","CN=Corp Issuing CA",1A2B3C4D,ECDSA (P-256),256,SHA256withECDSA,2026-01-15T00:00:00Z,2027-01-15T00:00:00Z,Edge SRE,edge-api.corp.example',
    'kms-204,,jwt-signing-primary,kms_key,production,aws-kms/us-west-2/key-204,,,,Ed25519,256,Ed25519,2026-03-01T00:00:00Z,2027-03-01T00:00:00Z,Identity Security,',
  ].join('\r\n');
}

export function buildSampleCsvFixture(now: Date = new Date()): string {
  const validFrom = addDaysUtc(now, -30);
  const expiringSoon = addDaysUtc(now, 14);
  const validLong = addDaysUtc(now, 240);
  return [
    'source_record_id,fingerprint_sha256,name,asset_type,environment,location,subject,issuer,serial_number,algorithm,key_size,signature_algorithm,valid_from,valid_to,owner,sans',
    `csv-import-01,${deterministicFingerprint('partner-portal.sample.example')},partner-portal.sample.example,certificate,production,ap-southeast-1/alb-partner-01,"CN=partner-portal.sample.example, O=Northstar Sample Org","CN=Northstar External RSA CA",71AA00921F,RSA,2048,SHA256withRSA,${validFrom},${expiringSoon},Partner Engineering,partner-portal.sample.example`,
    `csv-import-02,,telemetry-ingest-key,signing_key,staging,gcp-kms/asia-southeast1/ring-02,,,,ECDSA (P-256),256,SHA256withECDSA,${validFrom},${validLong},Observability Team,`,
  ].join('\r\n');
}

export function unusedTypeCheck(_a?: CryptoAsset) {
  return _a;
}
