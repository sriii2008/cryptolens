import type {
  CryptoAsset,
  Finding,
  RuleThresholdSettings,
  Severity,
} from '../shared/types.ts';

export interface RuleObservation {
  ruleId: string;
  ruleVersion: string;
  title: string;
  severity: Severity;
  rationale: string;
  recommendation: string;
  evidence: string;
}

const LEGACY_SIG_REGEX = /(?:^|[^a-z0-9])(sha-?1(?![0-9])|md5|rc4|3des|des)(?:[^a-z0-9]|with|$)/i;

export function evaluateAssetRules(
  asset: Pick<
    CryptoAsset,
    | 'name'
    | 'assetType'
    | 'environment'
    | 'algorithm'
    | 'keySize'
    | 'signatureAlgorithm'
    | 'validTo'
    | 'owner'
    | 'fingerprintSha256'
  >,
  settings: RuleThresholdSettings,
  nowUtc: Date = new Date()
): RuleObservation[] {
  const observations: RuleObservation[] = [];
  const nowMs = nowUtc.getTime();
  const nowIso = nowUtc.toISOString();

  // 1. Expired / Expiring Soon (evaluated strictly in UTC)
  if (asset.validTo) {
    const validToMs = Date.parse(asset.validTo);
    if (!Number.isNaN(validToMs)) {
      const diffDays = Math.ceil((validToMs - nowMs) / (1000 * 60 * 60 * 24));
      if (validToMs < nowMs) {
        const overdueDays = Math.max(
          1,
          Math.floor((nowMs - validToMs) / (1000 * 60 * 60 * 24))
        );
        observations.push({
          ruleId: 'EXPIRED_CERT',
          ruleVersion: '1.0.0',
          title: 'Expired certificate or cryptographic validity window',
          severity: 'High',
          rationale:
            'Expired certificates cause immediate TLS handshake failures, service outages, and trust boundary violations.',
          recommendation: `Issue and deploy a replacement ${asset.assetType === 'certificate' ? 'certificate' : 'credential'} immediately and verify automated renewal at ${asset.name}.`,
          evidence: `validTo=${asset.validTo} is ${overdueDays} day(s) before evaluation time ${nowIso}.`,
        });
      } else if (diffDays <= settings.expiryWarningDays) {
        observations.push({
          ruleId: 'EXPIRING_SOON',
          ruleVersion: '1.0.0',
          title: `Certificate expiring within ${settings.expiryWarningDays} days`,
          severity: diffDays <= 7 ? 'High' : 'Medium',
          rationale: `Assets expiring within ${settings.expiryWarningDays} days risk unplanned downtime if renewal pipelines stall.`,
          recommendation: `Schedule rotation for ${asset.name} before ${asset.validTo} and confirm owner readiness.`,
          evidence: `validTo=${asset.validTo} leaves ${diffDays} day(s) remaining (threshold=${settings.expiryWarningDays}d, evaluated=${nowIso}).`,
        });
      }
    }
  }

  // 2. Weak RSA key size under configured threshold
  const algUpper = asset.algorithm.trim().toUpperCase();
  if (algUpper.startsWith('RSA') && asset.keySize !== null) {
    if (asset.keySize < settings.minRsaKeyBits) {
      observations.push({
        ruleId: 'WEAK_RSA_KEY',
        ruleVersion: '1.0.0',
        title: `RSA key size below ${settings.minRsaKeyBits}-bit minimum`,
        severity: 'High',
        rationale: `RSA keys shorter than ${settings.minRsaKeyBits} bits fall below enterprise cryptographic baselines and are vulnerable to factoring attacks.`,
        recommendation: `Re-key ${asset.name} with RSA-${Math.max(2048, settings.minRsaKeyBits)} or ECDSA P-256 and revoke the weak credential.`,
        evidence: `algorithm=${asset.algorithm}, keySize=${asset.keySize} bits (minimum threshold=${settings.minRsaKeyBits} bits).`,
      });
    }
  }

  // 3. Legacy signature or cipher algorithm
  const sigText = asset.signatureAlgorithm ?? '';
  const hasLegacySig = LEGACY_SIG_REGEX.test(sigText) || LEGACY_SIG_REGEX.test(asset.algorithm) || algUpper === 'DSA';
  if (hasLegacySig) {
    const observedValue = asset.signatureAlgorithm
      ? `signatureAlgorithm=${asset.signatureAlgorithm}`
      : `algorithm=${asset.algorithm}`;
    observations.push({
      ruleId: 'LEGACY_SIGNATURE_ALG',
      ruleVersion: '1.0.0',
      title: 'Legacy or deprecated cryptographic signature/algorithm',
      severity: 'High',
      rationale:
        'SHA-1, MD5, DSA, RC4, and DES/3DES algorithms have practical collision or cryptanalytic weaknesses and are rejected by modern browsers and compliance frameworks.',
      recommendation: `Re-issue ${asset.name} using SHA-256 or stronger (e.g., SHA256withECDSA, SHA256withRSA, or Ed25519).`,
      evidence: `Observed legacy primitive: ${observedValue}.`,
    });
  }

  // 4. Missing ownership
  const ownerClean = asset.owner?.trim() ?? '';
  if (!ownerClean || ownerClean.toLowerCase() === 'unknown') {
    observations.push({
      ruleId: 'MISSING_OWNER',
      ruleVersion: '1.0.0',
      title: 'Missing asset owner assignment',
      severity: asset.environment === 'production' ? 'Medium' : 'Low',
      rationale:
        'Cryptographic assets without an accountable team or individual delay incident response and expiration rotation.',
      recommendation: `Assign a responsible team or service owner to ${asset.name} in inventory metadata and future exports.`,
      evidence: `owner=${asset.owner ? `"${asset.owner}"` : 'Unknown'} (environment=${asset.environment}).`,
    });
  }

  return observations;
}

