import { useCallback, useEffect, useState } from 'react';
import type { AuthSessionState, OverviewStats, Role } from '../shared/types';
import { DataSourcesView } from './components/DataSourcesView';
import { EnterpriseLoginModal } from './components/EnterpriseLoginModal';
import { FindingsView, type FindingsFiltersState } from './components/FindingsView';
import { ImportsView } from './components/ImportsView';
import { InventoryView, type InventoryFiltersState } from './components/InventoryView';
import { LandingPage } from './components/LandingPage';
import { OverviewView } from './components/OverviewView';
import { ReportsView } from './components/ReportsView';
import { SettingsAuditView } from './components/SettingsAuditView';
import { WorkspaceShell, type WorkspaceTab } from './components/WorkspaceShell';
import {
  fetchAuthStatus,
  fetchOverview,
  logoutEnterprise,
  resetSampleWorkspace,
  syncDataSourceNow,
} from './lib/api';

const SAMPLE_WS_ID = 'ws-sample';

const DEFAULT_INVENTORY_FILTERS: InventoryFiltersState = {
  search: '',
  environment: 'all',
  assetType: 'all',
  algorithm: 'all',
  expiration: 'all',
  owner: 'all',
  sourceId: 'all',
  sortBy: 'validTo',
  sortDir: 'asc',
  page: 1,
};

const DEFAULT_FINDINGS_FILTERS: FindingsFiltersState = {
  search: '',
  severity: 'all',
  status: 'all',
  detectionState: 'all',
  environment: 'all',
  ruleId: 'all',
  page: 1,
};

function parseRouteFromLocation(): {
  inWorkspace: boolean;
  tab: WorkspaceTab;
} {
  if (typeof window === 'undefined') {
    return { inWorkspace: false, tab: 'overview' };
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
    return { inWorkspace: true, tab: 'overview' };
  }
  const p = window.location.pathname.toLowerCase();
  if (!p.startsWith('/workspace')) {
    return { inWorkspace: false, tab: 'overview' };
  }
  const seg = p.replace(/^\/workspace\/?/, '').split('/')[0];
  if (
    seg === 'data-sources' ||
    seg === 'inventory' ||
    seg === 'imports' ||
    seg === 'findings' ||
    seg === 'reports' ||
    seg === 'settings' ||
    seg === 'overview'
  ) {
    return { inWorkspace: true, tab: seg };
  }
  return { inWorkspace: true, tab: 'overview' };
}

