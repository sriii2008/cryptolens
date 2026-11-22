import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCode2,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import type { ImportPreviewResult, ImportRecord, Role } from '../../shared/types';
import {
  confirmImportPayload,
  downloadAuthenticatedCsv,
  fetchImports,
  fetchSampleFixtureText,
  previewImportPayload,
} from '../lib/api';
import { formatShortUtcDate, formatUtcDate, truncateFingerprint } from '../lib/format';

interface ImportsViewProps {
  workspaceId: string;
  currentRole: Role;
  onImportConfirmed: () => void;
}

export function ImportsView({
  workspaceId,
  currentRole,
  onImportConfirmed,
}: ImportsViewProps) {
  const [filename, setFilename] = useState('inventory-import.csv');
  const [format, setFormat] = useState<'csv' | 'json' | 'pem' | 'der'>('csv');
  const [content, setContent] = useState('');
  const [certEnv, setCertEnv] = useState('production');
  const [certLocation, setCertLocation] = useState('us-east-1/edge-gw-01');
  const [certOwner, setCertOwner] = useState('');

  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportRecord[]>([]);

  const canImport = currentRole !== 'Viewer';

  const loadHistory = async () => {
    try {
      const res = await fetchImports(workspaceId);
      setHistory(res.items);
    } catch {
      // ignore initial history load failure
    }
  };

  useEffect(() => {
    void loadHistory();
  }, [workspaceId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccessMsg(null);
    setPreview(null);

    if (file.size > 512 * 1024) {
      setError('File exceeds maximum 512 KB upload limit.');
      return;
    }

    const lower = file.name.toLowerCase();
    setFilename(file.name);
    if (lower.endsWith('.der') || lower.endsWith('.cer')) {
      setFormat('der');
      const reader = new FileReader();
      reader.onload = () => {
        const buf = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) {
          binary += String.fromCharCode(bytes[i]);
        }
        setContent(btoa(binary));
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    if (lower.endsWith('.json')) setFormat('json');
    else if (lower.endsWith('.pem') || lower.endsWith('.crt')) setFormat('pem');
    else setFormat('csv');

    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ''));
    };
    reader.readAsText(file);
  };

  const handleLoadFixture = async (kind: 'csv' | 'pem') => {
    setError(null);
    setSuccessMsg(null);
    setPreview(null);
    try {
      const fixture = await fetchSampleFixtureText(kind);
      setFilename(fixture.filename);
      setFormat(kind);
      setContent(fixture.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sample fixture.');
    }
  };

  const handlePreview = async () => {
    setError(null);
    setSuccessMsg(null);
    setPreview(null);
    if (!content.trim()) {
      setError('Select a file or paste CSV, JSON, or PEM certificate content first.');
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await previewImportPayload(workspaceId, {
        filename,
        format,
        content,
        defaults:
          format === 'pem' || format === 'der'
            ? {
                environment: certEnv,
                location: certLocation,
                owner: certOwner,
              }
            : undefined,
      });
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation preview failed.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setError(null);
    setConfirmLoading(true);
    try {
      const result = await confirmImportPayload(workspaceId, {
        filename,
        format,
        content,
        defaults:
          format === 'pem' || format === 'der'
            ? {
                environment: certEnv,
                location: certLocation,
                owner: certOwner,
              }
            : undefined,
      });
      setSuccessMsg(
        `Import saved (${result.importRecord.summaryNote}). Findings and workspace counts updated.`
      );
      setPreview(null);
      await loadHistory();
      onImportConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to confirm import.');
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="ecdat-glass-card rounded-3xl p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-[#E2E8F0] pb-4 sm:flex-row sm:items-center">
          <div>
            <div className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[#475569]">
              Secondary File Intake · Automated Cloud Sync lives in Data Sources
            </div>
            <h2 className="mt-2 text-lg font-bold text-[#0F172A]">
              Import Inventory or Public X.509 Certificate
            </h2>
            <p className="mt-1 text-xs text-[#64748B]">
              Bounded to 512 KB and 500 rows. Private keys and arbitrary URLs are rejected.
              Certificate bytes are parsed transiently; only derived metadata is persisted.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                void downloadAuthenticatedCsv(
                  `/api/workspaces/${encodeURIComponent(workspaceId)}/imports/template.csv`,
                  'ecdat-inventory-template.csv'
                )
              }
              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7]"
            >
              <Download className="h-3.5 w-3.5 text-[#0284C7]" aria-hidden="true" />
              Download CSV template
            </button>
            <button
              type="button"
              onClick={() => void handleLoadFixture('csv')}
              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7]"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#0284C7]" aria-hidden="true" />
              Load sample CSV
            </button>
            <button
              type="button"
              onClick={() => void handleLoadFixture('pem')}
              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:border-[#0284C7] hover:text-[#0284C7]"
            >
              <FileCode2 className="h-3.5 w-3.5 text-[#B45309]" aria-hidden="true" />
              Load sample X.509 cert
            </button>
          </div>
        </div>

        {!canImport ? (
          <div className="mt-4 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#B45309]">
            Your current role ({currentRole}) has read-only access and cannot confirm new imports.
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            <div>
              <label
                htmlFor="import-file-input"
                className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
              >
                Upload file (.csv, .json, .pem, .crt, .der, .cer)
              </label>
              <input
                id="import-file-input"
                type="file"
                accept=".csv,.json,.pem,.crt,.der,.cer"
                onChange={handleFileChange}
                className="mt-1.5 block w-full cursor-pointer rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-xs text-[#475569] file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-[#CBD5E1] file:bg-white file:px-2.5 file:py-1 file:font-mono file:text-[11px] file:font-semibold file:text-[#0284C7]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="import-filename"
                  className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                >
                  Source filename
                </label>
                <input
                  id="import-filename"
                  type="text"
                  value={filename}
                  onChange={(e) => {
                    setFilename(e.target.value);
                    setPreview(null);
                  }}
                  className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 font-mono text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="import-format"
                  className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
                >
                  Format
                </label>
                <select
                  id="import-format"
                  value={format}
                  onChange={(e) => {
                    setFormat(e.target.value as 'csv' | 'json' | 'pem' | 'der');
                    setPreview(null);
                  }}
                  className="mt-1 min-h-[38px] w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3 text-xs text-[#0F172A] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
                >
                  <option value="csv">CSV Metadata Export</option>
                  <option value="json">JSON Metadata Export</option>
                  <option value="pem">Public X.509 PEM</option>
                  <option value="der">Public X.509 DER (Base64)</option>
                </select>
              </div>
            </div>

            {(format === 'pem' || format === 'der') && (
              <div className="space-y-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0F172A]">
                  Certificate deployment metadata
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="cert-env"
                      className="block text-[11px] text-[#64748B]"
                    >
                      Environment
                    </label>
                    <select
                      id="cert-env"
                      value={certEnv}
                      onChange={(e) => {
                        setCertEnv(e.target.value);
                        setPreview(null);
                      }}
                      className="mt-1 min-h-[36px] w-full rounded-xl border border-[#CBD5E1] bg-white px-2.5 text-xs text-[#0F172A]"
                    >
                      <option value="production">Production</option>
                      <option value="staging">Staging</option>
                      <option value="development">Development</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="cert-owner"
                      className="block text-[11px] text-[#64748B]"
                    >
                      Owner (optional)
                    </label>
                    <input
                      id="cert-owner"
                      type="text"
                      value={certOwner}
                      onChange={(e) => {
                        setCertOwner(e.target.value);
                        setPreview(null);
                      }}
                      placeholder="e.g., Platform Edge Team"
                      className="mt-1 min-h-[36px] w-full rounded-xl border border-[#CBD5E1] bg-white px-2.5 text-xs text-[#0F172A]"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="cert-location"
                    className="block text-[11px] text-[#64748B]"
                  >
                    Deployment location (distinct locations preserved per certificate)
                  </label>
                  <input
                    id="cert-location"
                    type="text"
                    value={certLocation}
                    onChange={(e) => {
                      setCertLocation(e.target.value);
                      setPreview(null);
                    }}
                    placeholder="e.g., us-east-1/alb-edge-01"
                    className="mt-1 min-h-[36px] w-full rounded-xl border border-[#CBD5E1] bg-white px-2.5 font-mono text-xs text-[#0F172A]"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col lg:col-span-7">
            <label
              htmlFor="import-payload-text"
              className="block font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[#475569]"
            >
              Payload preview / paste content
            </label>
            <textarea
              id="import-payload-text"
              rows={9}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setPreview(null);
              }}
              placeholder="Paste CSV rows, JSON array, or -----BEGIN CERTIFICATE----- PEM block..."
              className="mt-1.5 w-full flex-1 rounded-2xl border border-[#CBD5E1] bg-[#F8FAFC] p-3.5 font-mono text-xs leading-relaxed text-[#0F172A] placeholder:text-[#64748B] focus:border-[#0EA5E9] focus:bg-white focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                disabled={previewLoading || !canImport}
                onClick={handlePreview}
                className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {previewLoading ? 'Validating...' : 'Preview & validate'}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-3.5 text-xs text-[#BE123C]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {successMsg ? (
          <div
            role="status"
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[#A7F3D0] bg-[#ECFDF5] p-3.5 text-xs text-[#065F46]"
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-[#059669]"
              aria-hidden="true"
            />
            <span>{successMsg}</span>
          </div>
        ) : null}
      </section>

      {/* Validation & Deduplication Preview */}
      {preview ? (
        <section
          aria-label="Import validation preview"
          className="ecdat-glass-card rounded-3xl border-[#38BDF8] p-6"
        >
          <div className="flex flex-col justify-between gap-4 border-b border-[#E2E8F0] pb-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-lg font-bold text-[#0F172A]">
                Validation Preview: <span className="font-mono text-base">{preview.filename}</span>
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
                <span className="font-semibold text-[#047857]">
                  {preview.insertedCount} to insert
                </span>
                <span className="font-semibold text-[#B45309]">
                  {preview.updatedCount} to update
                </span>
                <span className="text-[#64748B]">{preview.skippedCount} skipped (duplicate)</span>
                <span
                  className={
                    preview.rejectedCount > 0
                      ? 'font-semibold text-[#BE123C]'
                      : 'text-[#64748B]'
                  }
                >
                  {preview.rejectedCount} rejected
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={confirmLoading || preview.items.length === 0 || !canImport}
              onClick={handleConfirm}
              className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-2xl bg-[#0F172A] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0284C7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmLoading ? 'Saving import...' : 'Confirm & save import'}
            </button>
          </div>

          {preview.errors.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-4">
              <div className="font-mono text-xs font-semibold text-[#BE123C]">
                Row-level validation errors ({preview.errors.length})
              </div>
              <ul className="mt-2 space-y-1 text-xs text-[#BE123C]">
                {preview.errors.map((err, i) => (
                  <li key={`${err.rowNumber}-${i}`} className="font-mono">
                    Row {err.rowNumber} [{err.field}]: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.items.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-[#E2E8F0]">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                    <th className="px-3.5 py-2.5">Action</th>
                    <th className="px-3.5 py-2.5">Asset</th>
                    <th className="px-3.5 py-2.5">Location</th>
                    <th className="px-3.5 py-2.5">Algorithm</th>
                    <th className="px-3.5 py-2.5">Expires (UTC)</th>
                    <th className="px-3.5 py-2.5">Deduplication Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {preview.items.map((item) => (
                    <tr key={`${item.rowNumber}-${item.candidate.location}`}>
                      <td className="px-3.5 py-2.5 font-mono font-semibold uppercase">
                        <span
                          className={
                            item.action === 'insert'
                              ? 'text-[#047857]'
                              : item.action === 'update'
                                ? 'text-[#B45309]'
                                : 'text-[#64748B]'
                          }
                        >
                          {item.action}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-mono font-semibold text-[#0F172A]">
                          {item.candidate.name}
                        </div>
                        <div className="font-mono text-[11px] text-[#64748B]">
                          {truncateFingerprint(item.candidate.fingerprintSha256)}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[#475569]">
                        {item.candidate.location}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[#0F172A]">
                        {item.candidate.algorithm}
                        {item.candidate.keySize ? ` (${item.candidate.keySize}b)` : ''}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[#475569] tabular-nums">
                        {formatShortUtcDate(item.candidate.validTo)}
                      </td>
                      <td className="px-3.5 py-2.5 text-[#64748B]">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Import History */}
      <section className="ecdat-glass-card overflow-hidden rounded-3xl">
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC]/80 px-5 py-3.5">
          <h3 className="text-sm font-bold text-[#0F172A]">File Import History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[10px] uppercase tracking-[0.08em] text-[#64748B]">
                <th className="px-4 py-2.5">Timestamp (UTC)</th>
                <th className="px-4 py-2.5">Filename</th>
                <th className="px-4 py-2.5">Format</th>
                <th className="px-4 py-2.5">Actor</th>
                <th className="px-4 py-2.5">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#64748B]">
                    No file imports recorded yet.
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-3 font-mono text-[#64748B] tabular-nums whitespace-nowrap">
                      {formatUtcDate(h.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-[#0F172A]">
                      {h.filename}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold uppercase text-[#0284C7]">
                      {h.format}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#475569]">{h.actorEmail}</td>
                    <td className="px-4 py-3 font-mono text-[#0F172A] tabular-nums">
                      {h.summaryNote}
                    </td>
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
