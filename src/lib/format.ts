import type {
  DataSourceStatus,
  RemediationStatus,
  Severity,
  SyncRunStatus,
} from '../../shared/types';

export function formatUtcDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'Unknown';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function formatShortUtcDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'Unknown';
  return new Date(ms).toISOString().slice(0, 10);
}

export function formatDaysUntil(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'Unknown';
  const diffDays = Math.ceil((ms - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `Expired ${Math.abs(diffDays)}d ago`;
  if (diffDays === 0) return 'Expires today';
  return `${diffDays}d remaining`;
}

export function truncateFingerprint(fp: string | null | undefined): string {
  if (!fp) return 'Unknown';
  if (fp.length <= 16) return fp;
  return `${fp.slice(0, 8)}…${fp.slice(-8)}`;
}

export function severityTextClass(severity: Severity): string {
  if (severity === 'High') return 'text-[#BE123C]';
  if (severity === 'Medium') return 'text-[#B45309]';
  return 'text-[#475569]';
}

export function severitySurfaceClass(severity: Severity): string {
  if (severity === 'High') {
    return 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]';
  }
  if (severity === 'Medium') {
    return 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]';
  }
  return 'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]';
}

export function remediationStatusClass(status: RemediationStatus): string {
  if (status === 'Open') return 'text-[#BE123C] border-[#FECDD3] bg-[#FFF1F2]';
  if (status === 'In progress') return 'text-[#0369A1] border-[#BAE6FD] bg-[#EFF8FF]';
  if (status === 'Resolved') return 'text-[#047857] border-[#A7F3D0] bg-[#ECFDF5]';
  return 'text-[#334155] border-[#CBD5E1] bg-[#F8FAFC]';
}

export function dataSourceStatusBadge(status: DataSourceStatus | 'unconfigured'): {
  label: string;
  classes: string;
} {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        classes: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]',
      };
    case 'syncing':
      return {
        label: 'Syncing',
        classes: 'bg-[#EFF8FF] text-[#0284C7] border-[#7DD3FC]',
      };
    case 'failed':
      return {
        label: 'Last sync failed',
        classes: 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]',
      };
    case 'setup_required':
      return {
        label: 'Setup required',
        classes: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
      };
    default:
      return {
        label: 'Not connected',
        classes: 'bg-[#F8FAFC] text-[#475569] border-[#CBD5E1]',
      };
  }
}

export function syncRunStatusClass(status: SyncRunStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]';
    case 'partial':
      return 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]';
    case 'running':
      return 'bg-[#EFF8FF] text-[#0284C7] border-[#7DD3FC]';
    default:
      return 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]';
  }
}

export function formatAssetTypeLabel(t: string): string {
  switch (t) {
    case 'certificate':
      return 'X.509 Certificate';
    case 'kms_key':
      return 'KMS Key';
    case 'tls_endpoint':
      return 'TLS Endpoint';
    case 'signing_key':
      return 'Signing Key';
    case 'ssh_key':
      return 'SSH Key';
    default:
      return 'Unknown';
  }
}
