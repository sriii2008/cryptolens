import { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import {
  downloadAuthenticatedCsv,
  fetchReportSummary,
  type ReportSummaryResponse,
} from '../lib/api';
import {
  dataSourceStatusBadge,
  formatShortUtcDate,
  formatUtcDate,
  severitySurfaceClass,
} from '../lib/format';

interface ReportsViewProps {
  workspaceId: string;
}

export function ReportsView({ workspaceId }: ReportsViewProps) {
  const [environment, setEnvironment] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const [summary, setSummary] = useState<ReportSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchReportSummary(workspaceId, { environment, severity, status })
      .then((res) => {
        if (active) setSummary(res);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to generate report summary.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, environment, severity, status]);

  const queryParams = new URLSearchParams({ environment, severity, status });
  const ds = summary?.dataSourcesSummary;

  return (
    <div className="space-y-6">
      {/* Report Controls (hidden when printing) */}
      <section
        aria-label="Report filters and export actions"
        className="no-print ecdat-glass-card rounded-3xl p-5"
      >
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex-1">
            <div>
              <label
                htmlFor="rep-env"
                className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
              >
                Environment
              </label>
              <select
                id="rep-env"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A]"
              >
                <option value="all">All environments</option>
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="rep-sev"
                className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
              >
                Severity
              </label>
              <select
                id="rep-sev"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A]"
              >
                <option value="all">All severities</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="rep-status"
                className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
              >
                Remediation Status
              </label>
              <select
                id="rep-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A]"
              >
                <option value="all">All statuses</option>
                <option value="Open">Open</option>
                <option value="In progress">In progress</option>
                <option value="Resolved">Resolved</option>
                <option value="Accepted risk">Accepted risk</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                void downloadAuthenticatedCsv(
                  `/api/workspaces/${encodeURIComponent(workspaceId)}/reports/export.csv?type=assets&${queryParams.toString()}`,
                  `ecdat-assets-${workspaceId}.csv`
                )
              }
              className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-2xl border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7]"
            >
              <Download className="h-3.5 w-3.5 text-[#0284C7]" aria-hidden="true" />
              Export Assets CSV
            </button>

            <button
              type="button"
              onClick={() =>
                void downloadAuthenticatedCsv(
                  `/api/workspaces/${encodeURIComponent(workspaceId)}/reports/export.csv?type=findings&${queryParams.toString()}`,
                  `ecdat-findings-${workspaceId}.csv`
                )
              }
              className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-95"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export Findings CSV
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-2xl border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7]"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              Print Summary
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-4 text-xs text-[#BE123C]"
        >
          {error}
        </div>
      ) : null}

      {/* Executive Summary Card */}
      <section className="print-surface ecdat-glass-card rounded-3xl p-6 sm:p-8">
        {loading || !summary ? (
          <div className="space-y-4 py-6">
            <div className="h-6 w-1/3 animate-pulse rounded-xl bg-[#F1F5F9]" />
            <div className="h-24 w-full animate-pulse rounded-2xl bg-[#F8FAFC]" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 border-b border-[#E2E8F0] pb-4 sm:flex-row sm:items-end">
              <div>
                <div className="print-muted font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0284C7]">
                  ECDAT Executive Cryptographic Summary
                  {summary.workspace.isSample ? ' · Sample data' : ' · Live Workspace'}
                </div>
                <h2 className="mt-1 text-2xl font-bold text-[#0F172A]">
                  {summary.workspace.name}
                </h2>
              </div>
              <div className="print-muted font-mono text-[11px] text-[#64748B] tabular-nums">
                <div>Generated: {formatUtcDate(summary.generatedAtUtc)}</div>
                <div>
                  Filters: env={summary.filters.environment} · sev={summary.filters.severity} ·
                  status={summary.filters.status}
                </div>
              </div>
            </div>

            {!summary.workspace.isSample && ds && ds.totalSources > 0 ? (
              <div className="print-surface flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-semibold text-[#0F172A]">
                    Primary Source: {ds.primarySourceName}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                      dataSourceStatusBadge(ds.primaryStatus).classes
                    }`}
                  >
                    {dataSourceStatusBadge(ds.primaryStatus).label}
                  </span>
                  {ds.isStale ? (
                    <span className="font-mono text-[11px] font-semibold text-[#BE123C]">
                      Stale snapshot (latest sync failed)
                    </span>
                  ) : null}
                </div>
                <span className="font-mono text-[11px] text-[#64748B]">
                  Last confirmed sync:{' '}
                  {ds.lastSuccessfulSyncAt ? formatUtcDate(ds.lastSuccessfulSyncAt) : 'Pending'}
                </span>
              </div>
            ) : null}

            {/* 4-Cell Summary Counts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="print-surface rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="print-muted font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                  Filtered Assets
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                  {summary.counts.assets}
                </div>
              </div>
              <div className="print-surface rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="print-muted font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                  Matching Findings
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                  {summary.counts.findings}
                </div>
              </div>
              <div className="print-surface rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="print-muted font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                  High Severity
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-[#BE123C] tabular-nums">
                  {summary.counts.highFindings}
                </div>
              </div>
              <div className="print-surface rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="print-muted font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                  Resolved / Accepted
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-[#047857] tabular-nums">
                  {summary.counts.resolvedFindings + summary.counts.acceptedRiskFindings}
                </div>
              </div>
            </div>

            {/* Findings Summary Table */}
            <div>
              <h3 className="text-base font-bold text-[#0F172A]">Findings Breakdown</h3>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-[#E2E8F0]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="print-muted border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                      <th className="px-3.5 py-2.5">Severity</th>
                      <th className="px-3.5 py-2.5">Title</th>
                      <th className="px-3.5 py-2.5">Asset / Source</th>
                      <th className="px-3.5 py-2.5">Status</th>
                      <th className="px-3.5 py-2.5">Assignee</th>
                      <th className="px-3.5 py-2.5">Observed (UTC)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {summary.findings.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="print-muted px-4 py-6 text-center text-[#64748B]"
                        >
                          No findings match the selected report filters.
                        </td>
                      </tr>
                    ) : (
                      summary.findings.map((f) => (
                        <tr key={f.id}>
                          <td className="px-3.5 py-2.5">
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${severitySurfaceClass(
                                f.severity
                              )}`}
                            >
                              {f.severity}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 font-semibold text-[#0F172A]">
                            {f.title}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-[#475569]">
                            {f.assetName ?? 'Unknown'} ({f.assetEnvironment ?? 'unknown'})
                            {f.assetSourceName ? ` · ${f.assetSourceName}` : ''}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-[#0F172A]">{f.status}</td>
                          <td className="px-3.5 py-2.5 text-[#475569]">
                            {f.assignee ?? 'Unassigned'}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-[#64748B] tabular-nums">
                            {formatShortUtcDate(f.lastObservedAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
