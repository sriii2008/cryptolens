import type {
  Role,
  SchedulerStatus,
  SyncRun,
  SyncRunRegionFailure,
  SyncRunStatus,
  SyncTrigger,
  DataSource,
} from '../shared/types.ts';
import {
  type AwsConnectorClients,
  createDefaultAwsConnectorClients,
  fetchRegionCertificates,
  formatAwsErrorMessage,
  resolveAwsSessionCredentials,
} from './aws-acm.ts';
import type { EcdatStore } from './store.ts';

const DEFAULT_SYNC_INTERVAL_HOURS = 6;
const DEFAULT_SYNC_INTERVAL_MS = DEFAULT_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;

export class SyncConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncConflictError';
  }
}

export function getSchedulerStatus(): SchedulerStatus {
  const hasSecret = Boolean(
    process.env.ECDAT_SCHEDULER_SECRET && process.env.ECDAT_SCHEDULER_SECRET.trim().length >= 16
  );
  const internalWorkerEnabled =
    process.env.ECDAT_ENABLE_INTERNAL_SCHEDULER?.trim().toLowerCase() === 'true';

  if (hasSecret) {
    return {
      configured: true,
      mode: 'cloud_scheduler',
      intervalHours: DEFAULT_SYNC_INTERVAL_HOURS,
      label: `Every ${DEFAULT_SYNC_INTERVAL_HOURS} hours (Cloud Scheduler endpoint armed)`,
    };
  }
  if (internalWorkerEnabled) {
    return {
      configured: true,
      mode: 'internal_worker',
      intervalHours: DEFAULT_SYNC_INTERVAL_HOURS,
      label: `Every ${DEFAULT_SYNC_INTERVAL_HOURS} hours (Background worker active)`,
    };
  }
  return {
    configured: false,
    mode: 'unconfigured',
    intervalHours: DEFAULT_SYNC_INTERVAL_HOURS,
    label: 'Schedule not configured',
  };
}

