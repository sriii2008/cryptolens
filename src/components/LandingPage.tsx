import {
  ArrowRight,
  Cloud,
  FileUp,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { AuthSessionState, OverviewStats } from '../../shared/types';
import {
  formatDaysUntil,
  formatShortUtcDate,
  severitySurfaceClass,
  truncateFingerprint,
} from '../lib/format';
import { GradientAsciiBackground } from './GradientAsciiBackground';

interface LandingPageProps {
  session: AuthSessionState | null;
  sampleOverview: OverviewStats | null;
  sampleLoading: boolean;
  onOpenSampleOverview: () => void;
  onOpenLiveWorkspace: () => void;
  onOpenImportFlow: () => void;
  onOpenEnterpriseModal: () => void;
}

export function LandingPage({
  session,
  sampleOverview,
  sampleLoading,
  onOpenSampleOverview,
  onOpenLiveWorkspace,
  onOpenImportFlow,
  onOpenEnterpriseModal,
}: LandingPageProps) {
  const preview = sampleOverview?.samplePreviewAsset ?? null;

  return (
    <div className="min-h-screen text-[#0F172A]">
      {/* Curved Floating Header */}
      <div className="sticky top-0 z-20 px-4 pt-3 sm:px-6 lg:px-8">
        <header className="ecdat-glass-card mx-auto flex max-w-[1280px] items-center justify-between gap-6 rounded-2xl px-5 py-3">
          <a
            href="#top"
            className="flex items-center gap-2.5 text-[#0F172A] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0284C7]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#38BDF8] to-[#2563EB] text-xs font-extrabold text-white shadow-xs">
              E
            </span>
            <span className="font-display text-lg font-extrabold tracking-tight">ECDAT</span>
            <span className="hidden rounded-full border border-[#BAE6FD] bg-[#EFF8FF] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0284C7] sm:inline-block">
              cryptolens
            </span>
          </a>

          <nav
            aria-label="Primary"
            className="hidden items-center gap-2 text-xs font-semibold text-[#475569] md:flex"
          >
            <a
              href="#capabilities"
              className="rounded-xl px-3 py-2 transition-colors hover:bg-[#EFF8FF] hover:text-[#0284C7] whitespace-nowrap"
            >
              Capabilities
            </a>
            <a
              href="#sample-preview"
              className="rounded-xl px-3 py-2 transition-colors hover:bg-[#EFF8FF] hover:text-[#0284C7] whitespace-nowrap"
            >
              Sample Preview
            </a>
            <a
              href="#workflow"
              className="rounded-xl px-3 py-2 transition-colors hover:bg-[#EFF8FF] hover:text-[#0284C7] whitespace-nowrap"
            >
              AWS Sync
            </a>
            <button
              type="button"
              onClick={onOpenEnterpriseModal}
              className="cursor-pointer rounded-xl px-3 py-2 text-[#475569] transition-colors hover:bg-[#EFF8FF] hover:text-[#0284C7] whitespace-nowrap"
            >
              {session?.authenticated ? 'Enterprise Session' : 'Enterprise Sign-In'}
            </button>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenSampleOverview}
              className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-xl border border-[#38BDF8] bg-[#EFF8FF] px-4 py-2 text-xs font-semibold text-[#0284C7] whitespace-nowrap transition-colors hover:bg-[#E0F2FE]"
            >
              Open sample workspace
            </button>
          </div>
        </header>
      </div>

      {/* Hero Section with Curved Frosted Containers & GradientASCII */}
      <main id="top" className="px-4 pt-5 pb-12 sm:px-6 lg:px-8">
        <section className="relative mx-auto max-w-[1280px] overflow-hidden rounded-[32px] border border-[#E2E8F0] bg-white/80 shadow-[0_20px_60px_-24px_rgba(14,165,233,0.18)] backdrop-blur-md">
          <GradientAsciiBackground />

          <div className="relative z-10 px-6 py-12 sm:px-10 sm:py-16 lg:px-12 lg:py-20">
            <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
              {/* Left Column inside soft curved glass framing */}
              <div className="lg:col-span-7">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#BAE6FD] bg-white/90 px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0284C7] shadow-xs">
                  <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>ECDAT · Continuous Cloud &amp; X.509 Discovery</span>
                </div>

                <h1
                  className="font-display mt-5 max-w-2xl text-4xl font-extrabold tracking-[-0.025em] text-[#0F172A] sm:text-5xl lg:text-[3.25rem] lg:leading-[1.08]"
                  style={{ textWrap: 'balance' }}
                >
                  Enterprise Cryptographic Discovery &amp; Analysis Tool
                </h1>

                <p className="mt-5 max-w-xl text-base leading-relaxed text-[#475569] sm:text-lg">
                  Inventory certificates across AWS Certificate Manager and authorized exports,
                  prioritize risks automatically, and track remediation in one workspace.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    onClick={onOpenLiveWorkspace}
                    className="inline-flex min-h-[46px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_-8px_rgba(37,99,235,0.45)] whitespace-nowrap shrink-0 transition-transform hover:-translate-y-0.5"
                  >
                    <Cloud className="h-4 w-4" aria-hidden="true" />
                    {session?.authenticated ? 'Open live workspace' : 'Connect live workspace'}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    onClick={onOpenSampleOverview}
                    className="inline-flex min-h-[46px] cursor-pointer items-center gap-2 rounded-2xl border border-[#CBD5E1] bg-white/95 px-5 py-3 text-sm font-semibold text-[#0F172A] whitespace-nowrap shrink-0 transition-colors hover:border-[#38BDF8] hover:bg-[#EFF8FF] hover:text-[#0284C7]"
                  >
                    Open sample workspace
                  </button>

                  <button
                    type="button"
                    onClick={onOpenImportFlow}
                    className="inline-flex min-h-[46px] cursor-pointer items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC]/90 px-4 py-3 text-xs font-semibold text-[#475569] whitespace-nowrap shrink-0 transition-colors hover:border-[#CBD5E1] hover:text-[#0F172A]"
                  >
                    <FileUp className="h-4 w-4 text-[#0284C7]" aria-hidden="true" />
                    Import file
                  </button>
                </div>

                <p className="mt-4 font-mono text-[11px] text-[#64748B]">
                  {session?.authenticated
                    ? `Signed in as ${session.actorEmail} · Live AWS ACM & Enterprise workspaces active`
                    : 'Sample workspace works with no account · Sign in as Admin to connect AWS Certificate Manager'}
                </p>
              </div>

              {/* Right Column: Curved Frosted "Sample data" Preview Card */}
              <div id="sample-preview" className="lg:col-span-5">
                <aside
                  aria-label="Sample data inventory preview"
                  className="rounded-3xl border border-[#E2E8F0] bg-white/95 p-6 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.12)] backdrop-blur-md"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3.5">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[#BAE6FD] bg-[#EFF8FF] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[#0284C7] whitespace-nowrap">
                      <span>Sample data</span>
                      <span aria-hidden="true">·</span>
                      <span>Read-only</span>
                    </div>
                    <span className="font-mono text-xs font-bold text-[#0F172A] tabular-nums whitespace-nowrap">
                      {sampleOverview ? `${sampleOverview.totalAssets} assets` : 'Sample'}
                    </span>
                  </div>

                  {sampleLoading && !preview ? (
                    <div className="space-y-4 py-5">
                      <div className="h-5 w-2/3 animate-pulse rounded-xl bg-[#F1F5F9]" />
                      <div className="h-4 w-1/2 animate-pulse rounded-xl bg-[#F1F5F9]" />
                      <div className="h-24 w-full animate-pulse rounded-2xl bg-[#F8FAFC]" />
                    </div>
                  ) : preview ? (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#64748B]">
                          Tracked Certificate
                        </div>
                        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                          <h2 className="font-mono text-sm font-bold text-[#0F172A] break-all">
                            {preview.asset.name}
                          </h2>
                          <span className="rounded-full bg-[#E0F2FE] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#0284C7]">
                            {preview.asset.environment}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-[#64748B]">
                          <span>
                            {preview.asset.algorithm}
                            {preview.asset.keySize ? `-${preview.asset.keySize}` : ''}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{truncateFingerprint(preview.asset.fingerprintSha256)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3.5">
                          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                            Expiration (UTC)
                          </div>
                          <div className="mt-1 font-mono text-sm font-bold text-[#0F172A] tabular-nums">
                            {formatShortUtcDate(preview.asset.validTo)}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] font-semibold text-[#B45309]">
                            {formatDaysUntil(preview.asset.validTo)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3.5">
                          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                            Assigned Owner
                          </div>
                          <div className="mt-1 text-sm font-bold text-[#0F172A]">
                            {preview.asset.owner ?? 'Unknown'}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-[#64748B] truncate">
                            {preview.asset.location}
                          </div>
                        </div>
                      </div>

                      {preview.topFinding ? (
                        <div className="rounded-2xl border border-[#FECDD3] bg-[#FFF1F2]/80 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[#BE123C]">
                              <ShieldAlert className="h-3.5 w-3.5 text-[#BE123C]" aria-hidden="true" />
                              {preview.topFinding.severity} severity finding
                            </span>
                            <span
                              className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${severitySurfaceClass(
                                preview.topFinding.severity
                              )}`}
                            >
                              {preview.topFinding.status}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-bold text-[#0F172A]">
                            {preview.topFinding.title}
                          </p>
                          <p className="mt-1 font-mono text-[11px] leading-relaxed text-[#475569]">
                            {preview.topFinding.evidence}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="py-6 text-sm text-[#64748B]">
                      Sample inventory ready to inspect inside the workspace.
                    </p>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </section>

        {/* Curved Capability Bento Grid */}
        <section id="capabilities" className="mx-auto mt-12 max-w-[1280px]">
          <div className="max-w-2xl px-1">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0284C7]">
              Audit Architecture
            </div>
            <h2 className="font-display mt-2 text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">
              Live cloud discovery &amp; deterministic governance
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#475569]">
              Every risk finding is computed deterministically in UTC from live AWS ACM connectors
              and user-supplied X.509 certificate metadata—never private keys.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-3">
            <div className="ecdat-glass-card rounded-3xl p-6">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EFF8FF] text-[#0284C7]">
                <Cloud className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0284C7]">
                01 · AWS ACM Connector
              </div>
              <h3 className="mt-1.5 text-lg font-bold text-[#0F172A]">
                Multi-Region Live Sync
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#475569]">
                Connect AWS accounts via workload identity or STS AssumeRole with unique External
                IDs. Enumerates RSA, ECDSA, and ACME certificates every 6 hours automatically.
              </p>
            </div>

            <div className="ecdat-glass-card rounded-3xl p-6">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#FFFBEB] text-[#B45309]">
                <RefreshCw className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#B45309]">
                02 · Deterministic Rules
              </div>
              <h3 className="mt-1.5 text-lg font-bold text-[#0F172A]">
                Change Detection &amp; Evidence
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#475569]">
                Detects expired or expiring certificates, weak RSA keys, and legacy signatures.
                Re-syncs preserve existing remediation assignments, owners, and notes.
              </p>
            </div>

            <div className="ecdat-glass-card rounded-3xl p-6">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ECFDF5] text-[#047857]">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#047857]">
                03 · Remediation &amp; Exports
              </div>
              <h3 className="mt-1.5 text-lg font-bold text-[#0F172A]">
                Accountable Posture Tracking
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#475569]">
                Track remediation SLAs, enforce risk-acceptance justification and review dates, and
                export filtered executive summaries and formula-safe CSV reports.
              </p>
            </div>
          </div>
        </section>

        {/* Curved CTA Card */}
        <section id="workflow" className="mx-auto mt-10 max-w-[1280px]">
          <div className="ecdat-glass-card flex flex-col justify-between gap-6 rounded-3xl p-7 sm:p-9 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0284C7]">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Zero-Friction Evaluation
              </div>
              <h2 className="font-display mt-2 text-2xl font-bold text-[#0F172A]">
                Explore the Northstar sample workspace or connect live AWS accounts
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-[#475569]">
                Keep fictional sample records isolated from live workspace inventory. Sign in as
                Admin to configure STS AssumeRole, run real connection tests, and sync every 6 hours.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={onOpenSampleOverview}
                className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl bg-[#0F172A] px-5 py-2.5 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#0284C7]"
              >
                Open sample workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onOpenEnterpriseModal}
                className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl border border-[#CBD5E1] bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] whitespace-nowrap transition-colors hover:border-[#38BDF8] hover:text-[#0284C7]"
              >
                <Lock className="h-4 w-4 text-[#64748B]" aria-hidden="true" />
                Enterprise sign-in
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-white/75 px-5 py-4 text-xs text-[#475569] sm:flex-row sm:items-center">
          <div>
            <span className="font-display font-bold text-[#0F172A]">ECDAT</span>
            <span className="mx-2 text-[#CBD5E1]" aria-hidden="true">
              |
            </span>
            <span>cryptolens Enterprise Cryptographic Discovery &amp; Analysis Tool</span>
          </div>
          <div className="font-mono text-[11px] text-[#64748B]">
            Read-only AWS ACM metadata &amp; public X.509 inspection · Private keys rejected
          </div>
        </div>
      </footer>
    </div>
  );
}
