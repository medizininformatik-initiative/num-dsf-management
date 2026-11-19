/**
 * requestRisk.ts – Pure suspiciousness assessment of a pending approval request. Compares the
 * request's snapshot with the last APPROVED snapshot of the same instance and turns the
 * differences, the certificate/CA facts and the submit history into weighted findings and a
 * LOW / MEDIUM / HIGH level. No I/O: request-risk.service gathers every input.
 *
 * Scoring: the level is derived from the positive weights only, so the one mitigating finding
 * (a routine certificate renewal, -1) can never lower it, and the mitigation is withdrawn
 * (weight 0) as soon as the request also has a medium or high finding or a new submit IP.
 * Domains are compared by registrable domain (last two labels, three under common second-level
 * suffixes such as ac.uk), see requestRiskNet.
 *
 * Dependencies: lib/requestRiskSupport, lib/requestRiskNet, lib/requestRiskCerts,
 *               lib/requestRiskEndpoints, lib/snapshotCompare
 */
import {
  analyzeCertificates,
  allowedCertDomains,
  type CaStatus,
  type CertInfo,
  type RawFinding,
} from './requestRiskCerts';
import { analyzeEndpoints } from './requestRiskEndpoints';
import { normalize } from './requestRiskSupport';
import { snapshotsDiffer } from './snapshotCompare';

export type { CaStatus, CertInfo };
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskSeverity = 'info' | 'low' | 'medium' | 'high';

export interface RiskFinding {
  code: string;
  severity: RiskSeverity;
  weight: number;
  params: Record<string, string | number>;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  firstRequest: boolean;
  findings: RiskFinding[];
}

export interface RiskContext {
  rejectedLast30d: number;
  withdrawnLast30d: number;
  submitterIp: string | null;
  knownSubmitIps: string[];
  /** IP address → identifiers of the OTHER organizations that use it. */
  otherOrgsByIp: Record<string, string[]>;
  /**
   * The site has a login entry that does not come from an approval (onboarding, admin or
   * migrated). Left out when unknown: CERT_NO_LOGIN is then not raised.
   */
  hasLoginOutsideApproval?: boolean;
  now: Date;
}

export interface RiskInput {
  /** Snapshot of the request (JSON string or object). */
  current: unknown;
  /** Last APPROVED snapshot of the same instance, null for a first request. */
  previous: unknown | null;
  /** When that previous snapshot was approved. */
  previousResolvedAt?: Date | null;
  /** The APPROVED snapshot before the previous one (for the split takeover pattern). */
  beforePrevious?: unknown | null;
  /** Certificate id → parsed facts, for the current and the previous certificates. */
  certInfo: Record<string, CertInfo>;
  /** Issuer DN (as in certInfo or the snapshot) → CA list status. */
  caStatus: Record<string, CaStatus>;
  context: RiskContext;
}

interface Rule {
  severity: RiskSeverity;
  weight: number;
}

