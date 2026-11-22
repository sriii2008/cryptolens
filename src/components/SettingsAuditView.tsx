import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Lock, Shield } from 'lucide-react';
import type {
  AuditEvent,
  Role,
  SchedulerStatus,
  Workspace,
  WorkspaceMember,
} from '../../shared/types';
import {
  fetchSettingsAndAudit,
  patchWorkspaceSettings,
  upsertWorkspaceMember,
} from '../lib/api';
import { formatUtcDate } from '../lib/format';

interface SettingsAuditViewProps {
  workspaceId: string;
  onSettingsUpdated: () => void;
  onOpenEnterpriseModal: () => void;
}

export function SettingsAuditView({
  workspaceId,
  onSettingsUpdated,
  onOpenEnterpriseModal,
}: SettingsAuditViewProps) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [storageMode, setStorageMode] = useState<'sqlite' | 'file'>('sqlite');
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [enterpriseConfigured, setEnterpriseConfigured] = useState(false);
  const [currentRole, setCurrentRole] = useState<Role>('Analyst');

  const [warningDays, setWarningDays] = useState(30);
  const [minRsaBits, setMinRsaBits] = useState(2048);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState<Role>('Analyst');
  const [memberMsg, setMemberMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSettingsAndAudit(workspaceId);
      setWorkspace(res.workspace);
      setMembers(res.members);
      setAuditEvents(res.auditEvents);
      setStorageMode(res.storageMode);
      setScheduler(res.scheduler);
      setEnterpriseConfigured(res.enterpriseAuthConfigured);
      setCurrentRole(res.currentRole);
      setWarningDays(res.workspace.settings.expiryWarningDays);
      setMinRsaBits(res.workspace.settings.minRsaKeyBits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId]);

  const canEditRules =
    workspace?.isSample ? currentRole !== 'Viewer' : currentRole === 'Admin';
  const canManageMembers =
    enterpriseConfigured && !workspace?.isSample && currentRole === 'Admin';

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await patchWorkspaceSettings(workspaceId, {
        expiryWarningDays: Number(warningDays),
        minRsaKeyBits: Number(minRsaBits),
      });
      setSuccess(
        'Analysis rule thresholds updated. All workspace assets were re-evaluated.'
      );
      await load();
      onSettingsUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule thresholds.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setMemberMsg(null);
    setError(null);
    try {
      await upsertWorkspaceMember(workspaceId, {
        email: memberEmail.trim(),
        name: memberName.trim(),
        role: memberRole,
      });
      setMemberEmail('');
      setMemberName('');
      setMemberMsg('Workspace member saved and recorded in audit log.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save member.');
    }
  };

  if (loading && !workspace) {
    return (
      <div className="space-y-4">
        <div className="h-44 animate-pulse rounded-3xl border border-[#E2E8F0] bg-white/90" />
        <div className="h-64 animate-pulse rounded-3xl border border-[#E2E8F0] bg-white/90" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Rule Threshold Settings */}
        <section className="ecdat-glass-card rounded-3xl p-6 lg:col-span-6">
          <h2 className="text-lg font-bold text-[#0F172A]">
            Deterministic Analysis Rule Thresholds
          </h2>
          <p className="mt-1 text-xs text-[#64748B]">
            Adjusting thresholds immediately re-evaluates workspace assets in UTC while
            preserving remediation history.
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-3 text-xs text-[#BE123C]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {success ? (
            <div
              role="status"
              className="mt-4 flex items-start gap-2 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-3 text-xs text-[#065F46]"
            >
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-[#059669]"
                aria-hidden="true"
              />
              <span>{success}</span>
            </div>
          ) : null}

          <form onSubmit={handleSaveRules} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="set-expiry-days"
                className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
              >
                Certificate Expiry Warning Window (days)
              </label>
              <input
                id="set-expiry-days"
                type="number"
                min={1}
                max={365}
                disabled={!canEditRules}
                value={warningDays}
                onChange={(e) => setWarningDays(Number(e.target.value))}
                className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 font-mono text-xs text-[#0F172A]"
              />
            </div>

            <div>
              <label
                htmlFor="set-rsa-bits"
                className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
              >
                Minimum RSA Key Length (bits)
              </label>
              <select
                id="set-rsa-bits"
                disabled={!canEditRules}
                value={minRsaBits}
                onChange={(e) => setMinRsaBits(Number(e.target.value))}
                className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 font-mono text-xs text-[#0F172A]"
              >
                <option value={1024}>1024 bits</option>
                <option value={2048}>2048 bits (Recommended baseline)</option>
                <option value={3072}>3072 bits</option>
                <option value={4096}>4096 bits</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-3">
              <div className="space-y-0.5 font-mono text-[11px] text-[#64748B]">
                <div>
                  Storage: {storageMode === 'sqlite' ? 'SQLite (node:sqlite)' : 'File store'}
                </div>
                <div className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>{scheduler?.label ?? 'Schedule not configured'}</span>
                </div>
              </div>
              <button
                type="submit"
                disabled={!canEditRules || saving}
                className="min-h-[40px] cursor-pointer rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save thresholds'}
              </button>
            </div>
          </form>
        </section>

        {/* RBAC & Enterprise Access */}
        <section className="ecdat-glass-card rounded-3xl p-6 lg:col-span-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#0F172A]">Workspace Access &amp; Roles</h2>
            <span className="rounded-full border border-[#BAE6FD] bg-[#EFF8FF] px-3 py-0.5 font-mono text-xs font-semibold text-[#0284C7]">
              Role: {currentRole}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="font-mono font-bold text-[#0F172A]">Admin</div>
              <div className="mt-0.5 text-[11px] text-[#64748B]">Data sources &amp; policy</div>
            </div>
            <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="font-mono font-bold text-[#0F172A]">Analyst</div>
              <div className="mt-0.5 text-[11px] text-[#64748B]">Syncs, imports &amp; triage</div>
            </div>
            <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="font-mono font-bold text-[#0F172A]">Viewer</div>
              <div className="mt-0.5 text-[11px] text-[#64748B]">Read &amp; CSV exports</div>
            </div>
          </div>

          {!enterpriseConfigured || workspace?.isSample ? (
            <div className="mt-4 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-xs text-[#0F172A]">
              <div className="flex items-center gap-2 font-bold text-[#B45309]">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                {enterpriseConfigured
                  ? 'Viewing Sample Workspace'
                  : 'Enterprise Authentication Not Configured'}
              </div>
              <p className="mt-1 text-[#475569]">
                {enterpriseConfigured
                  ? 'Switch to an enterprise workspace via the sidebar or sign in to manage member roles.'
                  : 'Enterprise role and member provisioning is gated until ECDAT_ENTERPRISE_AUTH_SECRET is configured on the server.'}
              </p>
              <button
                type="button"
                onClick={onOpenEnterpriseModal}
                className="mt-2.5 cursor-pointer font-mono text-[11px] font-semibold text-[#0284C7] hover:underline"
              >
                View enterprise sign-in &amp; setup instructions
              </button>
            </div>
          ) : null}

          {canManageMembers ? (
            <form onSubmit={handleAddMember} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                type="email"
                required
                placeholder="user@corp.example"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                className="rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-2 text-xs text-[#0F172A]"
              />
              <input
                type="text"
                required
                placeholder="Full name"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                className="rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-2 text-xs text-[#0F172A]"
              />
              <select
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value as Role)}
                className="rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-2 text-xs text-[#0F172A]"
              >
                <option value="Admin">Admin</option>
                <option value="Analyst">Analyst</option>
                <option value="Viewer">Viewer</option>
              </select>
              <button
                type="submit"
                className="cursor-pointer rounded-xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-3 py-2 text-xs font-semibold text-white"
              >
                Save member
              </button>
            </form>
          ) : null}

          {memberMsg ? (
            <p className="mt-2 text-xs font-semibold text-[#047857]">{memberMsg}</p>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-2xl border border-[#E2E8F0]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                  <th className="px-3.5 py-2.5">Member</th>
                  <th className="px-3.5 py-2.5">Email</th>
                  <th className="px-3.5 py-2.5">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-3.5 py-2.5 font-semibold text-[#0F172A]">{m.name}</td>
                    <td className="px-3.5 py-2.5 font-mono text-[#475569]">{m.email}</td>
                    <td className="px-3.5 py-2.5 font-mono font-semibold text-[#0284C7]">
                      {m.role}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Audit Log */}
      <section className="ecdat-glass-card overflow-hidden rounded-3xl">
        <div className="flex items-center gap-2 border-b border-[#E2E8F0] bg-[#F8FAFC]/80 px-5 py-3.5">
          <Shield className="h-4 w-4 text-[#0284C7]" aria-hidden="true" />
          <h2 className="text-base font-bold text-[#0F172A]">Workspace Audit Log</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                <th className="px-4 py-2.5">Timestamp (UTC)</th>
                <th className="px-4 py-2.5">Actor</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Event</th>
                <th className="px-4 py-2.5">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {auditEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#64748B]">
                    No audit events recorded yet.
                  </td>
                </tr>
              ) : (
                auditEvents.map((evt) => (
                  <tr key={evt.id}>
                    <td className="px-4 py-3 font-mono text-[#64748B] tabular-nums whitespace-nowrap">
                      {formatUtcDate(evt.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#0F172A]">{evt.actorEmail}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-[#0284C7]">
                      {evt.actorRole}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#475569]">{evt.eventType}</td>
                    <td className="px-4 py-3 text-[#0F172A]">{evt.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
