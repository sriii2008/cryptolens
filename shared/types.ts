export type Role = 'Admin' | 'Analyst' | 'Viewer';

export type EnvironmentType = 'production' | 'staging' | 'development' | 'unknown';

export type AssetType =
  | 'certificate'
  | 'kms_key'
  | 'tls_endpoint'
  | 'signing_key'
  | 'ssh_key'
  | 'unknown';

export type Severity = 'High' | 'Medium' | 'Low';

export type RemediationStatus = 'Open' | 'In progress' | 'Resolved' | 'Accepted risk';

export type DetectionState = 'Active' | 'Cleared';

export type ImportFormat = 'csv' | 'json' | 'pem' | 'der';

export type DataSourceProvider = 'aws_acm';

export type AwsAuthMode = 'workload_identity' | 'sts_assume_role';

export type DataSourceStatus = 'setup_required' | 'connected' | 'syncing' | 'failed';

export type SyncTrigger = 'initial' | 'manual' | 'scheduled';

export type SyncRunStatus = 'running' | 'completed' | 'partial' | 'failed';

export interface RuleThresholdSettings {
  expiryWarningDays: number;
  minRsaKeyBits: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  isSample: boolean;
  settings: RuleThresholdSettings;
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface DataSource {
  id: string;
  workspaceId: string;
  provider: DataSourceProvider;
  name: string;
  status: DataSourceStatus;
  authMode: AwsAuthMode;
  awsAccountId: string | null;
  roleArn: string | null;
  externalId: string | null;
  regions: string[];
  environmentDefault: EnvironmentType;
  lastSyncStartedAt: string | null;
  lastSyncFinishedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncError: string | null;
  lastCheckedRegions: string[];
  lastSyncCounts: {
    inserted: number;
    updated: number;
    unchanged: number;
    missing: number;
    totalObserved: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRunRegionFailure {
  region: string;
  error: string;
}

export interface SyncRun {
  id: string;
  sourceId: string;
  workspaceId: string;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  actorEmail: string;
  startedAt: string;
  finishedAt: string | null;
  regionsChecked: string[];
  failedRegions: SyncRunRegionFailure[];
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  missingCount: number;
  totalObserved: number;
  errorMessage: string | null;
}

export interface SchedulerStatus {
  configured: boolean;
  mode: 'cloud_scheduler' | 'internal_worker' | 'unconfigured';
  intervalHours: number;
  label: string;
}

export interface DataSourcesSummary {
  totalSources: number;
  connectedCount: number;
  syncingCount: number;
  failedCount: number;
  setupRequiredCount: number;
  primarySourceId: string | null;
  primarySourceName: string | null;
  primaryStatus: DataSourceStatus | 'unconfigured';
  lastSuccessfulSyncAt: string | null;
  lastSyncFinishedAt: string | null;
  lastSyncError: string | null;
  isStale: boolean;
  scheduler: SchedulerStatus;
}

export interface CryptoAsset {
  id: string;
  workspaceId: string;
  sourceRecordId: string | null;
  fingerprintSha256: string | null;
  name: string;
  assetType: AssetType;
  environment: EnvironmentType;
  location: string;
  subject: string | null;
  issuer: string | null;
  serialNumber: string | null;
  algorithm: string;
  keySize: number | null;
  signatureAlgorithm: string | null;
  validFrom: string | null;
  validTo: string | null;
  owner: string | null;
  sanList: string[];
  sourceImportId: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceProvider?: DataSourceProvider | null;
  externalArn?: string | null;
  awsAccountId?: string | null;
  awsRegion?: string | null;
  acmStatus?: string | null;
  inUseBy?: string[];
  lastObservedAt?: string | null;
  missingFromSource?: boolean;
  changeSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRecord {
  id: string;
  workspaceId: string;
  filename: string;
  format: ImportFormat;
  actorEmail: string;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  rejectedCount: number;
  status: 'completed' | 'partial';
  summaryNote: string;
  createdAt: string;
}

export interface Finding {
  id: string;
  workspaceId: string;
  assetId: string;
  ruleId: string;
  ruleVersion: string;
  title: string;
  severity: Severity;
  rationale: string;
  recommendation: string;
  evidence: string;
  detectionState: DetectionState;
  status: RemediationStatus;
  assignee: string | null;
  dueDate: string | null;
  acceptedReason: string | null;
  acceptedReviewDate: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  updatedAt: string;
  assetName?: string;
  assetEnvironment?: EnvironmentType;
  assetLocation?: string;
  assetFingerprint?: string | null;
  assetOwner?: string | null;
  assetSourceName?: string | null;
}

export interface RemediationHistoryEntry {
  id: string;
  findingId: string;
  workspaceId: string;
  actorEmail: string;
  action: string;
  fromStatus: RemediationStatus | null;
  toStatus: RemediationStatus | null;
  note: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  workspaceId: string;
  actorEmail: string;
  actorRole: Role;
  eventType:
    | 'import_confirmed'
    | 'remediation_updated'
    | 'settings_updated'
    | 'member_updated'
    | 'sample_reset'
    | 'data_source_created'
    | 'data_source_updated'
    | 'data_source_deleted'
    | 'data_source_tested'
    | 'sync_completed'
    | 'sync_failed';
  targetType: 'import' | 'finding' | 'workspace' | 'member' | 'data_source' | 'sync_run';
  targetId: string;
  summary: string;
  detailsJson: string | null;
  createdAt: string;
}

export interface OverviewStats {
  totalAssets: number;
  expiringSoonCount: number;
  expiredCount: number;
  openHighFindingsCount: number;
  openFindingsCount: number;
  expiryTimeline: Array<{
    bucket: string;
    label: string;
    count: number;
    filterKey: string;
  }>;
  algorithmDistribution: Array<{
    algorithm: string;
    count: number;
    percentage: number;
  }>;
  recentFindings: Finding[];
  recentImports: ImportRecord[];
  recentSyncRuns: SyncRun[];
  dataSourcesSummary: DataSourcesSummary;
  samplePreviewAsset: {
    asset: CryptoAsset;
    topFinding: Finding | null;
  } | null;
}

export interface ParsedCandidateAsset {
  sourceRecordId: string | null;
  fingerprintSha256: string | null;
  name: string;
  assetType: AssetType;
  environment: EnvironmentType;
  location: string;
  subject: string | null;
  issuer: string | null;
  serialNumber: string | null;
  algorithm: string;
  keySize: number | null;
  signatureAlgorithm: string | null;
  validFrom: string | null;
  validTo: string | null;
  owner: string | null;
  sanList: string[];
}

export interface ImportRowValidationError {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ImportPreviewItem {
  rowNumber: number;
  action: 'insert' | 'update' | 'skip';
  reason: string;
  candidate: ParsedCandidateAsset;
}

export interface ImportPreviewResult {
  filename: string;
  format: ImportFormat;
  totalRows: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  rejectedCount: number;
  items: ImportPreviewItem[];
  errors: ImportRowValidationError[];
}

export interface AuthSessionState {
  enterpriseConfigured: boolean;
  authenticated: boolean;
  actorEmail: string | null;
  actorName: string | null;
  workspaces: Array<{
    workspace: Workspace;
    role: Role;
  }>;
}

export interface ConnectionTestResult {
  ok: boolean;
  resolvedAccountId: string | null;
  callerArn: string | null;
  regionsChecked: string[];
  sampleCount: number;
  regionErrors: SyncRunRegionFailure[];
  message: string;
}
