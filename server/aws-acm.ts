import {
  ACMClient,
  DescribeCertificateCommand,
  ListCertificatesCommand,
  type CertificateDetail,
  type CertificateKeyPairOrigin,
  type CertificateStatus,
  type KeyAlgorithm,
  type ListCertificatesCommandOutput,
} from '@aws-sdk/client-acm';
import {
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  STSClient,
} from '@aws-sdk/client-sts';
import type {
  AwsAuthMode,
  ConnectionTestResult,
  EnvironmentType,
  SyncRunRegionFailure,
} from '../shared/types.ts';
import type { SyncedCertificateCandidate } from './store.ts';

export const ALL_ACM_STATUSES: CertificateStatus[] = [
  'ISSUED',
  'INACTIVE',
  'EXPIRED',
  'PENDING_VALIDATION',
  'VALIDATION_TIMED_OUT',
  'REVOKED',
  'FAILED',
];

export const ALL_ACM_KEY_TYPES: KeyAlgorithm[] = [
  'RSA_1024',
  'RSA_2048',
  'RSA_3072',
  'RSA_4096',
  'EC_prime256v1',
  'EC_secp384r1',
  'EC_secp521r1',
];

export const ALL_ACM_KEY_ORIGINS: CertificateKeyPairOrigin[] = [
  'ACME',
  'AWS_MANAGED',
  'CUSTOMER_PROVIDED',
];

export const COMMON_AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-southeast-1',
  'ap-northeast-1',
  'ap-south-1',
];

export interface AwsTempCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface AcmRegionClient {
  listCertificates(params: {
    NextToken?: string;
    MaxItems?: number;
    CertificateStatuses?: CertificateStatus[];
    CertificateKeyPairOrigins?: CertificateKeyPairOrigin[];
    Includes?: { keyTypes?: KeyAlgorithm[] };
  }): Promise<ListCertificatesCommandOutput>;
  describeCertificate(certificateArn: string): Promise<{ Certificate?: CertificateDetail }>;
}

export interface AwsConnectorClients {
  getCallerIdentity(): Promise<{ Account?: string; Arn?: string }>;
  assumeRole(params: {
    roleArn: string;
    externalId: string;
    sessionName: string;
  }): Promise<{ credentials: AwsTempCredentials; assumedRoleArn: string | null }>;
  createAcmClient(region: string, credentials?: AwsTempCredentials): AcmRegionClient;
}

export function createDefaultAwsConnectorClients(stsRegion = 'us-east-1'): AwsConnectorClients {
  return {
    async getCallerIdentity() {
      const sts = new STSClient({ region: stsRegion });
      const res = await sts.send(new GetCallerIdentityCommand({}));
      return { Account: res.Account, Arn: res.Arn };
    },
    async assumeRole({ roleArn, externalId, sessionName }) {
      const sts = new STSClient({ region: stsRegion });
      const res = await sts.send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          ExternalId: externalId,
          RoleSessionName: sessionName,
          DurationSeconds: 900,
        })
      );
      if (
        !res.Credentials?.AccessKeyId ||
        !res.Credentials?.SecretAccessKey ||
        !res.Credentials?.SessionToken
      ) {
        throw new Error('AWS STS AssumeRole returned incomplete temporary credentials.');
      }
      return {
        credentials: {
          accessKeyId: res.Credentials.AccessKeyId,
          secretAccessKey: res.Credentials.SecretAccessKey,
          sessionToken: res.Credentials.SessionToken,
        },
        assumedRoleArn: res.AssumedRoleUser?.Arn ?? null,
      };
    },
    createAcmClient(region, credentials) {
      const acm = new ACMClient(credentials ? { region, credentials } : { region });
      return {
        listCertificates: (params) => acm.send(new ListCertificatesCommand(params)),
        describeCertificate: (certificateArn) =>
          acm.send(new DescribeCertificateCommand({ CertificateArn: certificateArn })),
      };
    },
  };
}

export function validateAwsConnectionConfig(input: {
  authMode: AwsAuthMode;
  awsAccountId?: string | null;
  roleArn?: string | null;
  externalId?: string | null;
  regions: string[];
}): string | null {
  if (!input.regions || input.regions.length === 0) {
    return 'Select at least one AWS region to scan.';
  }
  for (const r of input.regions) {
    if (!/^[a-z]{2}(-[a-z]+)+-\d+$/.test(r)) {
      return `Invalid AWS region format: "${r}".`;
    }
  }
  if (input.awsAccountId && !/^\d{12}$/.test(input.awsAccountId.trim())) {
    return 'AWS Account ID must be a 12-digit number.';
  }
  if (input.authMode === 'sts_assume_role') {
    const arn = input.roleArn?.trim() ?? '';
    if (!/^arn:aws(?:-[a-z]+)?:iam::\d{12}:role\/[\w+=,.@/-]+$/.test(arn)) {
      return 'Role ARN must match arn:aws:iam::<12-digit-account>:role/<role-name>.';
    }
    if (!input.externalId || input.externalId.trim().length < 8) {
      return 'Cross-account STS AssumeRole requires a unique External ID (min 8 chars).';
    }
  }
  return null;
}

