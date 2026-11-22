import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Cloud,
  Database,
  FileUp,
  Plus,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { OverviewStats, Role, Workspace } from '../../shared/types';
import {
  dataSourceStatusBadge,
  formatDaysUntil,
  formatUtcDate,
  remediationStatusClass,
  severitySurfaceClass,
  syncRunStatusClass,
} from '../lib/format';

interface OverviewViewProps {
  stats: OverviewStats | null;
  loading: boolean;
  error: string | null;
  workspace: Workspace | null;
  currentRole: Role;
  warningDays: number;
  syncing: boolean;
  syncBanner: string | null;
  onRetry: () => void;
  onNavigateInventory: (filters?: {
    expiration?: string;
    algorithm?: string;
    environment?: string;
  }) => void;
  onNavigateFindings: (filters?: { severity?: string; status?: string }) => void;
  onOpenFindingDetail: (findingId: string) => void;
  onOpenDataSources: () => void;
  onOpenImports: () => void;
  onSyncNow: (sourceId: string) => void;
}

export function OverviewView({
  stats,
  loading,
  error,
  workspace,
  currentRole,
  warningDays,
  syncing,
  syncBanner,
  onRetry,
  onNavigateInventory,
  onNavigateFindings,
  onOpenFindingDetail,
  onOpenDataSources,
  onOpenImports,
  onSyncNow,
}: OverviewViewProps) {
  const isSample = workspace?.isSample ?? true;
  const ds = stats?.dataSourcesSummary;
  const canSync = !isSample && currentRole !== 'Viewer';

  if (loading && !stats) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-24 animate-pulse rounded-3xl border border-[#E2E8F0] bg-white/90" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-3xl border border-[#E2E8F0] bg-white/90"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-3xl border border-[#E2E8F0] bg-white/90" />
          <div className="h-64 animate-pulse rounded-3xl border border-[#E2E8F0] bg-white/90" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-3xl border border-[#FECDD3] bg-[#FFF1F2] p-6 text-sm text-[#BE123C]"
      >
        <p className="font-semibold">Unable to load workspace overview</p>
        <p className="mt-1 text-xs">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 cursor-pointer rounded-xl border border-[#FECDD3] bg-white px-3.5 py-2 text-xs font-semibold text-[#BE123C] hover:bg-[#FFF1F2]"
        >
          Retry
        </button>
      </div>
    );
  }

  // Live Data Source Status Banner (always prominent in Live Workspace)
  const renderLiveDataSourceBanner = () => {
    if (isSample || !ds) return null;

    if (ds.totalSources === 0) {
      return (
        <section
          aria-label="Connect live data source"
          className="ecdat-glass-card rounded-3xl border-[#BAE6FD] bg-gradient-to-r from-[#EFF8FF]/95 to-white/95 p-5 sm:p-6"
        >
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#0284C7]">
                <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                Live Cloud Discovery
              </div>
              <h2 className="text-base font-bold text-[#0F172A]">
                Connect a live AWS Certificate Manager data source
              </h2>
              <p className="max-w-2xl text-xs leading-relaxed text-[#475569]">
                Automatically discover and refresh TLS certificates across your approved AWS
                accounts and regions every 6 hours, or import a file snapshot as a secondary option.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onOpenDataSources}
                className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-95"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Connect data source
              </button>
              <button
                type="button"
                onClick={onOpenImports}
                className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#475569] hover:border-[#0284C7] hover:text-[#0284C7]"
              >
                <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                Import inventory
              </button>
            </div>
          </div>
        </section>
      );
    }

    const badge = dataSourceStatusBadge(ds.primaryStatus);
    return (
      <section
        aria-label="Connected data source status"
        className="ecdat-glass-card rounded-3xl p-5"
      >
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#0F172A]">
                <Cloud className="h-4 w-4 text-[#0284C7]" aria-hidden="true" />
                {ds.primarySourceName ?? 'AWS Certificate Manager'}
                {ds.totalSources > 1 ? ` (+${ds.totalSources - 1} more)` : ''}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${badge.classes}`}
              >
                {badge.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-0.5 font-mono text-[11px] text-[#475569]">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {ds.scheduler.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-[#64748B]">
              <span>
                Last successful sync:{' '}
                <strong className="text-[#0F172A]">
                  {ds.lastSuccessfulSyncAt
                    ? formatUtcDate(ds.lastSuccessfulSyncAt)
                    : 'Pending first sync'}
                </strong>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {canSync && ds.primarySourceId ? (
              <button
                type="button"
                disabled={syncing || ds.syncingCount > 0}
                onClick={() => onSyncNow(ds.primarySourceId!)}
                className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-55"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenDataSources}
              className="min-h-[38px] cursor-pointer rounded-2xl border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7]"
            >
              Manage sources
            </button>
            <button
              type="button"
              onClick={onOpenImports}
              className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs font-medium text-[#475569] hover:border-[#CBD5E1] hover:text-[#0F172A]"
            >
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
              Import file
            </button>
          </div>
        </div>

        {ds.isStale ? (
          <div className="mt-3.5 flex items-start gap-2.5 rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-3 text-xs text-[#BE123C]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <strong>Stale snapshot:</strong> Latest sync failed (
              <span className="font-mono">{ds.lastSyncError ?? 'provider error'}</span>).
              Showing last confirmed inventory from{' '}
              <span className="font-mono">
                {ds.lastSuccessfulSyncAt ? formatUtcDate(ds.lastSuccessfulSyncAt) : 'prior run'}
              </span>
              .
            </div>
          </div>
        ) : null}

        {syncBanner ? (
          <div
            role="status"
            className="mt-3 rounded-2xl border border-[#BAE6FD] bg-[#EFF8FF] px-3.5 py-2.5 text-xs font-medium text-[#0369A1]"
          >
            {syncBanner}
          </div>
        ) : null}
      </section>
    );
  };

  if (!stats || stats.totalAssets === 0) {
    return (
      <div className="space-y-5">
        {renderLiveDataSourceBanner()}

        <div className="ecdat-glass-card rounded-3xl p-10 text-center">
          <Database className="mx-auto h-9 w-9 text-[#0284C7]" aria-hidden="true" />
          <h2 className="mt-3 text-xl font-bold text-[#0F172A]">
            {isSample
              ? 'No cryptographic assets discovered yet'
              : ds && ds.totalSources > 0
                ? 'Zero certificates observed in connected AWS regions'
                : 'No cryptographic assets in this live workspace yet'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[#475569]">
            {isSample
              ? 'Import a CSV or JSON inventory export, or upload public X.509 certificates to begin deterministic posture analysis.'
              : ds && ds.totalSources > 0
                ? 'Your connected AWS ACM source returned 0 certificates across the configured regions, or has not completed its first sync yet.'
                : 'Connect an AWS Certificate Manager source to continuously synchronize live inventory, or import a file snapshot manually.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {!isSample ? (
              <button
                type="button"
                onClick={onOpenDataSources}
                className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:opacity-95"
              >
                <Cloud className="h-4 w-4" aria-hidden="true" />
                {ds && ds.totalSources > 0 ? 'Inspect Data Sources' : 'Connect data source'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenImports}
              className={`inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold ${
                isSample
                  ? 'bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] text-white shadow-sm hover:opacity-95'
                  : 'border border-[#CBD5E1] bg-white text-[#475569] hover:border-[#0284C7] hover:text-[#0284C7]'
              }`}
            >
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Import inventory
            </button>
          </div>
        </div>
      </div>
    );
  }

  const maxTimelineCount = Math.max(1, ...stats.expiryTimeline.map((b) => b.count));

  return (
    <div className="space-y-6">
      {renderLiveDataSourceBanner()}

      {/* 3 Curved Frosted Actionable KPI Cards */}
      <section
        aria-label="Workspace key metrics"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        <button
          type="button"
          onClick={() => onNavigateInventory({ expiration: 'all', algorithm: 'all' })}
          className="ecdat-glass-card group flex cursor-pointer flex-col justify-between rounded-3xl p-6 text-left transition-all hover:border-[#38BDF8] focus-visible:outline-2 focus-visible:outline-[#0284C7]"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#475569]">
            <span>Total Cryptographic Assets</span>
            <ArrowRight
              className="h-4 w-4 text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#0284C7]"
              aria-hidden="true"
            />
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold text-[#0F172A] tabular-nums">
              {stats.totalAssets}
            </span>
            <span className="rounded-full border border-[#FECDD3] bg-[#FFF1F2] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#BE123C] tabular-nums">
              {stats.expiredCount} expired
            </span>
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
            <div className="h-full w-4/5 rounded-full bg-gradient-to-r from-[#38BDF8] to-[#2563EB]" />
          </div>
          <div className="mt-3 font-mono text-[11px] font-medium text-[#0284C7]">
            View full inventory
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateInventory({ expiration: 'expiring_30' })}
          className="ecdat-glass-card group flex cursor-pointer flex-col justify-between rounded-3xl p-6 text-left transition-all hover:border-[#FCD34D] focus-visible:outline-2 focus-visible:outline-[#0284C7]"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#475569]">
            <span>Expiring Within {warningDays} Days</span>
            <ArrowRight
              className="h-4 w-4 text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#B45309]"
              aria-hidden="true"
            />
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold text-[#B45309] tabular-nums">
              {stats.expiringSoonCount}
            </span>
            <span className="rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#B45309]">
              UTC evaluation
            </span>
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FBBF24] to-[#D97706]"
              style={{
                width: `${Math.max(
                  12,
                  Math.min(100, Math.round((stats.expiringSoonCount / stats.totalAssets) * 100))
                )}%`,
              }}
            />
          </div>
          <div className="mt-3 font-mono text-[11px] font-medium text-[#B45309]">
            Filter expiring assets
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateFindings({ severity: 'High', status: 'Open' })}
          className="ecdat-glass-card group flex cursor-pointer flex-col justify-between rounded-3xl p-6 text-left transition-all hover:border-[#FDA4AF] focus-visible:outline-2 focus-visible:outline-[#0284C7]"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#475569]">
            <span>Open High-Severity Findings</span>
            <ArrowRight
              className="h-4 w-4 text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#BE123C]"
              aria-hidden="true"
            />
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold text-[#BE123C] tabular-nums">
              {stats.openHighFindingsCount}
            </span>
            <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[#475569] tabular-nums">
              {stats.openFindingsCount} open total
            </span>
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FB7185] to-[#E11D48]"
              style={{
                width: `${Math.max(
                  12,
                  Math.min(
                    100,
                    stats.openFindingsCount > 0
                      ? Math.round((stats.openHighFindingsCount / stats.openFindingsCount) * 100)
                      : 15
                  )
                )}%`,
              }}
            />
          </div>
          <div className="mt-3 font-mono text-[11px] font-medium text-[#BE123C]">
            Triage high-severity risks
          </div>
        </button>
      </section>

      {/* Curved Charts Row inspired by QORE dashboard bars */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="ecdat-glass-card rounded-3xl p-6">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3.5">
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">
                Certificate &amp; Key Expiry Timeline
              </h2>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Select any bucket to filter the asset inventory
              </p>
            </div>
            <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[#475569]">
              UTC
            </span>
          </div>

          <div className="mt-5 grid grid-cols-6 items-end gap-3 pt-2" style={{ minHeight: 185 }}>
            {stats.expiryTimeline.map((bucket) => {
              const barPct =
                bucket.count === 0
                  ? 6
                  : Math.max(16, Math.round((bucket.count / maxTimelineCount) * 100));
              const isExpired = bucket.bucket === 'expired';
              const isSoon = bucket.bucket === '0_7d' || bucket.bucket === '8_30d';
              const barColor = isExpired
                ? 'bg-gradient-to-t from-[#E11D48] to-[#FDA4AF]'
                : isSoon
                  ? 'bg-gradient-to-t from-[#D97706] to-[#FCD34D]'
                  : bucket.bucket === 'unknown'
                    ? 'bg-gradient-to-t from-[#64748B] to-[#CBD5E1]'
                    : 'bg-gradient-to-t from-[#2563EB] via-[#38BDF8] to-[#BAE6FD]';

              return (
                <button
                  key={bucket.bucket}
                  type="button"
                  onClick={() => onNavigateInventory({ expiration: bucket.filterKey })}
                  className="group flex h-full cursor-pointer flex-col items-center justify-end gap-2 focus-visible:outline-2 focus-visible:outline-[#0284C7]"
                  aria-label={`${bucket.label}: ${bucket.count} assets`}
                >
                  <span className="font-mono text-xs font-bold text-[#0F172A] tabular-nums">
                    {bucket.count}
                  </span>
                  <div className="flex h-28 w-full items-end rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-1.5">
                    <div
                      className={`w-full rounded-xl transition-all group-hover:opacity-90 ${barColor}`}
                      style={{ height: `${barPct}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] font-medium text-[#64748B] group-hover:text-[#0F172A] whitespace-nowrap">
                    {bucket.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Algorithm Distribution */}
        <div className="ecdat-glass-card rounded-3xl p-6">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3.5">
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">Algorithm Distribution</h2>
              <p className="mt-0.5 text-xs text-[#64748B]">
                Click an algorithm family to inspect matching assets
              </p>
            </div>
            <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#0F172A] tabular-nums">
              {stats.totalAssets} total
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {stats.algorithmDistribution.map((entry) => {
              const algLower = entry.algorithm.toLowerCase();
              const barTone = algLower.includes('rsa')
                ? 'bg-gradient-to-r from-[#38BDF8] to-[#2563EB]'
                : algLower.includes('ed25519') ||
                    algLower.includes('eddsa') ||
                    algLower.includes('ecdsa') ||
                    algLower.includes('ec')
                  ? 'bg-gradient-to-r from-[#34D399] to-[#059669]'
                  : 'bg-gradient-to-r from-[#94A3B8] to-[#64748B]';
              return (
                <button
                  key={entry.algorithm}
                  type="button"
                  onClick={() => onNavigateInventory({ algorithm: entry.algorithm })}
                  className="group block w-full cursor-pointer rounded-2xl p-2 text-left transition-colors hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-[#0284C7]"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-[#0F172A]">{entry.algorithm}</span>
                    <span className="font-mono text-[#475569] tabular-nums">
                      {entry.count} ({entry.percentage}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
                    <div
                      className={`h-full rounded-full ${barTone}`}
                      style={{ width: `${Math.max(5, entry.percentage)}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom Row: Prioritized Findings + Recent Sync Runs / Imports */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="ecdat-glass-card overflow-hidden rounded-3xl lg:col-span-7">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC]/80 px-5 py-3.5">
            <h2 className="text-sm font-bold text-[#0F172A]">Prioritized Findings Ledger</h2>
            <button
              type="button"
              onClick={() => onNavigateFindings()}
              className="cursor-pointer font-mono text-[11px] font-semibold text-[#0284C7] hover:underline"
            >
              View all findings
            </button>
          </div>

          {stats.recentFindings.length === 0 ? (
            <p className="p-8 text-center text-sm text-[#64748B]">
              No findings detected for the current inventory.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    <th className="px-4 py-2.5">Sev</th>
                    <th className="px-4 py-2.5">Finding / Rule</th>
                    <th className="px-4 py-2.5">Asset</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {stats.recentFindings.map((f) => (
                    <tr
                      key={f.id}
                      onClick={() => onOpenFindingDetail(f.id)}
                      className="cursor-pointer transition-colors hover:bg-[#EFF8FF]/50"
                    >
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${severitySurfaceClass(
                            f.severity
                          )}`}
                        >
                          {f.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFindingDetail(f.id);
                          }}
                          className="cursor-pointer text-left font-semibold text-[#0F172A] hover:text-[#0284C7]"
                        >
                          {f.title}
                        </button>
                        <div className="mt-0.5 font-mono text-[11px] text-[#64748B]">
                          {f.ruleId} · {f.assignee ?? 'Unassigned'}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-[11px] font-medium text-[#334155]">
                          {f.assetName}
                        </div>
                        {f.assetSourceName ? (
                          <div className="mt-0.5 font-mono text-[10px] text-[#64748B]">
                            {f.assetSourceName}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${remediationStatusClass(
                            f.status
                          )}`}
                        >
                          {f.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="ecdat-glass-card overflow-hidden rounded-3xl lg:col-span-5">
          {!isSample && stats.recentSyncRuns.length > 0 ? (
            <>
              <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC]/80 px-5 py-3.5">
                <h2 className="text-sm font-bold text-[#0F172A]">Recent Data Source Syncs</h2>
                <button
                  type="button"
                  onClick={onOpenDataSources}
                  className="cursor-pointer font-mono text-[11px] font-semibold text-[#0284C7] hover:underline"
                >
                  Data Sources
                </button>
              </div>
              <div className="divide-y divide-[#E2E8F0]">
                {stats.recentSyncRuns.map((run) => (
                  <div key={run.id} className="px-5 py-3.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-[#0F172A] capitalize">
                        {run.trigger} sync
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${syncRunStatusClass(
                          run.status
                        )}`}
                      >
                        {run.status}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-[#475569] tabular-nums">
                      {run.totalObserved} observed (+{run.insertedCount} / ~{run.updatedCount} / -
                      {run.missingCount})
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-[#64748B]">
                      {formatUtcDate(run.startedAt)} · {run.regionsChecked.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC]/80 px-5 py-3.5">
                <h2 className="text-sm font-bold text-[#0F172A]">Recent File Imports</h2>
                <button
                  type="button"
                  onClick={onOpenImports}
                  className="cursor-pointer font-mono text-[11px] font-semibold text-[#0284C7] hover:underline"
                >
                  Import file
                </button>
              </div>

              {stats.recentImports.length === 0 ? (
                <p className="p-8 text-center text-sm text-[#64748B]">No file imports recorded.</p>
              ) : (
                <div className="divide-y divide-[#E2E8F0]">
                  {stats.recentImports.map((imp) => (
                    <div key={imp.id} className="px-5 py-3.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#0F172A] truncate">
                          {imp.filename}
                        </span>
                        <span className="rounded-full border border-[#BAE6FD] bg-[#EFF8FF] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#0284C7]">
                          {imp.format}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-[#475569] tabular-nums">
                        {imp.insertedCount} inserted · {imp.updatedCount} updated ·{' '}
                        {imp.skippedCount} skipped
                        {imp.rejectedCount > 0 ? ` · ${imp.rejectedCount} rejected` : ''}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-[#64748B]">
                        {formatUtcDate(imp.createdAt)} · {imp.actorEmail}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {stats.samplePreviewAsset ? (
        <div className="ecdat-glass-card flex items-center justify-between rounded-2xl px-5 py-3 text-xs text-[#475569]">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-4 w-4 text-[#B45309]" aria-hidden="true" />
            <span>
              Next expiration watch:{' '}
              <strong className="font-mono text-[#0F172A]">
                {stats.samplePreviewAsset.asset.name}
              </strong>{' '}
              <span className="font-mono font-semibold text-[#B45309]">
                ({formatDaysUntil(stats.samplePreviewAsset.asset.validTo)})
              </span>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
