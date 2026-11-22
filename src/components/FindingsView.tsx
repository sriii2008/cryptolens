import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import type {
  CryptoAsset,
  Finding,
  RemediationHistoryEntry,
  RemediationStatus,
  Role,
} from '../../shared/types';
import {
  fetchFindingDetail,
  fetchFindings,
  patchFindingRemediation,
} from '../lib/api';
import {
  formatShortUtcDate,
  formatUtcDate,
  remediationStatusClass,
  severitySurfaceClass,
  truncateFingerprint,
} from '../lib/format';

export interface FindingsFiltersState {
  search: string;
  severity: string;
  status: string;
  detectionState: string;
  environment: string;
  ruleId: string;
  page: number;
}

interface FindingsViewProps {
  workspaceId: string;
  currentRole: Role;
  filters: FindingsFiltersState;
  selectedFindingId: string | null;
  onChangeFilters: (next: FindingsFiltersState) => void;
  onSelectFinding: (findingId: string | null) => void;
  onRemediationSaved: () => void;
}

export function FindingsView({
  workspaceId,
  currentRole,
  filters,
  selectedFindingId,
  onChangeFilters,
  onSelectFinding,
  onRemediationSaved,
}: FindingsViewProps) {
  const [items, setItems] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<{
    finding: Finding;
    asset: CryptoAsset;
    history: RemediationHistoryEntry[];
  } | null>(null);

  // Remediation form state
  const [status, setStatus] = useState<RemediationStatus>('Open');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [acceptedReason, setAcceptedReason] = useState('');
  const [acceptedReviewDate, setAcceptedReviewDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const pageSize = 10;
  const canTriage = currentRole !== 'Viewer';

  const loadList = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFindings(workspaceId, { ...filters, pageSize });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load findings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, [workspaceId, filters]);

  useEffect(() => {
    if (!selectedFindingId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setSaveError(null);
    setSaveSuccess(null);
    fetchFindingDetail(workspaceId, selectedFindingId)
      .then((res) => {
        if (!active) return;
        setDetail(res);
        setStatus(res.finding.status);
        setAssignee(res.finding.assignee ?? '');
        setDueDate(res.finding.dueDate ? res.finding.dueDate.slice(0, 10) : '');
        setAcceptedReason(res.finding.acceptedReason ?? '');
        setAcceptedReviewDate(
          res.finding.acceptedReviewDate
            ? res.finding.acceptedReviewDate.slice(0, 10)
            : ''
        );
        setNote('');
      })
      .catch((err) => {
        if (active) {
          setSaveError(
            err instanceof Error ? err.message : 'Unable to load finding details.'
          );
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, selectedFindingId]);

  const handleSaveRemediation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFindingId) return;
    setSaveError(null);
    setSaveSuccess(null);

    if (status === 'Accepted risk') {
      if (!acceptedReason.trim()) {
        setSaveError('Accepted risk requires a written justification reason.');
        return;
      }
      if (!acceptedReviewDate) {
        setSaveError('Accepted risk requires a scheduled review date.');
        return;
      }
    }

    setSaving(true);
    try {
      await patchFindingRemediation(workspaceId, selectedFindingId, {
        status,
        assignee: assignee.trim() || null,
        dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null,
        acceptedReason: status === 'Accepted risk' ? acceptedReason.trim() : null,
        acceptedReviewDate:
          status === 'Accepted risk' && acceptedReviewDate
            ? `${acceptedReviewDate}T00:00:00.000Z`
            : null,
        note: note.trim() || null,
      });
      const updated = await fetchFindingDetail(workspaceId, selectedFindingId);
      setDetail(updated);
      setNote('');
      setSaveSuccess('Remediation changes saved and recorded in audit log.');
      await loadList();
      onRemediationSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save remediation.');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {/* Curved Filters */}
      <section
        aria-label="Findings filters"
        className="ecdat-glass-card rounded-3xl p-4 sm:p-5"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="sm:col-span-2">
            <label htmlFor="fnd-search" className="sr-only">
              Search findings
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]"
                aria-hidden="true"
              />
              <input
                id="fnd-search"
                type="search"
                value={filters.search}
                onChange={(e) =>
                  onChangeFilters({ ...filters, search: e.target.value, page: 1 })
                }
                placeholder="Search title, asset, evidence, assignee..."
                className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] pl-9 pr-3 text-xs text-[#0F172A] placeholder:text-[#64748B] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="fnd-severity" className="sr-only">
              Severity
            </label>
            <select
              id="fnd-severity"
              value={filters.severity}
              onChange={(e) =>
                onChangeFilters({ ...filters, severity: e.target.value, page: 1 })
              }
              className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            >
              <option value="all">All severities</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div>
            <label htmlFor="fnd-status" className="sr-only">
              Remediation status
            </label>
            <select
              id="fnd-status"
              value={filters.status}
              onChange={(e) =>
                onChangeFilters({ ...filters, status: e.target.value, page: 1 })
              }
              className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            >
              <option value="all">All remediation states</option>
              <option value="Open">Open</option>
              <option value="In progress">In progress</option>
              <option value="Resolved">Resolved</option>
              <option value="Accepted risk">Accepted risk</option>
            </select>
          </div>

          <div>
            <label htmlFor="fnd-detection" className="sr-only">
              Detection state
            </label>
            <select
              id="fnd-detection"
              value={filters.detectionState}
              onChange={(e) =>
                onChangeFilters({ ...filters, detectionState: e.target.value, page: 1 })
              }
              className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            >
              <option value="all">All detection states</option>
              <option value="Active">Rule Active</option>
              <option value="Cleared">Rule Cleared</option>
            </select>
          </div>

          <div>
            <label htmlFor="fnd-env" className="sr-only">
              Environment
            </label>
            <select
              id="fnd-env"
              value={filters.environment}
              onChange={(e) =>
                onChangeFilters({ ...filters, environment: e.target.value, page: 1 })
              }
              className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            >
              <option value="all">All environments</option>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
            </select>
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

      {/* Curved Findings Table */}
      <div className="ecdat-glass-card overflow-hidden rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Finding &amp; Evidence</th>
                <th className="px-4 py-3">Affected Asset</th>
                <th className="px-4 py-3">Detection / Status</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Last Observed (UTC)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {loading ? (
                [1, 2, 3, 4].map((r) => (
                  <tr key={r}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-5 w-full animate-pulse rounded-lg bg-[#F1F5F9]" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-[#64748B]">
                    No findings match your current filters.
                  </td>
                </tr>
              ) : (
                items.map((f) => {
                  const selected = selectedFindingId === f.id;
                  return (
                    <tr
                      key={f.id}
                      onClick={() => onSelectFinding(f.id)}
                      className={`cursor-pointer transition-colors hover:bg-[#EFF8FF]/55 ${
                        selected ? 'bg-[#EFF8FF]' : ''
                      }`}
                    >
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${severitySurfaceClass(
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
                            onSelectFinding(f.id);
                          }}
                          className="cursor-pointer text-left text-xs font-bold text-[#0F172A] hover:text-[#0284C7]"
                        >
                          {f.title}
                        </button>
                        <div className="mt-1 font-mono text-[11px] text-[#64748B]">
                          {f.ruleId} v{f.ruleVersion} · {f.evidence}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-xs font-semibold text-[#0F172A]">
                          {f.assetName ?? 'Unknown'}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#64748B]">
                          <span className="capitalize">{f.assetEnvironment ?? 'unknown'}</span> ·{' '}
                          <span className="font-mono">{f.assetLocation ?? 'Unknown'}</span>
                        </div>
                        {f.assetSourceName ? (
                          <div className="mt-0.5 font-mono text-[10px] text-[#0284C7]">
                            Source: {f.assetSourceName}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
                        <div>
                          <span
                            className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap ${remediationStatusClass(
                              f.status
                            )}`}
                          >
                            {f.status}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-[#64748B]">
                          Rule: {f.detectionState}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-[#0F172A]">
                        <div className="font-medium">{f.assignee ?? 'Unassigned'}</div>
                        {f.dueDate ? (
                          <div className="mt-0.5 font-mono text-[10px] text-[#64748B]">
                            Due {formatShortUtcDate(f.dueDate)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-[11px] text-[#64748B] tabular-nums">
                        {formatShortUtcDate(f.lastObservedAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3 font-mono text-[11px] text-[#64748B]">
          <span className="tabular-nums">
            Showing {items.length} of {total} findings (Page {filters.page} of {totalPages})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={filters.page <= 1}
              onClick={() => onChangeFilters({ ...filters, page: filters.page - 1 })}
              className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded-xl border border-[#CBD5E1] bg-white px-3 py-1 text-[#0F172A] hover:border-[#0284C7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Prev
            </button>
            <button
              type="button"
              disabled={filters.page >= totalPages}
              onClick={() => onChangeFilters({ ...filters, page: filters.page + 1 })}
              className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded-xl border border-[#CBD5E1] bg-white px-3 py-1 text-[#0F172A] hover:border-[#0284C7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Remediation & Evidence Dossier Panel */}
      {selectedFindingId ? (
        <section
          aria-label="Finding remediation and evidence detail"
          className="ecdat-glass-card rounded-3xl border-[#38BDF8] p-6"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
            <div>
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0284C7]">
                Finding Detail &amp; Remediation Dossier
              </div>
              <h2 className="mt-1 text-xl font-bold text-[#0F172A]">
                {detail?.finding.title ?? 'Loading finding...'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onSelectFinding(null)}
              aria-label="Close finding remediation panel"
              className="cursor-pointer rounded-xl p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {detailLoading || !detail ? (
            <div className="py-6 text-sm text-[#64748B]">Loading finding evidence...</div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="space-y-5 lg:col-span-7">
                <div className="space-y-3.5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${severitySurfaceClass(
                        detail.finding.severity
                      )}`}
                    >
                      {detail.finding.severity} severity
                    </span>
                    <span className="font-mono text-[#64748B]">
                      {detail.finding.ruleId} · v{detail.finding.ruleVersion} · Detection:{' '}
                      <strong className="text-[#0F172A]">
                        {detail.finding.detectionState}
                      </strong>
                    </span>
                  </div>

                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                      Observed Evidence
                    </div>
                    <div className="mt-1 font-mono font-semibold text-[#0F172A]">
                      {detail.finding.evidence}
                    </div>
                  </div>

                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                      Rationale
                    </div>
                    <p className="mt-1 leading-relaxed text-[#475569]">
                      {detail.finding.rationale}
                    </p>
                  </div>

                  <div className="rounded-xl border border-[#BAE6FD] bg-[#EFF8FF]/70 p-3.5">
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0284C7]">
                      Remediation Recommendation
                    </div>
                    <p className="mt-1 leading-relaxed font-medium text-[#0F172A]">
                      {detail.finding.recommendation}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2 border-t border-[#E2E8F0] pt-3 sm:grid-cols-2">
                    <div>
                      <span className="text-[#64748B]">Asset: </span>
                      <span className="font-mono font-semibold text-[#0F172A]">
                        {detail.asset.name}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#64748B]">Fingerprint: </span>
                      <span className="font-mono text-[#0F172A]">
                        {truncateFingerprint(detail.asset.fingerprintSha256)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#64748B]">First observed: </span>
                      <span className="font-mono text-[#475569] tabular-nums">
                        {formatUtcDate(detail.finding.firstObservedAt)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#64748B]">Last observed: </span>
                      <span className="font-mono text-[#475569] tabular-nums">
                        {formatUtcDate(detail.finding.lastObservedAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Activity Timeline */}
                <div>
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                    Evidence &amp; Remediation Activity Timeline
                  </h3>
                  <div className="mt-3 space-y-2.5">
                    {detail.history.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-[#0F172A]">
                            {entry.actorEmail} ·{' '}
                            <span className="font-mono text-[#0284C7]">{entry.action}</span>
                          </span>
                          <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                            {formatUtcDate(entry.createdAt)}
                          </span>
                        </div>
                        {entry.fromStatus || entry.toStatus ? (
                          <div className="mt-1 font-mono text-[11px] text-[#475569]">
                            {entry.fromStatus ?? 'New'} → {entry.toStatus ?? 'Unchanged'}
                          </div>
                        ) : null}
                        {entry.note ? <p className="mt-1 text-[#475569]">{entry.note}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: Remediation Action Form */}
              <form
                onSubmit={handleSaveRemediation}
                className="space-y-4 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5 lg:col-span-5"
              >
                <h3 className="text-base font-bold text-[#0F172A]">
                  Update Remediation Status
                </h3>

                {!canTriage ? (
                  <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#B45309]">
                    Read-only Viewer role cannot modify remediation status.
                  </div>
                ) : null}

                {saveError ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-3 text-xs text-[#BE123C]"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{saveError}</span>
                  </div>
                ) : null}

                {saveSuccess ? (
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-3 text-xs text-[#065F46]"
                  >
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#059669]"
                      aria-hidden="true"
                    />
                    <span>{saveSuccess}</span>
                  </div>
                ) : null}

                <div>
                  <label
                    htmlFor="rem-status"
                    className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                  >
                    Manual Triage Status
                  </label>
                  <select
                    id="rem-status"
                    disabled={!canTriage}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as RemediationStatus)}
                    className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-xs text-[#0F172A]"
                  >
                    <option value="Open">Open</option>
                    <option value="In progress">In progress</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Accepted risk">Accepted risk</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="rem-assignee"
                    className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                  >
                    Assignee
                  </label>
                  <input
                    id="rem-assignee"
                    type="text"
                    disabled={!canTriage}
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder="e.g., Platform Edge Team or owner@corp.example"
                    className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-xs text-[#0F172A]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="rem-due"
                    className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                  >
                    Due Date (UTC)
                  </label>
                  <input
                    id="rem-due"
                    type="date"
                    disabled={!canTriage}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 font-mono text-xs text-[#0F172A]"
                  />
                </div>

                {status === 'Accepted risk' && (
                  <div className="space-y-3 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[#B45309]">
                      Accepted Risk Governance (Required)
                    </div>
                    <div>
                      <label
                        htmlFor="rem-accepted-reason"
                        className="block text-xs font-medium text-[#0F172A]"
                      >
                        Risk Acceptance Reason
                      </label>
                      <textarea
                        id="rem-accepted-reason"
                        rows={3}
                        disabled={!canTriage}
                        value={acceptedReason}
                        onChange={(e) => setAcceptedReason(e.target.value)}
                        placeholder="Document compensating controls and business justification..."
                        className="mt-1 w-full rounded-xl border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="rem-accepted-review"
                        className="block text-xs font-medium text-[#0F172A]"
                      >
                        Mandatory Review Date (UTC)
                      </label>
                      <input
                        id="rem-accepted-review"
                        type="date"
                        disabled={!canTriage}
                        value={acceptedReviewDate}
                        onChange={(e) => setAcceptedReviewDate(e.target.value)}
                        className="mt-1 min-h-[36px] w-full rounded-xl border border-[#CBD5E1] bg-white px-2.5 font-mono text-xs text-[#0F172A]"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="rem-note"
                    className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                  >
                    Remediation Note
                  </label>
                  <textarea
                    id="rem-note"
                    rows={3}
                    disabled={!canTriage}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add ticket reference, rotation plan, or verification note..."
                    className="mt-1 w-full rounded-xl border border-[#CBD5E1] bg-white p-2.5 text-xs text-[#0F172A]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving || !canTriage}
                  className="min-h-[42px] w-full cursor-pointer rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving remediation...' : 'Save remediation'}
                </button>
              </form>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
