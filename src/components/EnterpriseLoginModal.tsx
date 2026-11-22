import { useState } from 'react';
import { Check, Copy, Lock, X } from 'lucide-react';
import type { AuthSessionState } from '../../shared/types';
import { loginEnterprise } from '../lib/api';

interface EnterpriseLoginModalProps {
  open: boolean;
  session: AuthSessionState | null;
  onClose: () => void;
  onSuccess: (nextSession: AuthSessionState) => void;
}

const SETUP_SNIPPET = `# Generate scrypt password hash + secrets in Node 22:
node -e "
const c = require('crypto');
const salt = c.randomBytes(16).toString('hex');
const hash = c.scryptSync('ReplaceWithStrongPassword!', salt, 64).toString('hex');
console.log('ECDAT_ENTERPRISE_AUTH_SECRET=' + c.randomBytes(32).toString('hex'));
console.log('ECDAT_SCHEDULER_SECRET=' + c.randomBytes(32).toString('hex'));
console.log('ECDAT_ENTERPRISE_USERS_JSON=' + JSON.stringify([{
  email: 'admin@corp.example',
  name: 'Security Admin',
  passwordHash: salt + ':' + hash,
  workspaces: { 'ws-live': 'Admin' }
}]));
"`;

export function EnterpriseLoginModal({
  open,
  session,
  onClose,
  onSuccess,
}: EnterpriseLoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const configured = session?.enterpriseConfigured ?? false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await loginEnterprise(email, password);
      onSuccess(res.session);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopySnippet = () => {
    void navigator.clipboard?.writeText(SETUP_SNIPPET);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="enterprise-auth-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/45 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-3xl border border-[#E2E8F0] bg-white p-6 text-[#0F172A] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EFF8FF] text-[#0284C7]">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 id="enterprise-auth-title" className="text-lg font-bold text-[#0F172A]">
              Live Enterprise Workspace Sign-In
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close enterprise sign-in dialog"
            className="cursor-pointer rounded-xl p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!configured ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-xs text-[#0F172A]">
              <p className="font-bold text-[#B45309]">
                Enterprise authentication secrets are not configured yet
              </p>
              <p className="mt-1.5 leading-relaxed text-[#475569]">
                To unlock Live Enterprise Workspaces and AWS ACM connectors, set{' '}
                <code className="font-mono font-semibold text-[#0284C7]">
                  ECDAT_ENTERPRISE_AUTH_SECRET
                </code>{' '}
                and{' '}
                <code className="font-mono font-semibold text-[#0284C7]">
                  ECDAT_ENTERPRISE_USERS_JSON
                </code>{' '}
                in your server environment (with <code className="font-mono">ws-live</code>{' '}
                mapped to <code className="font-mono">Admin</code>).
              </p>
            </div>

            <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[#475569]">
                  Quick Secret Generator Command
                </span>
                <button
                  type="button"
                  onClick={handleCopySnippet}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1 font-mono text-[10px] font-medium text-[#0284C7]"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-[#059669]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy command
                    </>
                  )}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white p-2.5 font-mono text-[10px] leading-relaxed text-[#334155]">
                {SETUP_SNIPPET}
              </pre>
            </div>

            <p className="text-xs text-[#64748B]">
              You can continue exploring the isolated Northstar Sample Workspace without
              credentials.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] cursor-pointer rounded-2xl bg-[#0F172A] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0284C7]"
              >
                Return to sample mode
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {error ? (
              <div
                role="alert"
                className="rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] px-3.5 py-2.5 text-xs text-[#BE123C]"
              >
                {error}
              </div>
            ) : null}

            <div>
              <label
                htmlFor="ent-email"
                className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
              >
                Work email
              </label>
              <input
                id="ent-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@corp.example"
                className="mt-1.5 w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#64748B] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="ent-password"
                className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
              >
                Password
              </label>
              <input
                id="ent-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] cursor-pointer rounded-2xl border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:border-[#0284C7]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[40px] cursor-pointer rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-5 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-60"
              >
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