export interface ReconciliationAction {
  toInsert: Array<Omit<Finding, 'id' | 'assetName' | 'assetEnvironment' | 'assetLocation' | 'assetFingerprint' | 'assetOwner'>>;
  toUpdate: Array<{
    existing: Finding;
    next: Finding;
    evidenceChanged: boolean;
    reactivated: boolean;
  }>;
  toClear: Array<{
    existing: Finding;
    clearedAt: string;
  }>;
}

export function reconcileFindingsForAsset(
  workspaceId: string,
  asset: CryptoAsset,
  existingFindings: Finding[],
  settings: RuleThresholdSettings,
  nowUtc: Date = new Date()
): ReconciliationAction {
  const nowIso = nowUtc.toISOString();
  const observations = evaluateAssetRules(asset, settings, nowUtc);
  const existingByRule = new Map<string, Finding>();
  for (const f of existingFindings) {
    existingByRule.set(f.ruleId, f);
  }

  const observedRuleIds = new Set<string>();
  const toInsert: ReconciliationAction['toInsert'] = [];
  const toUpdate: ReconciliationAction['toUpdate'] = [];
  const toClear: ReconciliationAction['toClear'] = [];

  for (const obs of observations) {
    observedRuleIds.add(obs.ruleId);
    const prev = existingByRule.get(obs.ruleId);
    if (!prev) {
      toInsert.push({
        workspaceId,
        assetId: asset.id,
        ruleId: obs.ruleId,
        ruleVersion: obs.ruleVersion,
        title: obs.title,
        severity: obs.severity,
        rationale: obs.rationale,
        recommendation: obs.recommendation,
        evidence: obs.evidence,
        detectionState: 'Active',
        status: 'Open',
        assignee: null,
        dueDate: null,
        acceptedReason: null,
        acceptedReviewDate: null,
        firstObservedAt: nowIso,
        lastObservedAt: nowIso,
        updatedAt: nowIso,
      });
    } else {
      const evidenceChanged = prev.evidence !== obs.evidence || prev.severity !== obs.severity;
      const reactivated = prev.detectionState === 'Cleared';
      toUpdate.push({
        existing: prev,
        evidenceChanged,
        reactivated,
        next: {
          ...prev,
          ruleVersion: obs.ruleVersion,
          title: obs.title,
          severity: obs.severity,
          rationale: obs.rationale,
          recommendation: obs.recommendation,
          evidence: obs.evidence,
          detectionState: 'Active',
          lastObservedAt: nowIso,
          updatedAt: evidenceChanged || reactivated ? nowIso : prev.updatedAt,
        },
      });
    }
  }

  for (const prev of existingFindings) {
    if (!observedRuleIds.has(prev.ruleId) && prev.detectionState === 'Active') {
      toClear.push({
        existing: prev,
        clearedAt: nowIso,
      });
    }
  }

  return { toInsert, toUpdate, toClear };
}