export default function App() {
  const initialRoute = parseRouteFromLocation();

  const [inWorkspace, setInWorkspace] = useState(initialRoute.inWorkspace);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialRoute.tab);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(SAMPLE_WS_ID);

  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [samplePreviewOverview, setSamplePreviewOverview] =
    useState<OverviewStats | null>(null);
  const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewSyncing, setOverviewSyncing] = useState(false);
  const [overviewSyncBanner, setOverviewSyncBanner] = useState<string | null>(null);

  const [inventoryFilters, setInventoryFilters] = useState<InventoryFiltersState>(
    DEFAULT_INVENTORY_FILTERS
  );
  const [findingsFilters, setFindingsFilters] = useState<FindingsFiltersState>(
    DEFAULT_FINDINGS_FILTERS
  );
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  const [enterpriseModalOpen, setEnterpriseModalOpen] = useState(false);
  const [resettingSample, setResettingSample] = useState(false);
  const [viewEpoch, setViewEpoch] = useState(0);
  const [resetEpoch, setResetEpoch] = useState(0);

  const navigate = useCallback((nextInWorkspace: boolean, nextTab: WorkspaceTab = 'overview') => {
    setInWorkspace(nextInWorkspace);
    setActiveTab(nextTab);
    if (typeof window !== 'undefined') {
      const targetPath = nextInWorkspace ? `/workspace/${nextTab}` : '/';
      if (window.location.pathname !== targetPath) {
        window.history.pushState(null, '', targetPath);
      }
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const parsed = parseRouteFromLocation();
      setInWorkspace(parsed.inWorkspace);
      setActiveTab(parsed.tab);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const refreshAuthAndSample = useCallback(async () => {
    try {
      const [authRes, sampleRes] = await Promise.all([
        fetchAuthStatus(),
        fetchOverview(SAMPLE_WS_ID),
      ]);
      setSession(authRes);
      setSamplePreviewOverview(sampleRes);
    } catch {
      // handled gracefully in view states
    }
  }, []);

  useEffect(() => {
    void refreshAuthAndSample();
  }, [refreshAuthAndSample]);

  const loadActiveOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const stats = await fetchOverview(activeWorkspaceId);
      setOverviewStats(stats);
      if (activeWorkspaceId === SAMPLE_WS_ID) {
        setSamplePreviewOverview(stats);
      }
    } catch (err) {
      setOverviewError(
        err instanceof Error ? err.message : 'Unable to load workspace overview.'
      );
    } finally {
      setOverviewLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (inWorkspace) {
      void loadActiveOverview();
    }
  }, [inWorkspace, activeWorkspaceId, viewEpoch, loadActiveOverview]);

  const activeWsMeta =
    session?.workspaces.find((w) => w.workspace.id === activeWorkspaceId) ??
    session?.workspaces[0] ??
    null;

  const currentWorkspace = activeWsMeta?.workspace ?? null;
  const currentRole: Role = activeWsMeta?.role ?? 'Analyst';

  const handleOpenSampleOverview = () => {
    setOverviewSyncBanner(null);
    setActiveWorkspaceId(SAMPLE_WS_ID);
    navigate(true, 'overview');
  };

  const handleOpenLiveWorkspace = () => {
    const liveWs = session?.authenticated
      ? session.workspaces.find((w) => !w.workspace.isSample)
      : undefined;
    if (liveWs) {
      setOverviewSyncBanner(null);
      setActiveWorkspaceId(liveWs.workspace.id);
      navigate(true, 'overview');
    } else {
      setEnterpriseModalOpen(true);
    }
  };

  const handleOpenImportFromLanding = () => {
    const enterpriseWs = session?.authenticated
      ? session.workspaces.find((w) => !w.workspace.isSample)
      : undefined;
    setActiveWorkspaceId(enterpriseWs ? enterpriseWs.workspace.id : SAMPLE_WS_ID);
    navigate(true, 'imports');
  };

  const handleResetSample = async () => {
    setResettingSample(true);
    try {
      await resetSampleWorkspace(SAMPLE_WS_ID);
      setInventoryFilters(DEFAULT_INVENTORY_FILTERS);
      setFindingsFilters(DEFAULT_FINDINGS_FILTERS);
      setSelectedFindingId(null);
      setResetEpoch((v) => v + 1);
      setViewEpoch((v) => v + 1);
      await refreshAuthAndSample();
    } finally {
      setResettingSample(false);
    }
  };

  const handleLogout = async () => {
    await logoutEnterprise();
    const nextAuth = await fetchAuthStatus();
    setSession(nextAuth);
    setOverviewSyncBanner(null);
    setActiveWorkspaceId(SAMPLE_WS_ID);
    navigate(false, 'overview');
  };

  const handleDataChanged = () => {
    setViewEpoch((v) => v + 1);
    void loadActiveOverview();
  };

  const handleSyncPrimaryFromOverview = async (sourceId: string) => {
    setOverviewSyncing(true);
    setOverviewSyncBanner(null);
    try {
      const res = await syncDataSourceNow(activeWorkspaceId, sourceId);
      if (res.syncRun.status === 'failed') {
        setOverviewSyncBanner(
          `Sync failed: ${res.syncRun.errorMessage ?? 'AWS error'}. Preserved previous snapshot.`
        );
      } else if (res.syncRun.totalObserved === 0) {
        setOverviewSyncBanner(
          `Sync finished (${res.syncRun.regionsChecked.join(', ')}): 0 certificates found.`
        );
      } else {
        setOverviewSyncBanner(
          `Sync completed: ${res.syncRun.totalObserved} certificate(s) observed (+${res.syncRun.insertedCount} new, ${res.syncRun.updatedCount} updated).`
        );
      }
      setViewEpoch((v) => v + 1);
      await loadActiveOverview();
    } catch (err) {
      setOverviewSyncBanner(
        err instanceof Error ? err.message : 'Unable to trigger data source sync.'
      );
    } finally {
      setOverviewSyncing(false);
    }
  };

  return (
    <>
      {!inWorkspace ? (
        <LandingPage
          session={session}
          sampleOverview={samplePreviewOverview}
          sampleLoading={!samplePreviewOverview}
          onOpenSampleOverview={handleOpenSampleOverview}
          onOpenLiveWorkspace={handleOpenLiveWorkspace}
          onOpenImportFlow={handleOpenImportFromLanding}
          onOpenEnterpriseModal={() => setEnterpriseModalOpen(true)}
        />
      ) : (
        <WorkspaceShell
          activeTab={activeTab}
          workspace={currentWorkspace}
          currentRole={currentRole}
          session={session}
          resettingSample={resettingSample}
          onSelectTab={(tab) => navigate(true, tab)}
          onSelectWorkspace={(wsId) => {
            setOverviewSyncBanner(null);
            setActiveWorkspaceId(wsId);
            setSelectedFindingId(null);
            setInventoryFilters(DEFAULT_INVENTORY_FILTERS);
            setFindingsFilters(DEFAULT_FINDINGS_FILTERS);
            setResetEpoch((v) => v + 1);
            setViewEpoch((v) => v + 1);
          }}
          onResetSample={() => void handleResetSample()}
          onBackToLanding={() => navigate(false, 'overview')}
          onOpenEnterpriseModal={() => setEnterpriseModalOpen(true)}
          onLogout={() => void handleLogout()}
        >
          {activeTab === 'overview' ? (
            <OverviewView
              stats={overviewStats}
              loading={overviewLoading}
              error={overviewError}
              workspace={currentWorkspace}
              currentRole={currentRole}
              warningDays={currentWorkspace?.settings.expiryWarningDays ?? 30}
              syncing={overviewSyncing}
              syncBanner={overviewSyncBanner}
              onRetry={() => void loadActiveOverview()}
              onNavigateInventory={(preset) => {
                setInventoryFilters({
                  ...DEFAULT_INVENTORY_FILTERS,
                  expiration: preset?.expiration ?? 'all',
                  algorithm: preset?.algorithm ?? 'all',
                  environment: preset?.environment ?? 'all',
                });
                navigate(true, 'inventory');
              }}
              onNavigateFindings={(preset) => {
                setFindingsFilters({
                  ...DEFAULT_FINDINGS_FILTERS,
                  severity: preset?.severity ?? 'all',
                  status: preset?.status ?? 'all',
                });
                setSelectedFindingId(null);
                navigate(true, 'findings');
              }}
              onOpenFindingDetail={(findingId) => {
                setSelectedFindingId(findingId);
                navigate(true, 'findings');
              }}
              onOpenDataSources={() => navigate(true, 'data-sources')}
              onOpenImports={() => navigate(true, 'imports')}
              onSyncNow={(sourceId) => void handleSyncPrimaryFromOverview(sourceId)}
            />
          ) : null}

          {activeTab === 'data-sources' ? (
            <DataSourcesView
              key={`ds-${activeWorkspaceId}-${resetEpoch}`}
              workspaceId={activeWorkspaceId}
              workspace={currentWorkspace}
              currentRole={currentRole}
              onDataChanged={handleDataChanged}
              onOpenEnterpriseModal={() => setEnterpriseModalOpen(true)}
            />
          ) : null}

          {activeTab === 'inventory' ? (
            <InventoryView
              key={`inv-${activeWorkspaceId}-${resetEpoch}`}
              workspaceId={activeWorkspaceId}
              workspace={currentWorkspace}
              filters={inventoryFilters}
              onChangeFilters={setInventoryFilters}
              onOpenFindingDetail={(findingId) => {
                setSelectedFindingId(findingId);
                navigate(true, 'findings');
              }}
            />
          ) : null}

          {activeTab === 'imports' ? (
            <ImportsView
              key={`imp-${activeWorkspaceId}-${resetEpoch}`}
              workspaceId={activeWorkspaceId}
              currentRole={currentRole}
              onImportConfirmed={handleDataChanged}
            />
          ) : null}

          {activeTab === 'findings' ? (
            <FindingsView
              key={`fnd-${activeWorkspaceId}-${resetEpoch}`}
              workspaceId={activeWorkspaceId}
              currentRole={currentRole}
              filters={findingsFilters}
              selectedFindingId={selectedFindingId}
              onChangeFilters={setFindingsFilters}
              onSelectFinding={setSelectedFindingId}
              onRemediationSaved={handleDataChanged}
            />
          ) : null}

          {activeTab === 'reports' ? (
            <ReportsView
              key={`rep-${activeWorkspaceId}-${resetEpoch}`}
              workspaceId={activeWorkspaceId}
            />
          ) : null}

          {activeTab === 'settings' ? (
            <SettingsAuditView
              key={`set-${activeWorkspaceId}-${resetEpoch}`}
              workspaceId={activeWorkspaceId}
              onSettingsUpdated={handleDataChanged}
              onOpenEnterpriseModal={() => setEnterpriseModalOpen(true)}
            />
          ) : null}
        </WorkspaceShell>
      )}

      <EnterpriseLoginModal
        open={enterpriseModalOpen}
        session={session}
        onClose={() => setEnterpriseModalOpen(false)}
        onSuccess={(nextSession) => {
          setSession(nextSession);
          const firstEnterprise = nextSession.workspaces.find((w) => !w.workspace.isSample);
          if (firstEnterprise) {
            setOverviewSyncBanner(null);
            setActiveWorkspaceId(firstEnterprise.workspace.id);
            navigate(true, 'overview');
          }
        }}
      />
    </>
  );
}
