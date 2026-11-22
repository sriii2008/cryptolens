import { X509Certificate } from 'node:crypto';
import { z } from 'zod';
import { parseCsvText } from './csv-utils.ts';
import type {
  AssetType,
  EnvironmentType,
  ImportFormat,
  ImportRowValidationError,
  ParsedCandidateAsset,
} from '../shared/types.ts';

export const MAX_UPLOAD_BYTES = 512 * 1024; // 512 KB bounded upload
export const MAX_IMPORT_ROWS = 500;

const PRIVATE_KEY_MARKERS = [
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN ENCRYPTED PRIVATE KEY-----',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  '-----BEGIN DSA PRIVATE KEY-----',
  '-----BEGIN PGP PRIVATE KEY BLOCK-----',
];

const URL_PATTERN = /\b(?:https?|ftp|file|javascript|data):\/\//i;
const SCHEME_PATTERN = /^(?:javascript|data):/i;

export function hasPrivateKeyMaterial(content: string): boolean {
  const upper = content.toUpperCase();
  return PRIVATE_KEY_MARKERS.some((marker) => upper.includes(marker));
}

export function containsArbitraryUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return URL_PATTERN.test(trimmed) || SCHEME_PATTERN.test(trimmed);
}

const KNOWN_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'MD5withRSA',
  '1.2.840.113549.1.1.5': 'SHA1withRSA',
  '1.2.840.113549.1.1.11': 'SHA256withRSA',
  '1.2.840.113549.1.1.12': 'SHA384withRSA',
  '1.2.840.113549.1.1.13': 'SHA512withRSA',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.10045.4.1': 'SHA1withECDSA',
  '1.2.840.10045.4.3.2': 'SHA256withECDSA',
  '1.2.840.10045.4.3.3': 'SHA384withECDSA',
  '1.2.840.10045.4.3.4': 'SHA512withECDSA',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.2.840.10040.4.3': 'SHA1withDSA',
  '2.16.840.1.101.3.4.3.2': 'SHA256withDSA',
};

function readDerLength(buf: Uint8Array, offset: number): { length: number; next: number } {
  const first = buf[offset];
  if (first === undefined) throw new Error('Unexpected end of DER data');
  if (first < 0x80) return { length: first, next: offset + 1 };
  const numBytes = first & 0x7f;
  if (numBytes === 0 || offset + 1 + numBytes > buf.length) {
    throw new Error('Invalid DER length encoding');
  }
  let len = 0;
  for (let i = 0; i < numBytes; i += 1) {
    len = (len << 8) | buf[offset + 1 + i];
  }
  return { length: len, next: offset + 1 + numBytes };
}

function decodeOidBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const first = bytes[0];
  const parts: number[] = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (let i = 1; i < bytes.length; i += 1) {
    const b = bytes[i];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/**
 * Extracts the outer X.509 Certificate signatureAlgorithm OID directly from DER bytes.
 */
export function extractSignatureAlgorithmFromDer(derBytes: Uint8Array): string | null {
  try {
    if (derBytes[0] !== 0x30) return null; // Certificate SEQUENCE
    const certSeq = readDerLength(derBytes, 1);
    let pos = certSeq.next;

    // 1. tbsCertificate SEQUENCE
    if (derBytes[pos] !== 0x30) return null;
    const tbsSeq = readDerLength(derBytes, pos + 1);
    pos = tbsSeq.next + tbsSeq.length;

    // 2. signatureAlgorithm AlgorithmIdentifier SEQUENCE
    if (derBytes[pos] !== 0x30) return null;
    const algSeq = readDerLength(derBytes, pos + 1);
    pos = algSeq.next;

    if (derBytes[pos] !== 0x06) return null; // OID tag
    const oidLen = readDerLength(derBytes, pos + 1);
    const oidBytes = derBytes.subarray(oidLen.next, oidLen.next + oidLen.length);
    const oid = decodeOidBytes(oidBytes);
    return KNOWN_OIDS[oid] ?? (oid ? `OID:${oid}` : null);
  } catch {
    return null;
  }
}

function normalizeEnvironment(raw?: string | null): EnvironmentType {
  const val = (raw ?? '').trim().toLowerCase();
  if (val === 'prod' || val === 'production') return 'production';
  if (val === 'stage' || val === 'staging') return 'staging';
  if (val === 'dev' || val === 'development') return 'development';
  return 'unknown';
}

function normalizeAssetType(raw?: string | null): AssetType {
  const val = (raw ?? '').trim().toLowerCase();
  if (val === 'certificate' || val === 'cert' || val === 'x509') return 'certificate';
  if (val === 'kms_key' || val === 'kms') return 'kms_key';
  if (val === 'tls_endpoint' || val === 'tls') return 'tls_endpoint';
  if (val === 'signing_key' || val === 'signing') return 'signing_key';
  if (val === 'ssh_key' || val === 'ssh') return 'ssh_key';
  return 'unknown';
}

function normalizeDateUtc(raw?: string | null): string | null {
  if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'unknown') {
    return null;
  }
  const parsed = Date.parse(raw.trim());
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid UTC date/timestamp "${raw}".`);
  }
  return new Date(parsed).toISOString();
}

function extractCommonName(subject: string): string | null {
  const match = subject.match(/(?:^|[\n,])\s*CN\s*=\s*([^\n,]+)/i);
  return match ? match[1].trim() : null;
}

function parseSanList(sanRaw: string | undefined): string[] {
  if (!sanRaw) return [];
  return sanRaw
    .split(',')
    .map((entry) => entry.trim().replace(/^DNS:/i, '').replace(/^IP Address:/i, ''))
    .filter((entry) => entry.length > 0 && !containsArbitraryUrl(entry));
}

function describePublicKey(cert: X509Certificate): {
  algorithm: string;
  keySize: number | null;
} {
  try {
    const pub = cert.publicKey;
    const keyType = pub.asymmetricKeyType;
    const details = pub.asymmetricKeyDetails;
    if (keyType === 'rsa' || keyType === 'rsa-pss') {
      return {
        algorithm: 'RSA',
        keySize: details?.modulusLength ?? null,
      };
    }
    if (keyType === 'ec') {
      const curve = details?.namedCurve ?? '';
      const curveBits =
        curve === 'prime256v1' || curve === 'secp256r1'
          ? 256
          : curve === 'secp384r1'
            ? 384
            : curve === 'secp521r1'
              ? 521
              : null;
      const curveLabel =
        curve === 'prime256v1' || curve === 'secp256r1'
          ? 'P-256'
          : curve === 'secp384r1'
            ? 'P-384'
            : curve === 'secp521r1'
              ? 'P-521'
              : curve;
      return {
        algorithm: curveLabel ? `ECDSA (${curveLabel})` : 'ECDSA',
        keySize: curveBits,
      };
    }
    if (keyType === 'ed25519') {
      return { algorithm: 'Ed25519', keySize: 256 };
    }
    if (keyType === 'ed448') {
      return { algorithm: 'Ed448', keySize: 448 };
    }
    if (keyType === 'dsa') {
      return { algorithm: 'DSA', keySize: details?.modulusLength ?? null };
    }
    return { algorithm: keyType ? keyType.toUpperCase() : 'Unknown', keySize: null };
  } catch {
    return { algorithm: 'Unknown', keySize: null };
  }
}

export function parseX509CertificatePayload(
  rawContent: string,
  format: 'pem' | 'der',
  filename: string,
  defaults?: {
    environment?: string;
    location?: string;
    owner?: string;
  }
): {
  candidates: ParsedCandidateAsset[];
  errors: ImportRowValidationError[];
} {
  if (hasPrivateKeyMaterial(rawContent)) {
    return {
      candidates: [],
      errors: [
        {
          rowNumber: 1,
          field: 'certificate',
          message:
            'Private key material detected and rejected. Only public X.509 certificates are permitted.',
        },
      ],
    };
  }

  if (containsArbitraryUrl(defaults?.location) || containsArbitraryUrl(defaults?.owner)) {
    return {
      candidates: [],
      errors: [
        {
          rowNumber: 1,
          field: 'metadata',
          message: 'Arbitrary URLs are rejected in location or owner fields.',
        },
      ],
    };
  }

  const env = normalizeEnvironment(defaults?.environment);
  const defaultLocation = defaults?.location?.trim() || `uploaded:${filename}`;
  const defaultOwner =
    defaults?.owner?.trim() && defaults.owner.trim().toLowerCase() !== 'unknown'
      ? defaults.owner.trim()
      : null;

  const candidates: ParsedCandidateAsset[] = [];
  const errors: ImportRowValidationError[] = [];

  if (format === 'pem') {
    const pemBlocks = rawContent.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
    );
    if (!pemBlocks || pemBlocks.length === 0) {
      return {
        candidates: [],
        errors: [
          {
            rowNumber: 1,
            field: 'pem',
            message:
              'No valid -----BEGIN CERTIFICATE----- block found in PEM payload.',
          },
        ],
      };
    }
    if (pemBlocks.length > 50) {
      return {
        candidates: [],
        errors: [
          {
            rowNumber: 1,
            field: 'pem',
            message: 'PEM bundle exceeds maximum 50 certificates per import.',
          },
        ],
      };
    }

    pemBlocks.forEach((pem, idx) => {
      try {
        const cert = new X509Certificate(pem);
        const fingerprintSha256 = cert.fingerprint256.replace(/:/g, '').toLowerCase();
        const subject = cert.subject ? cert.subject.replace(/\n/g, ', ') : null;
        const issuer = cert.issuer ? cert.issuer.replace(/\n/g, ', ') : null;
        const sanList = parseSanList(cert.subjectAltName);
        const cn = subject ? extractCommonName(subject) : null;
        const { algorithm, keySize } = describePublicKey(cert);
        const sigAlg = extractSignatureAlgorithmFromDer(cert.raw);

        candidates.push({
          sourceRecordId: null,
          fingerprintSha256,
          name: cn || sanList[0] || filename,
          assetType: 'certificate',
          environment: env,
          location: defaultLocation,
          subject,
          issuer,
          serialNumber: cert.serialNumber || null,
          algorithm,
          keySize,
          signatureAlgorithm: sigAlg,
          validFrom: new Date(cert.validFrom).toISOString(),
          validTo: new Date(cert.validTo).toISOString(),
          owner: defaultOwner,
          sanList,
        });
      } catch (err) {
        errors.push({
          rowNumber: idx + 1,
          field: 'certificate',
          message:
            err instanceof Error
              ? `Invalid X.509 PEM certificate: ${err.message}`
              : 'Invalid X.509 PEM certificate.',
        });
      }
    });
    return { candidates, errors };
  }

  // DER format (base64 encoded bytes)
  try {
    const cleanBase64 = rawContent.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
      throw new Error('DER payload must be valid base64-encoded certificate bytes.');
    }
    const derBuffer = Buffer.from(cleanBase64, 'base64');
    if (derBuffer.byteLength === 0 || derBuffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error('DER certificate payload is empty or exceeds size limit.');
    }
    const cert = new X509Certificate(derBuffer);
    const fingerprintSha256 = cert.fingerprint256.replace(/:/g, '').toLowerCase();
    const subject = cert.subject ? cert.subject.replace(/\n/g, ', ') : null;
    const issuer = cert.issuer ? cert.issuer.replace(/\n/g, ', ') : null;
    const sanList = parseSanList(cert.subjectAltName);
    const cn = subject ? extractCommonName(subject) : null;
    const { algorithm, keySize } = describePublicKey(cert);
    const sigAlg = extractSignatureAlgorithmFromDer(cert.raw);

    candidates.push({
      sourceRecordId: null,
      fingerprintSha256,
      name: cn || sanList[0] || filename,
      assetType: 'certificate',
      environment: env,
      location: defaultLocation,
      subject,
      issuer,
      serialNumber: cert.serialNumber || null,
      algorithm,
      keySize,
      signatureAlgorithm: sigAlg,
      validFrom: new Date(cert.validFrom).toISOString(),
      validTo: new Date(cert.validTo).toISOString(),
      owner: defaultOwner,
      sanList,
    });
  } catch (err) {
    errors.push({
      rowNumber: 1,
      field: 'der',
      message:
        err instanceof Error
          ? `Invalid X.509 DER certificate: ${err.message}`
          : 'Invalid X.509 DER certificate.',
    });
  }

  return { candidates, errors };
}

const RawMetadataRowSchema = z
  .object({
    source_record_id: z.string().max(128).optional().nullable(),
    sourceRecordId: z.string().max(128).optional().nullable(),
    fingerprint_sha256: z.string().max(128).optional().nullable(),
    fingerprintSha256: z.string().max(128).optional().nullable(),
    name: z.string().min(1, 'Asset name is required').max(200),
    asset_type: z.string().max(64).optional().nullable(),
    assetType: z.string().max(64).optional().nullable(),
    environment: z.string().max(64).optional().nullable(),
    location: z.string().min(1, 'Deployment location is required').max(255),
    subject: z.string().max(500).optional().nullable(),
    issuer: z.string().max(500).optional().nullable(),
    serial_number: z.string().max(128).optional().nullable(),
    serialNumber: z.string().max(128).optional().nullable(),
    algorithm: z.string().min(1, 'Algorithm is required').max(80),
    key_size: z.union([z.number(), z.string()]).optional().nullable(),
    keySize: z.union([z.number(), z.string()]).optional().nullable(),
    signature_algorithm: z.string().max(80).optional().nullable(),
    signatureAlgorithm: z.string().max(80).optional().nullable(),
    valid_from: z.string().max(64).optional().nullable(),
    validFrom: z.string().max(64).optional().nullable(),
    valid_to: z.string().max(64).optional().nullable(),
    validTo: z.string().max(64).optional().nullable(),
    owner: z.string().max(160).optional().nullable(),
    sans: z.union([z.string(), z.array(z.string())]).optional().nullable(),
    sanList: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  })
  .strict();

function normalizeFingerprint(raw?: string | null): string | null {
  if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'unknown') {
    return null;
  }
  const hex = raw.replace(/[:\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error('fingerprint_sha256 must be a 64-character SHA-256 hex digest.');
  }
  return hex;
}

function normalizeKeySize(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '' || String(raw).toLowerCase() === 'unknown') {
    return null;
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(num) || num <= 0 || num > 32768) {
    throw new Error(`Invalid key_size "${raw}". Expected positive integer bit length.`);
  }
  return num;
}

export function parseStructuredMetadataImport(
  format: 'csv' | 'json',
  rawContent: string
): {
  candidates: ParsedCandidateAsset[];
  errors: ImportRowValidationError[];
} {
  if (hasPrivateKeyMaterial(rawContent)) {
    return {
      candidates: [],
      errors: [
        {
          rowNumber: 1,
          field: 'payload',
          message:
            'Private key material detected and rejected. Never upload private keys.',
        },
      ],
    };
  }

  let rawRecords: Array<{ rowNumber: number; data: Record<string, unknown> }> = [];

  if (format === 'csv') {
    try {
      const parsed = parseCsvText(rawContent, MAX_IMPORT_ROWS);
      rawRecords = parsed.rows.map((r) => ({ rowNumber: r.rowNumber, data: r.record }));
    } catch (err) {
      return {
        candidates: [],
        errors: [
          {
            rowNumber: 1,
            field: 'csv',
            message: err instanceof Error ? err.message : 'Unable to parse CSV file.',
          },
        ],
      };
    }
  } else {
    try {
      const json = JSON.parse(rawContent) as unknown;
      const list = Array.isArray(json)
        ? json
        : json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).assets)
          ? ((json as Record<string, unknown>).assets as unknown[])
          : null;
      if (!list) {
        return {
          candidates: [],
          errors: [
            {
              rowNumber: 1,
              field: 'json',
              message: 'JSON import must be an array of asset objects or { "assets": [...] }.',
            },
          ],
        };
      }
      if (list.length === 0) {
        return {
          candidates: [],
          errors: [{ rowNumber: 1, field: 'json', message: 'JSON asset list is empty.' }],
        };
      }
      if (list.length > MAX_IMPORT_ROWS) {
        return {
          candidates: [],
          errors: [
            {
              rowNumber: 1,
              field: 'json',
              message: `JSON import exceeds maximum ${MAX_IMPORT_ROWS} rows.`,
            },
          ],
        };
      }
      rawRecords = list.map((item, idx) => ({
        rowNumber: idx + 1,
        data: (item && typeof item === 'object' ? item : {}) as Record<string, unknown>,
      }));
    } catch {
      return {
        candidates: [],
        errors: [
          {
            rowNumber: 1,
            field: 'json',
            message: 'Malformed JSON syntax.',
          },
        ],
      };
    }
  }

  const candidates: ParsedCandidateAsset[] = [];
  const errors: ImportRowValidationError[] = [];

  for (const item of rawRecords) {
    const validated = RawMetadataRowSchema.safeParse(item.data);
    if (!validated.success) {
      const firstIssue = validated.error.issues[0];
      errors.push({
        rowNumber: item.rowNumber,
        field: firstIssue?.path.join('.') || 'row',
        message: firstIssue?.message || 'Invalid asset metadata fields.',
      });
      continue;
    }

    const r = validated.data;
    const stringValues = [
      r.name,
      r.location,
      r.subject,
      r.issuer,
      r.owner,
      r.algorithm,
      r.signatureAlgorithm,
      r.signature_algorithm,
    ];
    if (stringValues.some((v) => containsArbitraryUrl(v))) {
      errors.push({
        rowNumber: item.rowNumber,
        field: 'url',
        message: 'Arbitrary URLs are rejected in imported metadata fields.',
      });
      continue;
    }

    try {
      const fingerprintSha256 = normalizeFingerprint(
        r.fingerprintSha256 ?? r.fingerprint_sha256
      );
      const sourceRecordId =
        (r.sourceRecordId ?? r.source_record_id)?.trim() || null;
      const keySize = normalizeKeySize(r.keySize ?? r.key_size);
      const validFrom = normalizeDateUtc(r.validFrom ?? r.valid_from);
      const validTo = normalizeDateUtc(r.validTo ?? r.valid_to);
      if (validFrom && validTo && Date.parse(validFrom) > Date.parse(validTo)) {
        throw new Error('valid_from must be earlier than or equal to valid_to.');
      }

      const rawSans = r.sanList ?? r.sans;
      const sanList = Array.isArray(rawSans)
        ? rawSans.map((s) => s.trim()).filter(Boolean)
        : typeof rawSans === 'string' && rawSans.trim()
          ? rawSans
              .split(/[;|,]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      if (sanList.some((s) => containsArbitraryUrl(s))) {
        throw new Error('Arbitrary URLs are rejected inside SAN entries.');
      }

      const rawOwner = r.owner?.trim();
      const owner =
        rawOwner && rawOwner.toLowerCase() !== 'unknown' ? rawOwner : null;

      candidates.push({
        sourceRecordId,
        fingerprintSha256,
        name: r.name.trim(),
        assetType: normalizeAssetType(r.assetType ?? r.asset_type),
        environment: normalizeEnvironment(r.environment),
        location: r.location.trim(),
        subject: r.subject?.trim() || null,
        issuer: r.issuer?.trim() || null,
        serialNumber: (r.serialNumber ?? r.serial_number)?.trim() || null,
        algorithm: r.algorithm.trim(),
        keySize,
        signatureAlgorithm:
          (r.signatureAlgorithm ?? r.signature_algorithm)?.trim() || null,
        validFrom,
        validTo,
        owner,
        sanList,
      });
    } catch (err) {
      errors.push({
        rowNumber: item.rowNumber,
        field: 'validation',
        message: err instanceof Error ? err.message : 'Row validation failed.',
      });
    }
  }

  return { candidates, errors };
}

export function buildDedupeKey(candidate: {
  fingerprintSha256: string | null;
  sourceRecordId: string | null;
  location: string;
  name: string;
}): string {
  if (candidate.fingerprintSha256) {
    return `fp:${candidate.fingerprintSha256}|loc:${candidate.location.toLowerCase()}`;
  }
  if (candidate.sourceRecordId) {
    return `src:${candidate.sourceRecordId.toLowerCase()}`;
  }
  return `name:${candidate.name.toLowerCase()}|loc:${candidate.location.toLowerCase()}`;
}

export function detectImportFormat(filename: string, explicitFormat?: string): ImportFormat | null {
  if (explicitFormat === 'csv' || explicitFormat === 'json' || explicitFormat === 'pem' || explicitFormat === 'der') {
    return explicitFormat;
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.pem') || lower.endsWith('.crt')) return 'pem';
  if (lower.endsWith('.der') || lower.endsWith('.cer')) return 'der';
  return null;
}
