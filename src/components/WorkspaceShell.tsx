import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Cloud,
  Database,
  FileSpreadsheet,
  FileUp,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  RotateCcw,
  Settings,
  X,
} from 'lucide-react';
import type { AuthSessionState, Role, Workspace } from '../../shared/types';

export type WorkspaceTab =
  | 'overview'
  | 'data-sources'
  | 'inventory'
  | 'imports'
  | 'findings'
  | 'reports'
  | 'settings';

interface WorkspaceShellProps {
  activeTab: WorkspaceTab;
  workspace: Workspace | null;
  currentRole: Role;
  session: AuthSessionState | null;
  resettingSample: boolean;
  onSelectTab: (tab: WorkspaceTab) => void;
  onSelectWorkspace: (wsId: string) => void;
  onResetSample: () => void;
  onBackToLanding: () => void;
  onOpenEnterpriseModal: () => void;
  onLogout: () => void;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'data-sources', label: 'Data Sources', icon: Cloud },
  { id: 'inventory', label: 'Inventory', icon: Database },
  { id: 'findings', label: 'Findings & Remediation', icon: AlertTriangle },
  { id: 'imports', label: 'Imports', icon: FileUp },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
  { id: 'settings', label: 'Settings & Audit', icon: Settings },
];

export function WorkspaceShell({
  activeTab,
  workspace,
  currentRole,
  session,
  resettingSample,
  onSelectTab,
  onSelectWorkspace,
  onResetSample,
  onBackToLanding,
  onOpenEnterpriseModal,
  onLogout,
  children,
}: WorkspaceShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Overview';

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-4">
      <div>
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-1.5 pb-4">
          <button
            type="button"
            onClick={onBackToLanding}
            className="flex cursor-pointer items-center gap-2.5 text-left"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#38BDF8] to-[#2563EB] text-xs font-extrabold text-white shadow-xs">
              E
            </span>
            <div>
              <div className="font-display text-base font-extrabold tracking-tight text-[#0F172A]">
                ECDAT
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#64748B]">
                cryptolens
              </div>
            </div>
          </button>
        </div>

        {/* Workspace Selector & Sample vs Live Indicator */}
        <div className="mt-4 mb-5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.06em]">
            <span
              className={
                workspace?.isSample
                  ? 'font-semibold text-[#B45309]'
                  : 'font-semibold text-[#0284C7]'
              }
            >
              {workspace?.isSample ? 'Sample Workspace' : 'Live Workspace'}
            </span>
            <span className="rounded-full bg-[#EFF8FF] px-2 py-0.5 font-semibold text-[#0284C7]">
              {currentRole}
            </span>
          </div>

          {session && session.workspaces.length > 1 ? (
            <select
              aria-label="Active workspace"
              value={workspace?.id ?? ''}
              onChange={(e) => onSelectWorkspace(e.target.value)}
              className="mt-2.5 w-full rounded-xl border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs font-semibold text-[#0F172A] focus:border-[#0EA5E9] focus:outline-none"
            >
              {session.workspaces.map((w) => (
                <option key={w.workspace.id} value={w.workspace.id}>
                  {w.workspace.name} ({w.role})
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-2 text-sm font-bold leading-snug text-[#0F172A]">
              {workspace?.name ?? 'Northstar Sample Workspace'}
            </div>
          )}

          {workspace?.isSample ? (
            <button
              type="button"
              onClick={onResetSample}
              disabled={resettingSample}
              className="mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-2.5 py-1.5 font-mono text-[11px] font-medium text-[#0F172A] transition-colors hover:border-[#0284C7] hover:text-[#0284C7] disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {resettingSample ? 'Resetting sample...' : 'Reset sample data'}
            </button>
          ) : null}
        </div>

        <nav aria-label="Workspace navigation" className="space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  setMobileMenuOpen(false);
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[40px] w-full cursor-pointer items-center gap-2.5 rounded-xl px-3.5 py-2 text-left text-xs transition-all whitespace-nowrap ${
                  active
                    ? 'border border-[#38BDF8] bg-[#EFF8FF] font-bold text-[#0284C7] shadow-2xs'
                    : 'border border-transparent font-medium text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-[#0284C7]' : 'text-[#64748B]'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-[#E2E8F0] pt-4 text-xs">
        {session?.authenticated ? (
          <div className="space-y-2.5">
            <div className="truncate rounded-xl bg-[#F8FAFC] px-3 py-2 font-mono text-[11px] text-[#475569]">
              {session.actorEmail}
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex min-h-[38px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7]"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenEnterpriseModal}
            className="inline-flex min-h-[38px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#BAE6FD] bg-[#EFF8FF] px-3 py-2 text-xs font-semibold text-[#0284C7] transition-colors hover:bg-[#E0F2FE]"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Connect Live Workspace
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen gap-4 p-0 text-[#0F172A] lg:p-4">
      {/* Curved Frosted Desktop Sidebar */}
      <aside className="no-print ecdat-glass-card hidden w-[264px] shrink-0 rounded-3xl lg:block">
        <div className="sticky top-4 h-[calc(100vh-2rem)] overflow-y-auto">
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen ? (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 m-2 h-[calc(100%-1rem)] w-[272px] rounded-3xl border border-[#E2E8F0] bg-white shadow-xl">
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close workspace navigation"
                className="rounded-xl p-2 text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-3 sm:p-4 lg:p-0">
        <header className="no-print ecdat-glass-card sticky top-3 z-20 rounded-2xl px-4 py-3 sm:px-6 lg:top-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open workspace navigation"
                className="rounded-xl border border-[#CBD5E1] bg-white p-2 text-[#0F172A] hover:border-[#0284C7] lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>

              <div className="flex min-w-0 items-center gap-2.5 text-sm">
                <span className="hidden font-mono text-xs text-[#64748B] sm:inline">
                  {workspace?.name ?? 'Northstar Sample Workspace'}
                </span>
                <span className="hidden text-[#CBD5E1] sm:inline" aria-hidden="true">
                  /
                </span>
                <h1 className="font-display truncate text-lg font-extrabold tracking-tight text-[#0F172A]">
                  {activeLabel}
                </h1>
                {workspace?.isSample ? (
                  <span className="ml-1 hidden rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[#B45309] sm:inline-block">
                    Sample data
                  </span>
                ) : (
                  <span className="ml-1 hidden rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[#047857] sm:inline-block">
                    Live workspace
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!workspace?.isSample && activeTab !== 'data-sources' ? (
                <button
                  type="button"
                  onClick={() => onSelectTab('data-sources')}
                  className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shadow-xs hover:opacity-95"
                >
                  <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                  Data Sources
                </button>
              ) : null}

              {currentRole !== 'Viewer' && activeTab !== 'imports' ? (
                <button
                  type="button"
                  onClick={() => onSelectTab('imports')}
                  className={`inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    workspace?.isSample
                      ? 'bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] text-white shadow-xs hover:opacity-95'
                      : 'border border-[#CBD5E1] bg-white text-[#475569] hover:border-[#0284C7] hover:text-[#0284C7]'
                  }`}
                >
                  <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                  Import inventory
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