export function extractAccountIdFromArn(arn: string | null | undefined): string | null {
  if (!arn) return null;
  const parts = arn.split(':');
  if (parts.length >= 5 && /^\d{12}$/.test(parts[4])) {
    return parts[4];
  }
  return null;
}

function isThrottlingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  const name = e.name || e.code || '';
  if (
    name === 'ThrottlingException' ||
    name === 'Throttling' ||
    name === 'RequestLimitExceeded' ||
    name === 'TooManyRequestsException'
  ) {
    return true;
  }
  const status = e.$metadata?.httpStatusCode;
  return status === 429 || status === 503;
}

export function formatAwsErrorMessage(err: unknown): string {
  if (!err) return 'Unknown AWS error';
  const e = err as { name?: string; message?: string; Code?: string };
  const code = e.name || e.Code || '';
  const msg = e.message || String(err);
  if (code === 'AccessDenied' || code === 'AccessDeniedException') {
    return `AccessDenied: ${msg}. Verify IAM trust policy, External ID, and acm:ListCertificates / acm:DescribeCertificate permissions.`;
  }
  if (code === 'CredentialsProviderError' || /Could not load credentials/i.test(msg)) {
    return 'Server AWS workload identity or default credentials are not configured on this runtime.';
  }
  return code && !msg.startsWith(code) ? `${code}: ${msg}` : msg;
}

