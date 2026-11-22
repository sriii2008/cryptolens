import { useEffect, useState } from 'react';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FileSpreadsheet,
  Search,
  X,
} from 'lucide-react';
import type {
  CryptoAsset,
  DataSource,
  Finding,
  ImportRecord,
  Workspace,
} from '../../shared/types';
import { fetchAssetDetail, fetchAssets, fetchDataSources } from '../lib/api';
import {
  formatAssetTypeLabel,
  formatDaysUntil,
  formatShortUtcDate,
  formatUtcDate,
  remediationStatusClass,
  severitySurfaceClass,
  truncateFingerprint,
} from '../lib/format';

export interface InventoryFiltersState {
  search: string;
  environment: string;
  assetType: string;
  algorithm: string;
  expiration: string;
  owner: string;
  sourceId: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  page: number;
}

interface InventoryViewProps {
  workspaceId: string;
  workspace: Workspace | null;
  filters: InventoryFiltersState;
  onChangeFilters: (next: InventoryFiltersState) => void;
  onOpenFindingDetail: (findingId: string) => void;
}

export function InventoryView({
  workspaceId,
  workspace,
  filters,
  onChangeFilters,
  onOpenFindingDetail,
}: InventoryViewProps) {
  const [items, setItems] = useState<CryptoAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<{
    asset: CryptoAsset;
    findings: Finding[];
    sourceImport: ImportRecord | null;
    dataSource: DataSource | null;
  } | null>(null);

  const pageSize = 10;

  useEffect(() => {
    if (workspace?.isSample) {
      setDataSources([]);
      return;
    }
    let active = true;
    fetchDataSources(workspaceId)
      .then((res) => {
        if (active) setDataSources(res.items);
      })
      .catch(() => {
        if (active) setDataSources([]);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, workspace?.isSample]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchAssets(workspaceId, {
      ...filters,
      pageSize,
    })
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load inventory.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, filters]);

  useEffect(() => {
    if (!selectedAssetId) {
      setDetailData(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    fetchAssetDetail(workspaceId, selectedAssetId)
      .then((res) => {
        if (active) setDetailData(res);
      })
      .catch(() => {
        if (active) setDetailData(null);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, selectedAssetId]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleSort = (col: string) => {
    const nextDir =
      filters.sortBy === col && filters.sortDir === 'asc' ? 'desc' : 'asc';
    onChangeFilters({ ...filters, sortBy: col, sortDir: nextDir, page: 1 });
  };

  return (
    <div className="space-y-5">
      {/* Curved Filter Toolbar */}
      <section
        aria-label="Inventory filters"
        className="ecdat-glass-card rounded-3xl p-4 sm:p-5"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <div className="sm:col-span-2">
            <label htmlFor="inv-search" className="sr-only">
              Search assets
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]"
                aria-hidden="true"
              />
              <input
                id="inv-search"
                type="search"
                value={filters.search}
                onChange={(e) =>
                  onChangeFilters({ ...filters, search: e.target.value, page: 1 })
                }
                placeholder="Search domain, ARN, fingerprint, location..."
                className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] pl-9 pr-3 text-xs text-[#0F172A] placeholder:text-[#64748B] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="inv-env" className="sr-only">
              Environment
            </label>
            <select
              id="inv-env"
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
              <option value="unknown">Unknown</option>
            </select>
          </div>

          <div>
            <label htmlFor="inv-type" className="sr-only">
              Asset type
            </label>
            <select
              id="inv-type"
              value={filters.assetType}
              onChange={(e) =>
                onChangeFilters({ ...filters, assetType: e.target.value, page: 1 })
              }
              className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            >
              <option value="all">All asset types</option>
              <option value="certificate">X.509 Certificate</option>
              <option value="tls_endpoint">TLS Endpoint</option>
              <option value="kms_key">KMS Key</option>
              <option value="signing_key">Signing Key</option>
            </select>
          </div>

          <div>
            <label htmlFor="inv-alg" className="sr-only">
              Algorithm
            </label>
            <select
              id="inv-alg"
              value={filters.algorithm}
              onChange={(e) =>
                onChangeFilters({ ...filters, algorithm: e.target.value, page: 1 })
              }
              className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            >
              <option value="all">All algorithms</option>
              <option value="RSA">RSA</option>
              <option value="ECDSA">ECDSA</option>
              <option value="Ed25519">Ed25519</option>
              <option value="EdDSA">EdDSA</option>
            </select>
          </div>

          <div>
            <label htmlFor="inv-exp" className="sr-only">
              Expiration status
            </label>
            <select
              id="inv-exp"
              value={filters.expiration}
              onChange={(e) =>
                onChangeFilters({ ...filters, expiration: e.target.value, page: 1 })
              }
              className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            >
              <option value="all">All validity states</option>
              <option value="expired">Expired</option>
              <option value="expiring_30">Expiring within 30d</option>
              <option value="valid">Valid (&gt;30d)</option>
              <option value="unknown">Unknown expiry</option>
            </select>
          </div>

          <div>
            <label htmlFor="inv-source" className="sr-only">
              Data source
            </label>
            <select
              id="inv-source"
              value={filters.sourceId}
              onChange={(e) =>
                onChangeFilters({ ...filters, sourceId: e.target.value, page: 1 })
              }
              className="min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            >
              <option value="all">All sources</option>
              <option value="file_import">File Imports</option>
              {dataSources.map((src) => (
                <option key={src.id} value={src.id}>
                  {src.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(filters.search ||
          filters.environment !== 'all' ||
          filters.assetType !== 'all' ||
          filters.algorithm !== 'all' ||
          filters.expiration !== 'all' ||
          filters.owner !== 'all' ||
          filters.sourceId !== 'all') && (
          <div className="mt-3 flex items-center justify-between border-t border-[#E2E8F0] pt-3 font-mono text-[11px] text-[#64748B]">
            <span className="tabular-nums">{total} matching asset(s)</span>
            <button
              type="button"
              onClick={() =>
                onChangeFilters({
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
                })
              }
              className="cursor-pointer font-semibold text-[#0284C7] hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-4 text-xs text-[#BE123C]"
        >
          {error}
        </div>
      ) : null}

      {/* Curved Inventory Ledger Table */}
      <div className="ecdat-glass-card overflow-hidden rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex cursor-pointer items-center gap-1 hover:text-[#0F172A]"
                  >
                    Asset / Location
                    <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                  </button>
                </th>
                <th className="px-4 py-3">Source / Last Observed</th>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('environment')}
                    className="inline-flex cursor-pointer items-center gap-1 hover:text-[#0F172A]"
                  >
                    Environment
                    <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('algorithm')}
                    className="inline-flex cursor-pointer items-center gap-1 hover:text-[#0F172A]"
                  >
                    Algorithm
                    <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('validTo')}
                    className="inline-flex cursor-pointer items-center gap-1 hover:text-[#0F172A]"
                  >
                    Expires (UTC)
                    <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                  </button>
                </th>
                <th className="px-4 py-3">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {loading ? (
                [1, 2, 3, 4].map((row) => (
                  <tr key={row}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-5 w-full animate-pulse rounded-lg bg-[#F1F5F9]" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-[#64748B]">
                    No cryptographic assets match your active filters.
                  </td>
                </tr>
              ) : (
                items.map((asset) => {
                  const isSelected = selectedAssetId === asset.id;
                  const expired =
                    asset.validTo && Date.parse(asset.validTo) < Date.now();
                  return (
                    <tr
                      key={asset.id}
                      onClick={() => setSelectedAssetId(asset.id)}
                      className={`cursor-pointer transition-colors hover:bg-[#EFF8FF]/55 ${
                        isSelected ? 'bg-[#EFF8FF]' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAssetId(asset.id);
                            }}
                            className="cursor-pointer text-left font-mono text-xs font-bold text-[#0F172A] hover:text-[#0284C7]"
                          >
                            {asset.name}
                          </button>
                          {asset.missingFromSource ? (
                            <span className="rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#B45309]">
                              Missing in source
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#64748B]">
                          {formatAssetTypeLabel(asset.assetType)} ·{' '}
                          <span className="font-mono">{asset.location}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#0F172A]">
                          {asset.sourceId ? (
                            <Cloud className="h-3.5 w-3.5 text-[#0284C7]" aria-hidden="true" />
                          ) : (
                            <FileSpreadsheet
                              className="h-3.5 w-3.5 text-[#64748B]"
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            {asset.sourceName ??
                              (asset.sourceImportId ? 'File Import' : 'Sample Seed')}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-[#64748B] tabular-nums">
                          Observed: {formatShortUtcDate(asset.lastObservedAt ?? asset.updatedAt)}
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono text-[11px] capitalize text-[#475569]">
                        {asset.environment}
                      </td>

                      <td className="px-4 py-3 font-mono text-xs text-[#0F172A] tabular-nums">
                        <div>
                          {asset.algorithm}
                          {asset.keySize ? ` (${asset.keySize}b)` : ''}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#64748B]">
                          {truncateFingerprint(asset.fingerprintSha256)}
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono text-xs tabular-nums">
                        <div
                          className={
                            expired ? 'font-bold text-[#BE123C]' : 'font-medium text-[#0F172A]'
                          }
                        >
                          {formatShortUtcDate(asset.validTo)}
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          {formatDaysUntil(asset.validTo)}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs text-[#0F172A]">
                        {asset.owner ?? (
                          <span className="font-mono font-semibold text-[#B45309]">Unknown</span>
                        )}
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
            Showing {items.length} of {total} assets (Page {filters.page} of {totalPages})
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

      {/* Asset Detail Dossier Panel */}
      {selectedAssetId ? (
        <section
          aria-label="Asset metadata details"
          className="ecdat-glass-card rounded-3xl border-[#38BDF8] p-6"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
            <div>
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0284C7]">
                Asset Metadata Dossier
              </div>
              <h2 className="mt-1 font-mono text-lg font-bold text-[#0F172A]">
                {detailData?.asset.name ?? 'Loading asset...'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAssetId(null)}
              aria-label="Close asset detail panel"
              className="cursor-pointer rounded-xl p-1.5 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {detailLoading || !detailData ? (
            <div className="py-6 text-sm text-[#64748B]">Loading asset evidence...</div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
              <dl className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:col-span-7">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Discovery Source &amp; Last Observed
                  </dt>
                  <dd className="mt-1 font-mono font-semibold text-[#0F172A]">
                    {detailData.dataSource
                      ? `${detailData.dataSource.name} (${detailData.dataSource.provider.toUpperCase()})`
                      : detailData.sourceImport
                        ? `${detailData.sourceImport.filename} (Import)`
                        : detailData.asset.sourceName ?? 'Workspace Seed'}
                    <div className="mt-0.5 text-[11px] font-normal text-[#475569]">
                      Last observed:{' '}
                      {formatUtcDate(
                        detailData.asset.lastObservedAt ?? detailData.asset.updatedAt
                      )}
                    </div>
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Deployment Location / Region
                  </dt>
                  <dd className="mt-1 font-mono text-[#0F172A]">
                    {detailData.asset.location}
                    {detailData.asset.awsAccountId ? (
                      <div className="mt-0.5 text-[11px] text-[#64748B]">
                        Account {detailData.asset.awsAccountId} ·{' '}
                        {detailData.asset.awsRegion ?? 'unknown'}
                        {detailData.asset.acmStatus ? ` · ACM ${detailData.asset.acmStatus}` : ''}
                      </div>
                    ) : null}
                  </dd>
                </div>

                {detailData.asset.externalArn ? (
                  <div className="sm:col-span-2">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                      AWS Certificate ARN
                    </dt>
                    <dd className="mt-1 font-mono text-[#0F172A] break-all">
                      {detailData.asset.externalArn}
                    </dd>
                  </div>
                ) : null}

                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    SHA-256 Fingerprint
                  </dt>
                  <dd className="mt-1 font-mono text-[#0F172A] break-all">
                    {detailData.asset.fingerprintSha256 ?? 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Owner
                  </dt>
                  <dd className="mt-1 text-sm font-bold text-[#0F172A]">
                    {detailData.asset.owner ?? 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Subject
                  </dt>
                  <dd className="mt-1 font-mono text-[#475569] break-words">
                    {detailData.asset.subject ?? 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Issuer
                  </dt>
                  <dd className="mt-1 font-mono text-[#475569] break-words">
                    {detailData.asset.issuer ?? 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Algorithm &amp; Key Size
                  </dt>
                  <dd className="mt-1 font-mono font-semibold text-[#0F172A] tabular-nums">
                    {detailData.asset.algorithm}{' '}
                    {detailData.asset.keySize
                      ? `(${detailData.asset.keySize} bits)`
                      : '(Unknown size)'}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Signature Algorithm
                  </dt>
                  <dd className="mt-1 font-mono text-[#0F172A]">
                    {detailData.asset.signatureAlgorithm ?? 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Valid From (UTC)
                  </dt>
                  <dd className="mt-1 font-mono text-[#475569] tabular-nums">
                    {formatUtcDate(detailData.asset.validFrom)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    Valid To (UTC)
                  </dt>
                  <dd className="mt-1 font-mono text-[#0F172A] tabular-nums">
                    {formatUtcDate(detailData.asset.validTo)}
                  </dd>
                </div>

                {detailData.asset.inUseBy && detailData.asset.inUseBy.length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                      Associated AWS Resources (InUseBy)
                    </dt>
                    <dd className="mt-1 space-y-1 font-mono text-[11px] text-[#334155]">
                      {detailData.asset.inUseBy.map((arn) => (
                        <div key={arn} className="break-all">
                          {arn}
                        </div>
                      ))}
                    </dd>
                  </div>
                ) : null}

                {detailData.asset.changeSummary ? (
                  <div className="sm:col-span-2 rounded-2xl border border-[#BAE6FD] bg-[#EFF8FF] p-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#0284C7]">
                      Latest Sync Change Detected
                    </dt>
                    <dd className="mt-1 font-mono text-xs text-[#0F172A]">
                      {detailData.asset.changeSummary}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div className="border-t border-[#E2E8F0] pt-4 lg:col-span-5 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
                <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                  Related Findings ({detailData.findings.length})
                </h3>
                {detailData.findings.length === 0 ? (
                  <p className="mt-3 text-xs text-[#64748B]">
                    No active or historical findings recorded for this asset.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2.5">
                    {detailData.findings.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => onOpenFindingDetail(f.id)}
                        className="block w-full cursor-pointer rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-left transition-colors hover:border-[#38BDF8] hover:bg-[#EFF8FF]/60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${severitySurfaceClass(
                              f.severity
                            )}`}
                          >
                            {f.severity}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${remediationStatusClass(
                              f.status
                            )}`}
                          >
                            {f.status}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-bold text-[#0F172A]">{f.title}</div>
                        <div className="mt-1 font-mono text-[11px] text-[#64748B]">
                          {f.evidence}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