export class DataSourceSyncService {
  private readonly inFlightSources = new Set<string>();
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: EcdatStore,
    private readonly defaultClientsFactory: (region: string) => AwsConnectorClients = (region) =>
      createDefaultAwsConnectorClients(region)
  ) {}

  public isSyncRunning(sourceId: string): boolean {
    return this.inFlightSources.has(sourceId) || this.store.hasRunningSyncForSource(sourceId);
  }

  public async syncDataSource(params: {
    workspaceId: string;
    sourceId: string;
    trigger: SyncTrigger;
    actorEmail: string;
    actorRole: Role;
    clientsOverride?: AwsConnectorClients;
    retryDelayMs?: number;
  }): Promise<{ run: SyncRun; source: DataSource }> {
    const source = this.store.getDataSource(params.workspaceId, params.sourceId);
    if (!source) {
      throw new Error('Data source not found in workspace.');
    }

    if (this.inFlightSources.has(source.id) || this.store.hasRunningSyncForSource(source.id)) {
      throw new SyncConflictError(
        `A sync job is already running for "${source.name}". Wait for it to finish before starting another.`
      );
    }

    this.inFlightSources.add(source.id);
    const run = this.store.startSyncRun({
      workspaceId: params.workspaceId,
      sourceId: source.id,
      trigger: params.trigger,
      actorEmail: params.actorEmail,
      regions: source.regions,
    });

    const clients =
      params.clientsOverride ?? this.defaultClientsFactory(source.regions[0] || 'us-east-1');

    let insertedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let missingCount = 0;
    let totalObserved = 0;
    const regionsChecked: string[] = [];
    const failedRegions: SyncRunRegionFailure[] = [];
    let resolvedAccountId: string | null = source.awsAccountId;

    try {
      const session = await resolveAwsSessionCredentials(
        {
          authMode: source.authMode,
          awsAccountId: source.awsAccountId,
          roleArn: source.roleArn,
          externalId: source.externalId,
          regions: source.regions,
        },
        clients
      );
      resolvedAccountId = session.resolvedAccountId;

      for (const region of source.regions) {
        try {
          const acm = clients.createAcmClient(region, session.credentials);
          const records = await fetchRegionCertificates({
            region,
            acm,
            fallbackAccountId: resolvedAccountId,
            environmentDefault: source.environmentDefault,
            retryDelayMs: params.retryDelayMs,
          });
          const observedAtIso = new Date().toISOString();
          const applied = this.store.applyRegionSyncSuccess({
            workspaceId: params.workspaceId,
            sourceId: source.id,
            awsRegion: region,
            observedAtIso,
            actorEmail: params.actorEmail,
            records,
          });

          regionsChecked.push(region);
          insertedCount += applied.inserted;
          updatedCount += applied.updated;
          unchangedCount += applied.unchanged;
          missingCount += applied.missing;
          totalObserved += records.length;
        } catch (err) {
          failedRegions.push({
            region,
            error: formatAwsErrorMessage(err),
          });
        }
      }

      const status: SyncRunStatus =
        failedRegions.length === 0
          ? 'completed'
          : regionsChecked.length === 0
            ? 'failed'
            : 'partial';

      const errorMessage =
        failedRegions.length > 0
          ? failedRegions.map((f) => `${f.region}: ${f.error}`).join(' | ')
          : null;

      return this.store.finalizeSyncRun({
        workspaceId: params.workspaceId,
        sourceId: source.id,
        runId: run.id,
        status,
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        finishedAtIso: new Date().toISOString(),
        regionsChecked,
        failedRegions,
        insertedCount,
        updatedCount,
        unchangedCount,
        missingCount,
        totalObserved,
        resolvedAccountId,
        errorMessage,
      });
    } catch (err) {
      const msg = formatAwsErrorMessage(err);
      return this.store.finalizeSyncRun({
        workspaceId: params.workspaceId,
        sourceId: source.id,
        runId: run.id,
        status: 'failed',
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        finishedAtIso: new Date().toISOString(),
        regionsChecked,
        failedRegions:
          failedRegions.length > 0
            ? failedRegions
            : source.regions.map((region) => ({ region, error: msg })),
        insertedCount,
        updatedCount,
        unchangedCount,
        missingCount,
        totalObserved,
        resolvedAccountId,
        errorMessage: msg,
      });
    } finally {
      this.inFlightSources.delete(source.id);
    }
  }

  public async runScheduledSyncAll(actorEmail = 'scheduler@ecdat.system'): Promise<{
    sourcesProcessed: number;
    results: Array<{
      sourceId: string;
      workspaceId: string;
      status: SyncRunStatus | 'skipped_running';
      errorMessage: string | null;
    }>;
  }> {
    const sources = this.store.listAllConnectedDataSources();
    const results: Array<{
      sourceId: string;
      workspaceId: string;
      status: SyncRunStatus | 'skipped_running';
      errorMessage: string | null;
    }> = [];

    for (const source of sources) {
      if (this.isSyncRunning(source.id)) {
        results.push({
          sourceId: source.id,
          workspaceId: source.workspaceId,
          status: 'skipped_running',
          errorMessage: 'Sync already running',
        });
        continue;
      }
      const outcome = await this.syncDataSource({
        workspaceId: source.workspaceId,
        sourceId: source.id,
        trigger: 'scheduled',
        actorEmail,
        actorRole: 'Admin',
      });
      results.push({
        sourceId: source.id,
        workspaceId: source.workspaceId,
        status: outcome.run.status,
        errorMessage: outcome.run.errorMessage,
      });
    }

    return {
      sourcesProcessed: sources.length,
      results,
    };
  }

  public startBackgroundWorkerIfEnabled(): void {
    if (this.intervalHandle) return;
    if (process.env.ECDAT_ENABLE_INTERNAL_SCHEDULER?.trim().toLowerCase() !== 'true') {
      return;
    }
    this.intervalHandle = setInterval(() => {
      void this.runScheduledSyncAll('worker@ecdat.system').catch((err) => {
        console.error(
          '[ECDAT scheduler] background sync error:',
          err instanceof Error ? err.message : err
        );
      });
    }, DEFAULT_SYNC_INTERVAL_MS);
    this.intervalHandle.unref?.();
    console.log(
      `[ECDAT scheduler] background sync worker armed (every ${DEFAULT_SYNC_INTERVAL_HOURS} hours)`
    );
  }

  public stopBackgroundWorker(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
