import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  Copy,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  AwsAuthMode,
  ConnectionTestResult,
  DataSource,
  EnvironmentType,
  Role,
  SchedulerStatus,
  SyncRun,
  Workspace,
} from '../../shared/types';
import {
  createDataSource,
  deleteDataSource,
  fetchDataSources,
  syncDataSourceNow,
  testDataSourceConnection,
  updateDataSource,
} from '../lib/api';
import {
  dataSourceStatusBadge,
  formatUtcDate,
  syncRunStatusClass,
} from '../lib/format';

interface DataSourcesViewProps {
  workspaceId: string;
  workspace: Workspace | null;
  currentRole: Role;
  onDataChanged: () => void;
  onOpenEnterpriseModal: () => void;
}

export function DataSourcesView({
  workspaceId,
  workspace,
  currentRole,
  onDataChanged,
  onOpenEnterpriseModal,
}: DataSourcesViewProps) {
  const [items, setItems] = useState<DataSource[]>([]);
  const [recentRuns, setRecentRuns] = useState<SyncRun[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [supportedRegions, setSupportedRegions] = useState<string[]>([
    'us-east-1',
    'us-west-2',
    'eu-west-1',
  ]);
  const [trustedPrincipalArn, setTrustedPrincipalArn] = useState<string | null>(null);
  const [suggestedExternalId, setSuggestedExternalId] = useState<string>('');
  const [iamPermissionsPolicy, setIamPermissionsPolicy] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // Setup Form State
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('AWS ACM Production');
  const [authMode, setAuthMode] = useState<AwsAuthMode>('sts_assume_role');
  const [awsAccountId, setAwsAccountId] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<string[]>(['us-east-1', 'us-west-2']);
  const [customRegion, setCustomRegion] = useState('');
  const [environmentDefault, setEnvironmentDefault] =
    useState<EnvironmentType>('production');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const isSample = workspace?.isSample ?? workspaceId === 'ws-sample';
  const isAdmin = !isSample && currentRole === 'Admin';
  const canSync = !isSample && (currentRole === 'Admin' || currentRole === 'Analyst');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDataSources(workspaceId);
      setItems(res.items);
      setRecentRuns(res.recentRuns);
      setScheduler(res.scheduler);
      setSupportedRegions(res.supportedRegions);
      setTrustedPrincipalArn(res.trustedPrincipalArn);
      setSuggestedExternalId(res.suggestedExternalId);
      setIamPermissionsPolicy(res.iamPermissionsPolicy);
      if (!editingId && !externalId) {
        setExternalId(res.suggestedExternalId);
      }
      if (!isSample && res.items.length === 0 && res.currentRole === 'Admin') {
        setShowForm(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data sources.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, isSample, editingId, externalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyText = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField((prev) => (prev === key ? null : prev)), 2000);
  };

  const toggleRegion = (reg: string) => {
    setTestResult(null);
    setSelectedRegions((prev) =>
      prev.includes(reg) ? prev.filter((r) => r !== reg) : [...prev, reg]
    );
  };

  const addCustomRegion = () => {
    const clean = customRegion.trim().toLowerCase();
    if (!clean) return;
    if (!selectedRegions.includes(clean)) {
      setSelectedRegions((prev) => [...prev, clean]);
    }
    setCustomRegion('');
  };

  const startCreate = () => {
    setEditingId(null);
    setName('AWS ACM Production');
    setAuthMode('sts_assume_role');
    setAwsAccountId('');
    setRoleArn('');
    setExternalId(suggestedExternalId || `ecdat-ext-${Math.random().toString(16).slice(2, 14)}`);
    setSelectedRegions(['us-east-1', 'us-west-2']);
    setEnvironmentDefault('production');
    setTestResult(null);
    setError(null);
    setShowForm(true);
  };

  const startEdit = (src: DataSource) => {
    setEditingId(src.id);
    setName(src.name);
    setAuthMode(src.authMode);
    setAwsAccountId(src.awsAccountId ?? '');
    setRoleArn(src.roleArn ?? '');
    setExternalId(src.externalId ?? suggestedExternalId);
    setSelectedRegions(src.regions);
    setEnvironmentDefault(src.environmentDefault);
    setTestResult(null);
    setError(null);
    setShowForm(true);
  };

  const handleTestConnection = async () => {
    setError(null);
    setTestResult(null);
    setTesting(true);
    try {
      const res = await testDataSourceConnection(workspaceId, {
        sourceId: editingId ?? undefined,
        authMode,
        awsAccountId: awsAccountId.trim() || null,
        roleArn: authMode === 'sts_assume_role' ? roleArn.trim() : null,
        externalId: authMode === 'sts_assume_role' ? externalId.trim() : null,
        regions: selectedRegions,
      });
      setTestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBannerMsg(null);
    setSaving(true);
    try {
      if (editingId) {
        await updateDataSource(workspaceId, editingId, {
          name: name.trim(),
          authMode,
          awsAccountId: awsAccountId.trim() || null,
          roleArn: authMode === 'sts_assume_role' ? roleArn.trim() : null,
          externalId: authMode === 'sts_assume_role' ? externalId.trim() : null,
          regions: selectedRegions,
          environmentDefault,
        });
        setBannerMsg(`Updated data source "${name.trim()}".`);
        setShowForm(false);
        setEditingId(null);
      } else {
        const created = await createDataSource(workspaceId, {
          provider: 'aws_acm',
          name: name.trim(),
          authMode,
          awsAccountId: awsAccountId.trim() || null,
          roleArn: authMode === 'sts_assume_role' ? roleArn.trim() : null,
          externalId: authMode === 'sts_assume_role' ? externalId.trim() : null,
          regions: selectedRegions,
          environmentDefault,
        });
        const run = created.syncRun;
        if (run.status === 'completed' && run.totalObserved === 0) {
          setBannerMsg(
            `Connected "${created.dataSource.name}". Checked ${run.regionsChecked.join(
              ', '
            )}: 0 ACM certificates found in the selected regions.`
          );
        } else {
          setBannerMsg(
            `Connected "${created.dataSource.name}" and completed initial sync (${run.totalObserved} certificate(s) observed across ${run.regionsChecked.join(', ')}).`
          );
        }
        setShowForm(false);
      }
      await load();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save data source.');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async (source: DataSource) => {
    setError(null);
    setBannerMsg(null);
    setSyncingSourceId(source.id);
    try {
      const res = await syncDataSourceNow(workspaceId, source.id);
      if (res.syncRun.status === 'failed') {
        setError(
          `Sync failed for "${source.name}": ${res.syncRun.errorMessage ?? 'Unknown error'}. Previous snapshot preserved.`
        );
      } else if (res.syncRun.totalObserved === 0) {
        setBannerMsg(
          `Sync finished for "${source.name}". Checked ${res.syncRun.regionsChecked.join(
            ', '
          )}: 0 certificates found.`
        );
      } else {
        setBannerMsg(
          `Synced "${source.name}": ${res.syncRun.insertedCount} inserted, ${res.syncRun.updatedCount} updated, ${res.syncRun.unchangedCount} unchanged, ${res.syncRun.missingCount} missing.`
        );
      }
      await load();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger sync.');
    } finally {
      setSyncingSourceId(null);
    }
  };

  const handleDelete = async (sourceId: string) => {
    setError(null);
    try {
      await deleteDataSource(workspaceId, sourceId);
      setConfirmDeleteId(null);
      setBannerMsg('Data source and its synced records removed.');
      await load();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove data source.');
    }
  };

  const trustPolicyJson = JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowECDATCrossAccountReadOnlyAssumeRole',
          Effect: 'Allow',
          Principal: {
            AWS:
              trustedPrincipalArn ||
              'arn:aws:iam::<ECDAT_TRUSTED_ACCOUNT_ID>:role/<ECDAT_SERVER_ROLE>',
          },
          Action: 'sts:AssumeRole',
          Condition: {
            StringEquals: {
              'sts:ExternalId': externalId || suggestedExternalId || '<EXTERNAL_ID>',
            },
          },
        },
      ],
    },
    null,
    2
  );

  if (loading && items.length === 0 && recentRuns.length === 0) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-3xl border border-[#E2E8F0] bg-white/90" />
        <div className="h-64 animate-pulse rounded-3xl border border-[#E2E8F0] bg-white/90" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Scheduler Status Card */}
      <section className="ecdat-glass-card rounded-3xl p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#BAE6FD] bg-[#EFF8FF] px-3 py-1 font-mono text-[11px] font-semibold text-[#0284C7]">
              <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
              Connected Cloud Inventory
            </div>
            <h2 className="mt-2.5 text-xl font-bold tracking-tight text-[#0F172A]">
              AWS Certificate Manager (ACM) Connectors
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#475569]">
              Continuously synchronize live TLS certificates across AWS regions using read-only
              IAM permissions, temporary STS credentials, and deterministic risk evaluation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div
              className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2 text-xs font-medium ${
                scheduler?.configured
                  ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]'
                  : 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
              }`}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{scheduler?.label ?? 'Schedule not configured'}</span>
            </div>

            {isAdmin && !showForm ? (
              <button
                type="button"
                onClick={startCreate}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:opacity-95"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Connect AWS ACM
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Sample Workspace Notice */}
      {isSample ? (
        <section className="ecdat-glass-card rounded-3xl border-[#BAE6FD] bg-gradient-to-r from-[#EFF8FF]/90 to-[#FFFFFF]/95 p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="max-w-2xl space-y-1.5">
              <div className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#0284C7]">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                Sample Workspace Isolation
              </div>
              <h3 className="text-base font-bold text-[#0F172A]">
                Live AWS connectors are exclusive to Live Enterprise Workspaces
              </h3>
              <p className="text-xs leading-relaxed text-[#475569]">
                The Northstar Sample Workspace holds isolated fictional sample data only. Sign in
                with an Enterprise Admin account to configure live AWS Certificate Manager accounts,
                STS External IDs, and 6-hour sync schedules.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenEnterpriseModal}
              className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-2 rounded-2xl bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#0284C7]"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Enterprise Sign-In
            </button>
          </div>
        </section>
      ) : null}

      {/* Non-Admin RBAC Notice in Live Workspace */}
      {!isSample && !isAdmin ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-xs text-[#B45309]">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Signed in with role <strong>{currentRole}</strong>.{' '}
            {canSync
              ? 'You can trigger manual "Sync now" refreshes, while connector setup and removal require Admin.'
              : 'Viewer role is read-only; ask an Admin to configure connectors or run syncs.'}
          </span>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-4 text-xs text-[#BE123C]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {bannerMsg ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-4 text-xs text-[#065F46]"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#059669]" aria-hidden="true" />
          <span>{bannerMsg}</span>
        </div>
      ) : null}

      {/* Configured Data Sources List */}
      {!isSample && items.length > 0 ? (
        <section className="space-y-4">
          {items.map((src) => {
            const badge = dataSourceStatusBadge(src.status);
            const isSyncing = syncingSourceId === src.id || src.status === 'syncing';
            const isEmptyAccount =
              src.status === 'connected' &&
              src.lastSuccessfulSyncAt &&
              src.lastSyncCounts?.totalObserved === 0;

            return (
              <div key={src.id} className="ecdat-glass-card rounded-3xl p-6">
                <div className="flex flex-col justify-between gap-4 border-b border-[#E2E8F0] pb-4 lg:flex-row lg:items-center">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-lg font-bold text-[#0F172A]">{src.name}</h3>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                      <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-0.5 font-mono text-[11px] text-[#475569]">
                        {src.authMode === 'sts_assume_role'
                          ? 'STS AssumeRole'
                          : 'Workload Identity'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-[#475569]">
                      <span>Account: {src.awsAccountId ?? 'Resolved on sync'}</span>
                      <span>Regions: {src.regions.join(', ')}</span>
                      <span>
                        Last successful sync:{' '}
                        <strong className="text-[#0F172A]">
                          {src.lastSuccessfulSyncAt
                            ? formatUtcDate(src.lastSuccessfulSyncAt)
                            : 'Never'}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {canSync ? (
                      <button
                        type="button"
                        disabled={isSyncing}
                        onClick={() => void handleSyncNow(src)}
                        className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-4 py-2 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        {isSyncing ? 'Syncing...' : 'Sync now'}
                      </button>
                    ) : null}

                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={() => startEdit(src)}
                          className="min-h-[38px] cursor-pointer rounded-xl border border-[#CBD5E1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7] disabled:opacity-50"
                        >
                          Configure
                        </button>
                        {confirmDeleteId === src.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleDelete(src.id)}
                              className="min-h-[38px] cursor-pointer rounded-xl bg-[#BE123C] px-3 py-1.5 text-xs font-semibold text-white"
                            >
                              Confirm remove
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[38px] cursor-pointer rounded-xl border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#475569]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isSyncing}
                            onClick={() => setConfirmDeleteId(src.id)}
                            aria-label={`Remove ${src.name}`}
                            className="min-h-[38px] cursor-pointer rounded-xl border border-[#E2E8F0] bg-white p-2 text-[#64748B] hover:border-[#FECDD3] hover:bg-[#FFF1F2] hover:text-[#BE123C] disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Stale Data Indicator if Latest Sync Failed */}
                {src.status === 'failed' ? (
                  <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-3.5 text-xs text-[#BE123C]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div>
                      <div className="font-semibold">
                        Stale data warning — latest sync failed (preserving last successful snapshot)
                      </div>
                      <div className="mt-1 font-mono text-[11px]">{src.lastSyncError}</div>
                    </div>
                  </div>
                ) : null}

                {/* Empty AWS Account Message naming Checked Regions */}
                {isEmptyAccount ? (
                  <div className="mt-4 rounded-2xl border border-[#BAE6FD] bg-[#EFF8FF] p-3.5 text-xs text-[#0369A1]">
                    Account check succeeded with <strong>0 ACM certificates</strong>. Regions
                    checked: <span className="font-mono">{src.lastCheckedRegions.join(', ')}</span>.
                  </div>
                ) : null}

                {src.lastSyncCounts ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                      <div className="font-mono text-[10px] uppercase text-[#64748B]">Observed</div>
                      <div className="mt-1 font-mono text-lg font-bold text-[#0F172A] tabular-nums">
                        {src.lastSyncCounts.totalObserved}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                      <div className="font-mono text-[10px] uppercase text-[#64748B]">Inserted</div>
                      <div className="mt-1 font-mono text-lg font-bold text-[#047857] tabular-nums">
                        +{src.lastSyncCounts.inserted}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                      <div className="font-mono text-[10px] uppercase text-[#64748B]">Updated</div>
                      <div className="mt-1 font-mono text-lg font-bold text-[#0284C7] tabular-nums">
                        {src.lastSyncCounts.updated}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                      <div className="font-mono text-[10px] uppercase text-[#64748B]">Unchanged</div>
                      <div className="mt-1 font-mono text-lg font-bold text-[#475569] tabular-nums">
                        {src.lastSyncCounts.unchanged}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                      <div className="font-mono text-[10px] uppercase text-[#64748B]">Missing</div>
                      <div className="mt-1 font-mono text-lg font-bold text-[#B45309] tabular-nums">
                        {src.lastSyncCounts.missing}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {/* Empty Live Workspace Prompt */}
      {!isSample && items.length === 0 && !showForm ? (
        <section className="ecdat-glass-card rounded-3xl p-10 text-center">
          <Cloud className="mx-auto h-10 w-10 text-[#0284C7]" aria-hidden="true" />
          <h3 className="mt-3 text-lg font-bold text-[#0F172A]">
            No AWS Certificate Manager sources connected yet
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[#475569]">
            Connect an approved AWS account with read-only ACM permissions to automatically
            inventory certificates across regions every 6 hours.
          </p>
          {isAdmin ? (
            <button
              type="button"
              onClick={startCreate}
              className="mt-5 inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-5 py-2.5 text-xs font-semibold text-white shadow-sm"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Connect data source
            </button>
          ) : null}
        </section>
      ) : null}

      {/* Admin-Only AWS ACM Connector Setup Form */}
      {isAdmin && showForm ? (
        <section
          aria-label="AWS Certificate Manager connector setup"
          className="ecdat-glass-card rounded-3xl p-6 sm:p-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-4">
            <div>
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#0284C7]">
                Admin-Only Connector Setup
              </div>
              <h3 className="mt-1 text-lg font-bold text-[#0F172A]">
                {editingId
                  ? 'Update AWS Certificate Manager Connector'
                  : 'Connect AWS Certificate Manager (ACM)'}
              </h3>
            </div>
            {items.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
                className="cursor-pointer rounded-xl border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] hover:text-[#0F172A]"
              >
                Cancel
              </button>
            ) : null}
          </div>

          <form onSubmit={handleSave} className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-7">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="ds-name"
                    className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                  >
                    Connector Name
                  </label>
                  <input
                    id="ds-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., AWS Production Core"
                    className="mt-1.5 min-h-[40px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ds-env"
                    className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                  >
                    Default Environment
                  </label>
                  <select
                    id="ds-env"
                    value={environmentDefault}
                    onChange={(e) => setEnvironmentDefault(e.target.value as EnvironmentType)}
                    className="mt-1.5 min-h-[40px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>

              <div>
                <span className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]">
                  Server-Side Credential Mode
                </span>
                <div className="mt-1.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('sts_assume_role');
                      setTestResult(null);
                    }}
                    className={`cursor-pointer rounded-2xl border p-3.5 text-left transition-all ${
                      authMode === 'sts_assume_role'
                        ? 'border-[#38BDF8] bg-[#EFF8FF] ring-2 ring-[#38BDF8]/20'
                        : 'border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#CBD5E1]'
                    }`}
                  >
                    <div className="text-xs font-bold text-[#0F172A]">
                      Cross-Account STS AssumeRole
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#475569]">
                      Temporary credentials with unique per-account External ID
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('workload_identity');
                      setTestResult(null);
                    }}
                    className={`cursor-pointer rounded-2xl border p-3.5 text-left transition-all ${
                      authMode === 'workload_identity'
                        ? 'border-[#38BDF8] bg-[#EFF8FF] ring-2 ring-[#38BDF8]/20'
                        : 'border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#CBD5E1]'
                    }`}
                  >
                    <div className="text-xs font-bold text-[#0F172A]">
                      Same-Account Workload Identity
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#475569]">
                      Uses server ECS/EKS/EC2 role or server AWS env credentials
                    </div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="ds-account-id"
                    className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                  >
                    Approved AWS Account ID (12 digits)
                  </label>
                  <input
                    id="ds-account-id"
                    type="text"
                    value={awsAccountId}
                    onChange={(e) => {
                      setAwsAccountId(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="e.g., 123456789012"
                    className="mt-1.5 min-h-[40px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 font-mono text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
                  />
                </div>

                {authMode === 'sts_assume_role' ? (
                  <div>
                    <label
                      htmlFor="ds-external-id"
                      className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                    >
                      Unique External ID
                    </label>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        id="ds-external-id"
                        type="text"
                        required
                        value={externalId}
                        onChange={(e) => {
                          setExternalId(e.target.value);
                          setTestResult(null);
                        }}
                        className="min-h-[40px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 font-mono text-xs text-[#0F172A]"
                      />
                      <button
                        type="button"
                        onClick={() => copyText('externalId', externalId)}
                        aria-label="Copy External ID"
                        className="min-h-[40px] cursor-pointer rounded-xl border border-[#CBD5E1] bg-white px-3 text-xs text-[#475569] hover:text-[#0284C7]"
                      >
                        {copiedField === 'externalId' ? (
                          <Check className="h-3.5 w-3.5 text-[#059669]" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {authMode === 'sts_assume_role' ? (
                <div>
                  <label
                    htmlFor="ds-role-arn"
                    className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                  >
                    Read-Only IAM Role ARN
                  </label>
                  <input
                    id="ds-role-arn"
                    type="text"
                    required
                    value={roleArn}
                    onChange={(e) => {
                      setRoleArn(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="arn:aws:iam::123456789012:role/ecdat-acm-readonly"
                    className="mt-1.5 min-h-[40px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 font-mono text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
                  />
                </div>
              ) : null}

              <div>
                <span className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]">
                  Regions to Enumerate ({selectedRegions.length} selected)
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Array.from(new Set([...supportedRegions, ...selectedRegions])).map((reg) => {
                    const active = selectedRegions.includes(reg);
                    return (
                      <button
                        key={reg}
                        type="button"
                        onClick={() => toggleRegion(reg)}
                        className={`cursor-pointer rounded-xl border px-3 py-1.5 font-mono text-[11px] font-medium transition-colors ${
                          active
                            ? 'border-[#38BDF8] bg-[#EFF8FF] font-semibold text-[#0284C7]'
                            : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475569] hover:border-[#CBD5E1]'
                        }`}
                      >
                        {reg}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <input
                    type="text"
                    value={customRegion}
                    onChange={(e) => setCustomRegion(e.target.value)}
                    placeholder="Add region (e.g., ca-central-1)"
                    className="min-h-[36px] max-w-[220px] rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 font-mono text-xs text-[#0F172A]"
                  />
                  <button
                    type="button"
                    onClick={addCustomRegion}
                    className="min-h-[36px] cursor-pointer rounded-xl border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#0F172A] hover:border-[#0284C7]"
                  >
                    Add region
                  </button>
                </div>
              </div>

              {testResult ? (
                <div
                  role="status"
                  className={`rounded-2xl border p-4 text-xs ${
                    testResult.ok
                      ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]'
                      : 'border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C]'
                  }`}
                >
                  <div className="font-semibold">
                    {testResult.ok ? 'Connection check passed' : 'Connection check failed'}
                  </div>
                  <p className="mt-1">{testResult.message}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-[#E2E8F0] pt-4">
                <button
                  type="button"
                  disabled={testing || saving || selectedRegions.length === 0}
                  onClick={() => void handleTestConnection()}
                  className="min-h-[42px] cursor-pointer rounded-2xl border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7] disabled:opacity-50"
                >
                  {testing ? 'Testing AWS connection...' : 'Test connection'}
                </button>

                <button
                  type="submit"
                  disabled={saving || testing || selectedRegions.length === 0}
                  className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  {saving
                    ? 'Verifying & syncing...'
                    : editingId
                      ? 'Save configuration'
                      : 'Save & start first sync'}
                </button>
              </div>
            </div>

            {/* Right Column: Copyable IAM Policies & Cloud Scheduler Info */}
            <div className="space-y-4 lg:col-span-5">
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0F172A]">
                    1. Minimal Read-Only IAM Policy
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText('perm', iamPermissionsPolicy)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1 font-mono text-[10px] font-medium text-[#0284C7]"
                  >
                    {copiedField === 'perm' ? 'Copied' : 'Copy JSON'}
                  </button>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#334155]">
                  {iamPermissionsPolicy ||
                    '{\n  "Action": ["acm:ListCertificates", "acm:DescribeCertificate"],\n  "Resource": "*"\n}'}
                </pre>
              </div>

              {authMode === 'sts_assume_role' ? (
                <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0F172A]">
                      2. Cross-Account Trust Policy
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('trust', trustPolicyJson)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1 font-mono text-[10px] font-medium text-[#0284C7]"
                    >
                      {copiedField === 'trust' ? 'Copied' : 'Copy JSON'}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-[#475569]">
                    Locks role assumption to your server&apos;s trusted principal and this
                    account&apos;s unique External ID.
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#334155]">
                    {trustPolicyJson}
                  </pre>
                </div>
              ) : null}

              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-[11px] text-[#475569]">
                <div className="font-mono font-semibold uppercase tracking-[0.06em] text-[#0F172A]">
                  Automatic 6-Hour Refresh Setup
                </div>
                <p className="mt-1.5 leading-relaxed">
                  Point Cloud Scheduler every 6 hours (<code className="font-mono">0 */6 * * *</code>)
                  to <code className="font-mono">POST /api/internal/scheduled-sync</code> with{' '}
                  <code className="font-mono">Authorization: Bearer &lt;ECDAT_SCHEDULER_SECRET&gt;</code>,
                  or set <code className="font-mono">ECDAT_ENABLE_INTERNAL_SCHEDULER=true</code> on
                  always-on servers.
                </p>
              </div>
            </div>
          </form>
        </section>
      ) : null}

      {/* Persisted Sync Run History */}
      {!isSample ? (
        <section className="ecdat-glass-card overflow-hidden rounded-3xl">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC]/80 px-5 py-3.5">
            <h3 className="text-sm font-bold text-[#0F172A]">Synchronization Run History</h3>
            <span className="font-mono text-[11px] text-[#64748B]">
              {recentRuns.length} run(s)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                  <th className="px-4 py-2.5">Started (UTC)</th>
                  <th className="px-4 py-2.5">Trigger</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Regions Checked</th>
                  <th className="px-4 py-2.5">Counts (+ / ~ / = / -)</th>
                  <th className="px-4 py-2.5">Notes / Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {recentRuns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#64748B]">
                      No synchronization runs recorded yet.
                    </td>
                  </tr>
                ) : (
                  recentRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-[#F8FAFC]/70">
                      <td className="px-4 py-3 font-mono text-[11px] text-[#334155] whitespace-nowrap">
                        {formatUtcDate(run.startedAt)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] uppercase text-[#475569]">
                        {run.trigger}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${syncRunStatusClass(
                            run.status
                          )}`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#334155]">
                        {run.regionsChecked.length > 0
                          ? run.regionsChecked.join(', ')
                          : 'None succeeded'}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#0F172A] tabular-nums whitespace-nowrap">
                        +{run.insertedCount} / ~{run.updatedCount} / ={run.unchangedCount} / -
                        {run.missingCount}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-[#475569]">
                        {run.errorMessage ? (
                          <span className="font-mono text-[#BE123C]">{run.errorMessage}</span>
                        ) : run.totalObserved === 0 ? (
                          'Checked successfully · 0 certificates returned'
                        ) : (
                          `${run.totalObserved} certificate(s) synchronized`
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
