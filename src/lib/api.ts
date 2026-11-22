import type {
  AuditEvent,
  AuthSessionState,
  AwsAuthMode,
  ConnectionTestResult,
  CryptoAsset,
  DataSource,
  DataSourcesSummary,
  EnvironmentType,
  Finding,
  ImportPreviewResult,
  ImportRecord,
  OverviewStats,
  RemediationHistoryEntry,
  RemediationStatus,
  Role,
  RuleThresholdSettings,
  SchedulerStatus,
  SyncRun,
  Workspace,
  WorkspaceMember,
} from '../../shared/types';

// Enterprise bearer token is kept strictly in JS memory (never localStorage/sessionStorage).
let memoryBearerToken: string | null = null;

export function setEnterpriseToken(token: string | null): void {
  memoryBearerToken = token;
}

export function getEnterpriseToken(): string | null {
  return memoryBearerToken;
}

async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (memoryBearerToken) {
    headers.set('Authorization', `Bearer ${memoryBearerToken}`);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const errData = (await res.json()) as { error?: string; message?: string };
      if (errData?.error) message = errData.error;
      else if (errData?.message) message = errData.message;
    } catch {
      // ignore non-json error bodies
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function fetchAuthStatus(): Promise<AuthSessionState> {
  return apiRequest<AuthSessionState>('/api/auth/status');
}

export async function loginEnterprise(
  email: string,
  password: string
): Promise<{ token: string; session: AuthSessionState }> {
  const result = await apiRequest<{ token: string; session: AuthSessionState }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }
  );
  memoryBearerToken = result.token;
  return result;
}

export async function logoutEnterprise(): Promise<void> {
  memoryBearerToken = null;
  await apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

export async function fetchOverview(wsId: string): Promise<OverviewStats> {
  return apiRequest<OverviewStats>(`/api/workspaces/${encodeURIComponent(wsId)}/overview`);
}

// ==================== DATA SOURCES ====================

export interface DataSourcesListResponse {
  workspace: Workspace;
  items: DataSource[];
  recentRuns: SyncRun[];
  scheduler: SchedulerStatus;
  supportedRegions: string[];
  trustedPrincipalArn: string | null;
  suggestedExternalId: string;
  iamPermissionsPolicy: string;
  sampleTrustPolicy: string;
  currentRole: Role;
}

export async function fetchDataSources(wsId: string): Promise<DataSourcesListResponse> {
  return apiRequest<DataSourcesListResponse>(
    `/api/workspaces/${encodeURIComponent(wsId)}/data-sources`
  );
}

export async function testDataSourceConnection(
  wsId: string,
  payload: {
    sourceId?: string;
    authMode: AwsAuthMode;
    awsAccountId?: string | null;
    roleArn?: string | null;
    externalId?: string | null;
    regions: string[];
  }
): Promise<ConnectionTestResult> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (memoryBearerToken) {
    headers.set('Authorization', `Bearer ${memoryBearerToken}`);
  }
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/data-sources/test`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }
  );
  const body = (await res.json()) as ConnectionTestResult & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      resolvedAccountId: body.resolvedAccountId ?? null,
      callerArn: body.callerArn ?? null,
      regionsChecked: body.regionsChecked ?? [],
      sampleCount: body.sampleCount ?? 0,
      regionErrors: body.regionErrors ?? [],
      message: body.message || body.error || `Connection test failed (${res.status})`,
    };
  }
  return body;
}

export async function createDataSource(
  wsId: string,
  payload: {
    provider?: 'aws_acm';
    name: string;
    authMode: AwsAuthMode;
    awsAccountId?: string | null;
    roleArn?: string | null;
    externalId?: string | null;
    regions: string[];
    environmentDefault: EnvironmentType;
  }
): Promise<{
  dataSource: DataSource;
  syncRun: SyncRun;
  testResult: ConnectionTestResult;
}> {
  return apiRequest(`/api/workspaces/${encodeURIComponent(wsId)}/data-sources`, {
    method: 'POST',
    body: JSON.stringify({ provider: 'aws_acm', ...payload }),
  });
}

export async function updateDataSource(
  wsId: string,
  sourceId: string,
  payload: {
    name?: string;
    authMode?: AwsAuthMode;
    awsAccountId?: string | null;
    roleArn?: string | null;
    externalId?: string | null;
    regions?: string[];
    environmentDefault?: EnvironmentType;
  }
): Promise<{ dataSource: DataSource }> {
  return apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/data-sources/${encodeURIComponent(sourceId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteDataSource(wsId: string, sourceId: string): Promise<void> {
  await apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/data-sources/${encodeURIComponent(sourceId)}`,
    {
      method: 'DELETE',
    }
  );
}

export async function syncDataSourceNow(
  wsId: string,
  sourceId: string
): Promise<{ dataSource: DataSource; syncRun: SyncRun }> {
  return apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/data-sources/${encodeURIComponent(sourceId)}/sync`,
    {
      method: 'POST',
    }
  );
}

// ==================== ASSETS & IMPORTS ====================

export interface AssetsFilterQuery {
  search?: string;
  environment?: string;
  assetType?: string;
  algorithm?: string;
  expiration?: string;
  owner?: string;
  sourceId?: string;
  sortBy?: string;
  sortDir?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchAssets(
  wsId: string,
  query: AssetsFilterQuery
): Promise<{ items: CryptoAsset[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== 'all') {
      params.set(k, String(v));
    }
  });
  return apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/assets?${params.toString()}`
  );
}