/** Severity and weight of every finding code; negative weights are mitigating. */
export const RISK_RULES: Record<string, Rule> = {
  CERT_RENEWAL: { severity: 'info', weight: -1 },
  CERT_EARLY_REPLACE: { severity: 'medium', weight: 2 },
  CERT_ISSUER_CHANGED: { severity: 'medium', weight: 2 },
  CERT_SUBJECT_CHANGED: { severity: 'medium', weight: 2 },
  CERT_NOT_COMPARABLE: { severity: 'low', weight: 1 },
  CERT_CA_NOT_WHITELISTED: { severity: 'high', weight: 4 },
  CERT_CA_BLACKLISTED: { severity: 'high', weight: 6 },
  CERT_SUBJECT_MISMATCH: { severity: 'medium', weight: 2 },
  CERT_ADDED: { severity: 'low', weight: 1 },
  CERT_ALL_REPLACED: { severity: 'medium', weight: 2 },
  CERT_EXPIRED: { severity: 'medium', weight: 2 },
  CERT_SHORT_VALIDITY: { severity: 'low', weight: 1 },
  CERT_LOGIN_ONLY: { severity: 'medium', weight: 2 },
  CERT_UNPUBLISHED: { severity: 'low', weight: 1 },
  CERT_NO_LOGIN: { severity: 'medium', weight: 2 },
  ENDPOINT_ADDRESS_CHANGED: { severity: 'medium', weight: 2 },
  ENDPOINT_SCHEME_DOWNGRADE: { severity: 'medium', weight: 2 },
  ENDPOINT_URL_CHANGED: { severity: 'low', weight: 1 },
  ENDPOINT_ADDRESS_UNREADABLE: { severity: 'medium', weight: 2 },
  ENDPOINT_FOREIGN_DOMAIN: { severity: 'high', weight: 4 },
  ENDPOINT_ADDED: { severity: 'low', weight: 1 },
  ENDPOINT_REMOVED: { severity: 'medium', weight: 2 },
  IP_ADDED: { severity: 'low', weight: 1 },
  IP_REPLACED_ALL: { severity: 'medium', weight: 2 },
  IP_PRIVATE: { severity: 'medium', weight: 2 },
  IP_SHARED: { severity: 'medium', weight: 2 },
  ORG_NAME_CHANGED: { severity: 'medium', weight: 2 },
  ORG_DEACTIVATED: { severity: 'low', weight: 1 },
  CONTACT_DATA_CHANGED: { severity: 'medium', weight: 2 },
  CONTACT_DATA_NOT_COMPARABLE: { severity: 'info', weight: 0 },
  CONTACTS_ALL_REPLACED: { severity: 'medium', weight: 2 },
  CONTACT_UNVALIDATED: { severity: 'low', weight: 1 },
  CONTACT_ROLE_CHANGED: { severity: 'low', weight: 1 },
  MEMBERSHIP_NEW_PARENT: { severity: 'medium', weight: 2 },
  MEMBERSHIP_ROLE_ADDED: { severity: 'low', weight: 1 },
  MEMBERSHIP_REMOVED: { severity: 'low', weight: 1 },
  FIRST_REQUEST: { severity: 'info', weight: 0 },
  RECENT_REJECTIONS: { severity: 'low', weight: 1 },
  RECENT_WITHDRAWALS: { severity: 'low', weight: 1 },
  NEW_SUBMIT_IP: { severity: 'low', weight: 1 },
  TAKEOVER_PATTERN: { severity: 'high', weight: 4 },
  SNAPSHOT_UNREADABLE: { severity: 'high', weight: 4 },
  NOTHING_CHANGED: { severity: 'info', weight: 0 },
};

const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 3, medium: 2, low: 1, info: 0 };
const DAY_MS = 86400_000;
const SPLIT_WINDOW_DAYS = 30;

function toFinding(raw: RawFinding): RiskFinding {
  const rule = RISK_RULES[raw.code];
  return { code: raw.code, severity: rule.severity, weight: rule.weight, params: raw.params };
}