async function withAwsRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 150
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts || !isThrottlingError(err)) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 40);
      const delay = baseDelayMs * 2 ** (attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function mapWithBoundedConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIdx = 0;
  const workerCount = Math.min(concurrency, items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = nextIdx;
      nextIdx += 1;
      if (current >= items.length) break;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function mapAcmKeyAlgorithm(keyAlg: string | undefined): {
  algorithm: string;
  keySize: number | null;
} {
  switch (keyAlg) {
    case 'RSA_1024':
      return { algorithm: 'RSA', keySize: 1024 };
    case 'RSA_2048':
      return { algorithm: 'RSA', keySize: 2048 };
    case 'RSA_3072':
      return { algorithm: 'RSA', keySize: 3072 };
    case 'RSA_4096':
      return { algorithm: 'RSA', keySize: 4096 };
    case 'EC_prime256v1':
      return { algorithm: 'ECDSA (P-256)', keySize: 256 };
    case 'EC_secp384r1':
      return { algorithm: 'ECDSA (P-384)', keySize: 384 };
    case 'EC_secp521r1':
      return { algorithm: 'ECDSA (P-521)', keySize: 521 };
    default:
      return { algorithm: keyAlg || 'Unknown', keySize: null };
  }
}

export function mapAcmSignatureAlgorithm(sigAlg: string | undefined): string | null {
  if (!sigAlg) return null;
  const normalized = sigAlg.trim();
  const upper = normalized.toUpperCase();
  if (upper === 'SHA256WITHRSA') return 'SHA256withRSA';
  if (upper === 'SHA384WITHRSA') return 'SHA384withRSA';
  if (upper === 'SHA512WITHRSA') return 'SHA512withRSA';
  if (upper === 'SHA1WITHRSA') return 'SHA1withRSA';
  if (upper === 'SHA256WITHECDSA') return 'SHA256withECDSA';
  if (upper === 'SHA384WITHECDSA') return 'SHA384withECDSA';
  if (upper === 'SHA512WITHECDSA') return 'SHA512withECDSA';
  return normalized;
}

export function inferEnvironmentFromDomain(
  domain: string | undefined,
  fallback: EnvironmentType
): EnvironmentType {
  if (!domain) return fallback;
  const lower = domain.toLowerCase();
  if (/(^|[.-])(staging|stg|stage)([.-]|$)/.test(lower)) return 'staging';
  if (/(^|[.-])(dev|development|sandbox|qa|test)([.-]|$)/.test(lower)) return 'development';
  return fallback;
}

export function mapCertificateDetailToCandidate(
  cert: CertificateDetail,
  region: string,
  fallbackAccountId: string | null,
  environmentDefault: EnvironmentType
): SyncedCertificateCandidate | null {
  const arn = cert.CertificateArn?.trim();
  if (!arn) return null;

  const accountId = extractAccountIdFromArn(arn) ?? fallbackAccountId;
  const arnShort = arn.split('/').pop() || arn;
  const sanList = Array.isArray(cert.SubjectAlternativeNames)
    ? cert.SubjectAlternativeNames.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  const primaryName = cert.DomainName?.trim() || sanList[0] || arnShort;
  const { algorithm, keySize } = mapAcmKeyAlgorithm(cert.KeyAlgorithm);
  const signatureAlgorithm = mapAcmSignatureAlgorithm(cert.SignatureAlgorithm);
  const inUseBy = Array.isArray(cert.InUseBy)
    ? cert.InUseBy.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    : [];

  const validFrom =
    cert.NotBefore instanceof Date && !Number.isNaN(cert.NotBefore.getTime())
      ? cert.NotBefore.toISOString()
      : cert.NotBefore
        ? new Date(cert.NotBefore).toISOString()
        : null;
  const validTo =
    cert.NotAfter instanceof Date && !Number.isNaN(cert.NotAfter.getTime())
      ? cert.NotAfter.toISOString()
      : cert.NotAfter
        ? new Date(cert.NotAfter).toISOString()
        : null;

  const location = `aws-acm/${region}/${accountId ?? 'unknown'}/${arnShort}`;

  return {
    externalArn: arn,
    awsAccountId: accountId,
    awsRegion: region,
    acmStatus: cert.Status ?? null,
    inUseBy,
    candidate: {
      sourceRecordId: arn,
      fingerprintSha256: null, // Not returned by DescribeCertificate without GetCertificate; left unknown
      name: primaryName,
      assetType: 'certificate',
      environment: inferEnvironmentFromDomain(primaryName, environmentDefault),
      location,
      subject: cert.Subject?.trim() || (cert.DomainName ? `CN=${cert.DomainName}` : null),
      issuer: cert.Issuer?.trim() || null,
      serialNumber: cert.Serial?.trim() || null,
      algorithm,
      keySize,
      signatureAlgorithm,
      validFrom,
      validTo,
      owner: null, // Not returned by ACM DescribeCertificate; left unknown unless locally assigned
      sanList,
    },
  };
}

export async function resolveAwsSessionCredentials(
  config: {
    authMode: AwsAuthMode;
    awsAccountId?: string | null;
    roleArn?: string | null;
    externalId?: string | null;
    regions: string[];
  },
  clients: AwsConnectorClients
): Promise<{
  credentials?: AwsTempCredentials;
  resolvedAccountId: string | null;
  callerArn: string | null;
}> {
  if (config.authMode === 'sts_assume_role') {
    const assumed = await withAwsRetry(() =>
      clients.assumeRole({
        roleArn: config.roleArn!.trim(),
        externalId: config.externalId!.trim(),
        sessionName: 'ecdat-acm-sync',
      })
    );
    const resolvedAccountId =
      extractAccountIdFromArn(config.roleArn) ??
      extractAccountIdFromArn(assumed.assumedRoleArn) ??
      config.awsAccountId ??
      null;
    return {
      credentials: assumed.credentials,
      resolvedAccountId,
      callerArn: assumed.assumedRoleArn,
    };
  }

  const identity = await withAwsRetry(() => clients.getCallerIdentity());
  const resolvedAccountId = identity.Account ?? config.awsAccountId ?? null;
  if (
    config.awsAccountId &&
    identity.Account &&
    config.awsAccountId.trim() !== identity.Account.trim()
  ) {
    throw new Error(
      `Workload identity resolved AWS account ${identity.Account}, which does not match configured account ${config.awsAccountId}.`
    );
  }
  return {
    credentials: undefined,
    resolvedAccountId,
    callerArn: identity.Arn ?? null,
  };
}

export async function testAwsAcmConnection(
  config: {
    authMode: AwsAuthMode;
    awsAccountId?: string | null;
    roleArn?: string | null;
    externalId?: string | null;
    regions: string[];
  },
  clients: AwsConnectorClients = createDefaultAwsConnectorClients(config.regions[0] || 'us-east-1')
): Promise<ConnectionTestResult> {
  const validationErr = validateAwsConnectionConfig(config);
  if (validationErr) {
    return {
      ok: false,
      resolvedAccountId: null,
      callerArn: null,
      regionsChecked: [],
      sampleCount: 0,
      regionErrors: [],
      message: validationErr,
    };
  }

  let credentials: AwsTempCredentials | undefined;
  let resolvedAccountId: string | null = config.awsAccountId ?? null;
  let callerArn: string | null = null;

  try {
    const session = await resolveAwsSessionCredentials(config, clients);
    credentials = session.credentials;
    resolvedAccountId = session.resolvedAccountId;
    callerArn = session.callerArn;
  } catch (err) {
    return {
      ok: false,
      resolvedAccountId: null,
      callerArn: null,
      regionsChecked: [],
      sampleCount: 0,
      regionErrors: [],
      message: formatAwsErrorMessage(err),
    };
  }

  const regionErrors: SyncRunRegionFailure[] = [];
  const regionsChecked: string[] = [];
  let sampleCount = 0;

  for (const region of config.regions) {
    try {
      const acm = clients.createAcmClient(region, credentials);
      const listRes = await withAwsRetry(() =>
        acm.listCertificates({
          MaxItems: 10,
          CertificateStatuses: ALL_ACM_STATUSES,
          CertificateKeyPairOrigins: ALL_ACM_KEY_ORIGINS,
          Includes: { keyTypes: ALL_ACM_KEY_TYPES },
        })
      );
      regionsChecked.push(region);
      const count = listRes.CertificateSummaryList?.length ?? 0;
      sampleCount += count;

      // Also verify DescribeCertificate permission when at least one certificate exists
      const firstArn = listRes.CertificateSummaryList?.[0]?.CertificateArn;
      if (firstArn) {
        await withAwsRetry(() => acm.describeCertificate(firstArn));
      }
    } catch (err) {
      regionErrors.push({
        region,
        error: formatAwsErrorMessage(err),
      });
    }
  }

  if (regionErrors.length === config.regions.length) {
    return {
      ok: false,
      resolvedAccountId,
      callerArn,
      regionsChecked,
      sampleCount: 0,
      regionErrors,
      message: regionErrors[0]?.error || 'AWS ACM permission test failed in all selected regions.',
    };
  }

  if (regionErrors.length > 0) {
    return {
      ok: false,
      resolvedAccountId,
      callerArn,
      regionsChecked,
      sampleCount,
      regionErrors,
      message: `Verified ${regionsChecked.length} region(s), but ${regionErrors.length} region(s) failed: ${regionErrors
        .map((r) => `${r.region} (${r.error})`)
        .join('; ')}`,
    };
  }

  return {
    ok: true,
    resolvedAccountId,
    callerArn,
    regionsChecked,
    sampleCount,
    regionErrors: [],
    message:
      sampleCount === 0
        ? `Connected to AWS account ${resolvedAccountId ?? 'unknown'}. Checked ${regionsChecked.join(', ')}: 0 ACM certificates found.`
        : `Connected to AWS account ${resolvedAccountId ?? 'unknown'}. Verified ListCertificates & DescribeCertificate across ${regionsChecked.join(', ')}.`,
  };
}

export async function fetchRegionCertificates(params: {
  region: string;
  acm: AcmRegionClient;
  fallbackAccountId: string | null;
  environmentDefault: EnvironmentType;
  retryDelayMs?: number;
}): Promise<SyncedCertificateCandidate[]> {
  const arns: string[] = [];
  let nextToken: string | undefined;
  const retryDelay = params.retryDelayMs ?? 150;

  do {
    const page = await withAwsRetry(
      () =>
        params.acm.listCertificates({
          MaxItems: 100,
          NextToken: nextToken,
          CertificateStatuses: ALL_ACM_STATUSES,
          CertificateKeyPairOrigins: ALL_ACM_KEY_ORIGINS,
          Includes: { keyTypes: ALL_ACM_KEY_TYPES },
        }),
      4,
      retryDelay
    );
    for (const summary of page.CertificateSummaryList ?? []) {
      if (summary.CertificateArn) {
        arns.push(summary.CertificateArn);
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);

  if (arns.length === 0) return [];

  const details = await mapWithBoundedConcurrency(arns, 4, async (arn) => {
    const res = await withAwsRetry(() => params.acm.describeCertificate(arn), 4, retryDelay);
    return res.Certificate
      ? mapCertificateDetailToCandidate(
          res.Certificate,
          params.region,
          params.fallbackAccountId,
          params.environmentDefault
        )
      : null;
  });

  return details.filter((d): d is SyncedCertificateCandidate => d !== null);
}

export function buildIamTrustPolicyJson(
  trustedPrincipalArn: string,
  externalId: string
): string {
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowECDATCrossAccountReadOnlyAssumeRole',
          Effect: 'Allow',
          Principal: {
            AWS: trustedPrincipalArn || 'arn:aws:iam::<ECDAT_TRUSTED_ACCOUNT_ID>:role/<ECDAT_SERVER_ROLE>',
          },
          Action: 'sts:AssumeRole',
          Condition: {
            StringEquals: {
              'sts:ExternalId': externalId,
            },
          },
        },
      ],
    },
    null,
    2
  );
}

export function buildIamPermissionsPolicyJson(): string {
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'ECDATAcmInventoryReadOnly',
          Effect: 'Allow',
          Action: ['acm:ListCertificates', 'acm:DescribeCertificate'],
          Resource: '*',
        },
      ],
    },
    null,
    2
  );
}