export async function fetchAssetDetail(
  wsId: string,
  assetId: string
): Promise<{
  asset: CryptoAsset;
  findings: Finding[];
  sourceImport: ImportRecord | null;
  dataSource: DataSource | null;
}> {
  return apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/assets/${encodeURIComponent(assetId)}`
  );
}

export async function fetchImports(wsId: string): Promise<{ items: ImportRecord[] }> {
  return apiRequest(`/api/workspaces/${encodeURIComponent(wsId)}/imports`);
}

export async function previewImportPayload(
  wsId: string,
  payload: {
    filename: string;
    format?: 'csv' | 'json' | 'pem' | 'der';
    content: string;
    defaults?: { environment?: string; location?: string; owner?: string };
  }
): Promise<ImportPreviewResult> {
  return apiRequest(`/api/workspaces/${encodeURIComponent(wsId)}/imports/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function confirmImportPayload(
  wsId: string,
  payload: {
    filename: string;
    format?: 'csv' | 'json' | 'pem' | 'der';
    content: string;
    defaults?: { environment?: string; location?: string; owner?: string };
  }
): Promise<{
  importRecord: ImportRecord;
  assetsAffected: number;
}> {
  return apiRequest(`/api/workspaces/${encodeURIComponent(wsId)}/imports/confirm`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface FindingsFilterQuery {
  search?: string;
  severity?: string;
  status?: string;
  detectionState?: string;
  environment?: string;
  ruleId?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchFindings(
  wsId: string,
  query: FindingsFilterQuery
): Promise<{ items: Finding[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== 'all') {
      params.set(k, String(v));
    }
  });
  return apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/findings?${params.toString()}`
  );
}

export async function fetchFindingDetail(
  wsId: string,
  findingId: string
): Promise<{
  finding: Finding;
  asset: CryptoAsset;
  history: RemediationHistoryEntry[];
}> {
  return apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/findings/${encodeURIComponent(findingId)}`
  );
}

export async function patchFindingRemediation(
  wsId: string,
  findingId: string,
  payload: {
    status?: RemediationStatus;
    assignee?: string | null;
    dueDate?: string | null;
    note?: string | null;
    acceptedReason?: string | null;
    acceptedReviewDate?: string | null;
  }
): Promise<{ finding: Finding; historyEntry: RemediationHistoryEntry }> {
  return apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/findings/${encodeURIComponent(findingId)}/remediation`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
}

export interface ReportSummaryResponse {
  workspace: { id: string; name: string; isSample: boolean };
  dataSourcesSummary?: DataSourcesSummary;
  filters: { environment: string; severity: string; status: string };
  generatedAtUtc: string;
  counts: {
    assets: number;
    findings: number;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
    openFindings: number;
    resolvedFindings: number;
    acceptedRiskFindings: number;
  };
  findings: Finding[];
  assets: CryptoAsset[];
}

export async function fetchReportSummary(
  wsId: string,
  filters: { environment: string; severity: string; status: string }
): Promise<ReportSummaryResponse> {
  const params = new URLSearchParams(filters);
  return apiRequest(
    `/api/workspaces/${encodeURIComponent(wsId)}/reports/summary?${params.toString()}`
  );
}

export async function downloadAuthenticatedCsv(
  url: string,
  fallbackFilename: string
): Promise<void> {
  const headers = new Headers();
  if (memoryBearerToken) {
    headers.set('Authorization', `Bearer ${memoryBearerToken}`);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let msg = `Export failed (${res.status})`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err?.error) msg = err.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = fallbackFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

export async function fetchSettingsAndAudit(wsId: string): Promise<{
  workspace: Workspace;
  members: WorkspaceMember[];
  auditEvents: AuditEvent[];
  storageMode: 'sqlite' | 'file';
  enterpriseAuthConfigured: boolean;
  scheduler: SchedulerStatus;
  currentRole: Role;
}> {
  return apiRequest(`/api/workspaces/${encodeURIComponent(wsId)}/settings`);
}

export async function patchWorkspaceSettings(
  wsId: string,
  settings: RuleThresholdSettings
): Promise<{ workspace: Workspace }> {
  return apiRequest(`/api/workspaces/${encodeURIComponent(wsId)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

export async function upsertWorkspaceMember(
  wsId: string,
  member: { email: string; name: string; role: Role }
): Promise<{ member: WorkspaceMember }> {
  return apiRequest(`/api/workspaces/${encodeURIComponent(wsId)}/members`, {
    method: 'POST',
    body: JSON.stringify(member),
  });
}

export async function resetSampleWorkspace(wsId: string): Promise<void> {
  await apiRequest(`/api/workspaces/${encodeURIComponent(wsId)}/reset-sample`, {
    method: 'POST',
  });
}

export async function fetchSampleFixtureText(
  kind: 'csv' | 'pem'
): Promise<{ filename: string; content: string }> {
  const url =
    kind === 'csv'
      ? '/api/sample-fixtures/sample-inventory.csv'
      : '/api/sample-fixtures/sample-cert.pem';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to load sample fixture.');
  }
  return {
    filename: kind === 'csv' ? 'sample-inventory.csv' : 'sample-public-cert.pem',
    content: await res.text(),
  };
}