export function assessRequest(input: RiskInput): RiskAssessment {
  const cur = normalize(input.current);
  const previousSnap = input.previous === null ? null : normalize(input.previous);
  // An unreadable "previous" snapshot cannot be compared with: treat the request as a first one.
  const prev = previousSnap && previousSnap.readable ? previousSnap : null;
  const { certInfo, caStatus, context } = input;
  if (!cur.readable) {
    const finding = toFinding({ code: 'SNAPSHOT_UNREADABLE', params: {} });
    return {
      level: 'HIGH',
      score: finding.weight,
      firstRequest: prev === null,
      findings: [finding],
    };
  }

  const findings: RiskFinding[] = [];
  const has = (code: string) => findings.some((f) => f.code === code);
  const add = (code: string, params: Record<string, string | number> = {}) =>
    findings.push(toFinding({ code, params }));
  const addAll = (raw: RawFinding[]) => raw.forEach((r) => add(r.code, r.params));

  const certs = analyzeCertificates({
    cur,
    prev,
    certInfo,
    caStatus,
    now: context.now,
    allowedDomains: allowedCertDomains(cur),
  });
  addAll(certs.findings);
  // Nothing marked for login and no other way in: after approval the site could not log in.
  if (
    context.hasLoginOutsideApproval === false &&
    cur.certs.length > 0 &&
    cur.certs.every((c) => !c.login)
  ) {
    add('CERT_NO_LOGIN');
  }
  addAll(analyzeEndpoints({ cur, prev, otherOrgsByIp: context.otherOrgsByIp }));

  // Organization, contacts, memberships.
  if (prev) {
    if (prev.orgName !== null && cur.orgName !== null && prev.orgName !== cur.orgName) {
      add('ORG_NAME_CHANGED', { from: prev.orgName, to: cur.orgName });
    }
    if (prev.active === true && cur.active === false) add('ORG_DEACTIVATED');
    if (prev.digest === null || cur.digest === null) add('CONTACT_DATA_NOT_COMPARABLE');
    else if (prev.digest !== cur.digest) add('CONTACT_DATA_CHANGED');
    const prevContacts = new Map(prev.contacts.map((c) => [c.id, c]));
    if (prev.contacts.length > 0 && !cur.contacts.some((c) => prevContacts.has(c.id))) {
      add('CONTACTS_ALL_REPLACED', { n: prev.contacts.length });
    }
    const promoted = cur.contacts.filter((c) => {
      const old = prevContacts.get(c.id);
      return !!old && c.types.includes('DSF_ADMIN') && !old.types.includes('DSF_ADMIN');
    });
    if (promoted.length > 0) add('CONTACT_ROLE_CHANGED', { n: promoted.length });
  }
  const knownContactIds = new Set((prev?.contacts ?? []).map((c) => c.id));
  const unvalidated = cur.contacts.filter(
    (c) => c.types.includes('DSF_ADMIN') && !c.emailValidated && !knownContactIds.has(c.id),
  );
  if (unvalidated.length > 0) add('CONTACT_UNVALIDATED', { n: unvalidated.length });

  if (prev) {
    for (const [key, m] of cur.memberships) {
      const old = prev.memberships.get(key);
      if (!old) {
        add('MEMBERSHIP_NEW_PARENT', { parent: m.parent });
        continue;
      }
      const added = [...m.roles].filter((r) => !old.roles.has(r));
      if (added.length > 0)
        add('MEMBERSHIP_ROLE_ADDED', { parent: m.parent, roles: added.join(', ') });
    }
    for (const [key, m] of prev.memberships) {
      if (!cur.memberships.has(key)) add('MEMBERSHIP_REMOVED', { parent: m.parent });
    }
  }

  // Context.
  if (!prev) add('FIRST_REQUEST');
  if (context.rejectedLast30d >= 1) add('RECENT_REJECTIONS', { n: context.rejectedLast30d });
  if (context.withdrawnLast30d >= 2) add('RECENT_WITHDRAWALS', { n: context.withdrawnLast30d });
  if (
    context.submitterIp &&
    context.knownSubmitIps.length > 0 &&
    !context.knownSubmitIps.includes(context.submitterIp)
  ) {
    add('NEW_SUBMIT_IP');
  }

  // Combinations.
  const identityChange =
    has('CONTACT_DATA_CHANGED') ||
    has('CONTACTS_ALL_REPLACED') ||
    has('ENDPOINT_FOREIGN_DOMAIN') ||
    has('ENDPOINT_ADDRESS_CHANGED');
  if (prev && certs.nonRenewalChange && identityChange) add('TAKEOVER_PATTERN');
  if (prev && !has('TAKEOVER_PATTERN') && input.beforePrevious && input.previousResolvedAt) {
    const earlier = normalize(input.beforePrevious);
    const ageDays = Math.floor(
      (context.now.getTime() - input.previousResolvedAt.getTime()) / DAY_MS,
    );
    const certSuspicious = certs.nonRenewalChange || (certs.hasRenewal && has('NEW_SUBMIT_IP'));
    if (earlier.readable && ageDays >= 0 && ageDays <= SPLIT_WINDOW_DAYS && certSuspicious) {
      const contactChanged = !!prev.digest && !!earlier.digest && prev.digest !== earlier.digest;
      const earlierHosts = new Map(earlier.endpoints.map((e) => [e.identifier, e.parsed.host]));
      const endpointChanged = prev.endpoints.some(
        (e) => earlierHosts.has(e.identifier) && earlierHosts.get(e.identifier) !== e.parsed.host,
      );
      if (contactChanged || endpointChanged) {
        add('TAKEOVER_PATTERN', { after: contactChanged ? 'contact' : 'endpoint', days: ageDays });
      }
    }
  }
  if (prev && snapshotsDiffer(input.current, input.previous) === false) add('NOTHING_CHANGED');

  // A routine renewal only counts as mitigating while nothing else speaks against the request.
  const blocked =
    has('NEW_SUBMIT_IP') || findings.some((f) => f.severity === 'medium' || f.severity === 'high');
  if (blocked) {
    for (const f of findings) if (f.weight < 0) f.weight = 0;
  }

  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const score = findings.reduce((sum, f) => sum + f.weight, 0);
  const risk = findings.reduce((sum, f) => sum + Math.max(0, f.weight), 0);
  const any = (s: RiskSeverity) => findings.some((f) => f.severity === s);
  const level: RiskLevel =
    any('high') || risk >= 6 ? 'HIGH' : any('medium') || risk >= 3 ? 'MEDIUM' : 'LOW';
  return { level, score, firstRequest: prev === null, findings };
}
