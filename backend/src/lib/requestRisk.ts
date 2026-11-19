/**
 * requestRisk.ts – Pure suspiciousness assessment of a pending approval request. Compares the
 * request's snapshot with the last APPROVED snapshot of the same instance and turns the
 * differences, the certificate/CA facts and the submit history into weighted findings and a
 * LOW / MEDIUM / HIGH level. No I/O: request-risk.service gathers every input.
 *
 * Domain comparison is deliberately simple: the "registrable domain" of a host is its last two
 * labels (no public-suffix list), so `a.b.co.uk` is treated as `co.uk`. IP hosts are compared
 * as-is. That errs towards flagging, which is the safe direction for a review hint.
 *
 * Dependencies: lib/requestRiskSupport, lib/snapshotCompare (snapshotsDiffer)
 */
import {
  commonName,
  daysUntil,
  isPrivateIp,
  nameMatches,
  normDn,
  normalize,
  registrableDomain,
  type NCert,
  type NSnap,
} from './requestRiskSupport';
import { snapshotsDiffer } from './snapshotCompare';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskSeverity = 'info' | 'low' | 'medium' | 'high';
export type CaStatus = 'whitelisted' | 'blacklisted' | 'unknown';

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

/** Facts parsed from a stored certificate PEM; notAfter is an ISO date string. */
export interface CertInfo {
  issuerDn: string;
  subjectDn: string;
  sanDns: string[];
  notAfter: string;
}

export interface RiskContext {
  rejectedLast30d: number;
  withdrawnLast30d: number;
  submitterIp: string | null;
  knownSubmitIps: string[];
  /** IP address → identifiers of the OTHER organizations that use it. */
  otherOrgsByIp: Record<string, string[]>;
  now: Date;
}

export interface RiskInput {
  /** Snapshot of the request (JSON string or object). */
  current: unknown;
  /** Last APPROVED snapshot of the same instance, null for a first request. */
  previous: unknown | null;
  /** Certificate id → parsed facts, for the current and the previous certificates. */
  certInfo: Record<string, CertInfo>;
  /** Issuer DN (as in certInfo) → CA list status. */
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
  CERT_CA_NOT_WHITELISTED: { severity: 'high', weight: 4 },
  CERT_CA_BLACKLISTED: { severity: 'high', weight: 6 },
  CERT_SUBJECT_MISMATCH: { severity: 'medium', weight: 2 },
  CERT_ADDED: { severity: 'low', weight: 1 },
  CERT_ALL_REPLACED: { severity: 'medium', weight: 2 },
  CERT_SHORT_VALIDITY: { severity: 'info', weight: 0 },
  ENDPOINT_ADDRESS_CHANGED: { severity: 'medium', weight: 2 },
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
  CONTACTS_ALL_REPLACED: { severity: 'medium', weight: 2 },
  CONTACT_UNVALIDATED: { severity: 'low', weight: 1 },
  MEMBERSHIP_NEW_PARENT: { severity: 'medium', weight: 2 },
  MEMBERSHIP_ROLE_ADDED: { severity: 'low', weight: 1 },
  MEMBERSHIP_REMOVED: { severity: 'low', weight: 1 },
  FIRST_REQUEST: { severity: 'info', weight: 0 },
  RECENT_REJECTIONS: { severity: 'medium', weight: 2 },
  RECENT_WITHDRAWALS: { severity: 'low', weight: 1 },
  NEW_SUBMIT_IP: { severity: 'low', weight: 1 },
  TAKEOVER_PATTERN: { severity: 'high', weight: 4 },
  NOTHING_CHANGED: { severity: 'info', weight: 0 },
};

const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 3, medium: 2, low: 1, info: 0 };
const RENEWAL_WINDOW_DAYS = 60;
const SHORT_VALIDITY_DAYS = 30;

// ── Assessment ────────────────────────────────────────────────────────────────

export function assessRequest(input: RiskInput): RiskAssessment {
  const cur = normalize(input.current);
  const prev = input.previous === null ? null : normalize(input.previous);
  const { certInfo, caStatus, context } = input;
  const findings: RiskFinding[] = [];
  const has = (code: string) => findings.some((f) => f.code === code);
  const add = (code: string, params: Record<string, string | number> = {}) => {
    const rule = RISK_RULES[code];
    findings.push({ code, severity: rule.severity, weight: rule.weight, params });
  };

  const orgDomain = registrableDomain(cur.orgId);
  const prevThumbs = new Set((prev?.certs ?? []).map((c) => c.thumbprint));
  const curThumbs = new Set(cur.certs.map((c) => c.thumbprint));
  const newCerts = cur.certs.filter((c) => !prevThumbs.has(c.thumbprint));
  const removedCerts = (prev?.certs ?? []).filter((c) => !curThumbs.has(c.thumbprint));

  const notAfter = (c: NCert) => certInfo[c.id]?.notAfter ?? c.validUntil;
  const subjectDn = (c: NCert) => certInfo[c.id]?.subjectDn;
  const issuerOf = (c: NCert) => certInfo[c.id]?.issuerDn;
  const cnOf = (c: NCert) => (subjectDn(c) ? commonName(subjectDn(c) as string) : c.subject);

  // Certificates: replacements (same subject preferred), renewal vs. early replacement.
  let certChangeNotRenewal = false;
  const unmatchedOld = [...removedCerts];
  const unmatchedNew: NCert[] = [];
  if (prev) {
    for (const nc of newCerts) {
      let idx = unmatchedOld.findIndex((oc) =>
        subjectDn(oc) && subjectDn(nc)
          ? normDn(subjectDn(oc) as string) === normDn(subjectDn(nc) as string)
          : oc.subject === nc.subject,
      );
      if (idx < 0 && unmatchedOld.length > 0) idx = 0;
      if (idx < 0) {
        unmatchedNew.push(nc);
        continue;
      }
      const [oc] = unmatchedOld.splice(idx, 1);
      const days = daysUntil(notAfter(oc), context.now);
      const sameSubject =
        subjectDn(oc) && subjectDn(nc)
          ? normDn(subjectDn(oc) as string) === normDn(subjectDn(nc) as string)
          : oc.subject === nc.subject;
      const oldIssuer = issuerOf(oc);
      const newIssuer = issuerOf(nc);
      const issuerKnown = !!oldIssuer && !!newIssuer;
      const sameIssuer = issuerKnown && normDn(oldIssuer as string) === normDn(newIssuer as string);
      const issuerChanged = issuerKnown && !sameIssuer;
      if (issuerChanged) {
        add('CERT_ISSUER_CHANGED', {
          from: commonName(oldIssuer as string),
          to: commonName(newIssuer as string),
        });
        certChangeNotRenewal = true;
      }
      if (days !== null && days > RENEWAL_WINDOW_DAYS) {
        add('CERT_EARLY_REPLACE', { cn: cnOf(oc), days });
        certChangeNotRenewal = true;
      } else if (sameSubject && !issuerChanged) {
        add('CERT_RENEWAL', { cn: cnOf(nc), days: days ?? 0 });
      } else if (!issuerChanged) {
        certChangeNotRenewal = true;
      }
    }
    if (unmatchedNew.length > 0 && cur.certs.length > prev.certs.length) {
      add('CERT_ADDED', { n: unmatchedNew.length });
      certChangeNotRenewal = true;
    } else if (unmatchedNew.length > 0) {
      certChangeNotRenewal = true;
    }
    for (const nc of unmatchedNew) {
      const prevIssuers = prev.certs.map(issuerOf).filter((d): d is string => !!d);
      const own = issuerOf(nc);
      if (own && prevIssuers.length > 0 && !prevIssuers.some((p) => normDn(p) === normDn(own))) {
        add('CERT_ISSUER_CHANGED', { from: commonName(prevIssuers[0]), to: commonName(own) });
      }
    }
    if (prev.certs.length > 1 && removedCerts.length === prev.certs.length) {
      add('CERT_ALL_REPLACED', { n: prev.certs.length });
      certChangeNotRenewal = true;
    }
  }

  // Facts about every new certificate (all of them on a first request).
  const checked = prev ? newCerts : cur.certs;
  const endpointDomains = new Set(
    cur.endpoints.filter((e) => e.host).map((e) => registrableDomain(e.host as string)),
  );
  const allowedDomains = [cur.orgId, orgDomain, ...endpointDomains].filter(Boolean);
  const seenIssuers = new Set<string>();
  for (const c of checked) {
    const info = certInfo[c.id];
    if (info) {
      const status = caStatus[info.issuerDn] ?? 'unknown';
      if (status !== 'whitelisted' && !seenIssuers.has(info.issuerDn)) {
        seenIssuers.add(info.issuerDn);
        add(status === 'blacklisted' ? 'CERT_CA_BLACKLISTED' : 'CERT_CA_NOT_WHITELISTED', {
          ca: commonName(info.issuerDn),
        });
      }
      const names = [commonName(info.subjectDn), ...info.sanDns].filter(Boolean);
      if (names.length > 0 && !names.some((n) => allowedDomains.some((d) => nameMatches(n, d)))) {
        add('CERT_SUBJECT_MISMATCH', { cn: commonName(info.subjectDn) || names[0] });
      }
    }
    const days = daysUntil(notAfter(c), context.now);
    if (days !== null && days <= SHORT_VALIDITY_DAYS) {
      add('CERT_SHORT_VALIDITY', { cn: cnOf(c), days });
    }
  }

  // Endpoints.
  const prevByIdent = new Map((prev?.endpoints ?? []).map((e) => [e.identifier, e]));
  const curByIdent = new Map(cur.endpoints.map((e) => [e.identifier, e]));
  const knownDomains = new Set<string>([orgDomain]);
  for (const e of prev?.endpoints ?? []) if (e.host) knownDomains.add(registrableDomain(e.host));
  const foreign = new Set<string>();
  const checkForeign = (host: string | null) => {
    if (!host) return;
    const d = registrableDomain(host);
    if (!knownDomains.has(d) && !foreign.has(d)) {
      foreign.add(d);
      add('ENDPOINT_FOREIGN_DOMAIN', { host });
    }
  };
  if (prev) {
    for (const e of cur.endpoints) {
      const old = prevByIdent.get(e.identifier);
      if (!old) {
        add('ENDPOINT_ADDED', { identifier: e.identifier });
        checkForeign(e.host);
      } else if (old.host !== e.host) {
        add('ENDPOINT_ADDRESS_CHANGED', { from: old.host ?? '', to: e.host ?? '' });
        checkForeign(e.host);
      }
    }
    for (const e of prev.endpoints) {
      if (!curByIdent.has(e.identifier)) add('ENDPOINT_REMOVED', { identifier: e.identifier });
    }
  } else {
    for (const e of cur.endpoints) checkForeign(e.host);
  }

  // IP addresses. Added / replaced are judged over endpoints present in both snapshots;
  // private and shared checks cover every IP that was not approved before.
  const ipsOf = (n: NSnap) => new Set(n.endpoints.flatMap((e) => [...e.ips]));
  const prevIps = prev ? ipsOf(prev) : new Set<string>();
  const newIps = [...ipsOf(cur)].filter((ip) => !prevIps.has(ip)).sort();
  if (prev) {
    const shared = cur.endpoints.filter((e) => prevByIdent.has(e.identifier));
    const prevShared = new Set(
      shared.flatMap((e) => [...(prevByIdent.get(e.identifier)?.ips ?? [])]),
    );
    const curShared = new Set(shared.flatMap((e) => [...e.ips]));
    if (prevShared.size > 0 && curShared.size > 0) {
      const addedOnShared = [...curShared].filter((ip) => !prevShared.has(ip)).length;
      if (addedOnShared === curShared.size) add('IP_REPLACED_ALL');
      else if (addedOnShared > 0) add('IP_ADDED', { n: addedOnShared });
    }
  }
  const privateIps = newIps.filter(isPrivateIp);
  if (privateIps.length > 0) {
    add('IP_PRIVATE', {
      ips: privateIps.slice(0, 3).join(', ') + (privateIps.length > 3 ? ', …' : ''),
    });
  }
  for (const ip of newIps) {
    const others = (context.otherOrgsByIp[ip] ?? []).filter((o) => o.toLowerCase() !== cur.orgId);
    if (others.length > 0) add('IP_SHARED', { ip, org: others[0] });
  }

  // Organization, contacts, memberships.
  if (prev) {
    if (prev.orgName !== null && cur.orgName !== null && prev.orgName !== cur.orgName) {
      add('ORG_NAME_CHANGED', { from: prev.orgName, to: cur.orgName });
    }
    if (prev.active === true && cur.active === false) add('ORG_DEACTIVATED');
    if (prev.digest !== null && cur.digest !== null && prev.digest !== cur.digest) {
      add('CONTACT_DATA_CHANGED');
    }
    const prevContactIds = new Set(prev.contacts.map((c) => c.id));
    if (prev.contacts.length > 0 && !cur.contacts.some((c) => prevContactIds.has(c.id))) {
      add('CONTACTS_ALL_REPLACED', { n: prev.contacts.length });
    }
  }
  const prevContactIds = new Set((prev?.contacts ?? []).map((c) => c.id));
  const unvalidated = cur.contacts.filter(
    (c) => c.types.includes('DSF_ADMIN') && !c.emailValidated && !prevContactIds.has(c.id),
  );
  if (unvalidated.length > 0) add('CONTACT_UNVALIDATED', { n: unvalidated.length });

  if (prev) {
    for (const [parent, roles] of cur.memberships) {
      const old = prev.memberships.get(parent);
      if (!old) {
        add('MEMBERSHIP_NEW_PARENT', { parent });
        continue;
      }
      const added = [...roles].filter((r) => !old.has(r));
      if (added.length > 0) add('MEMBERSHIP_ROLE_ADDED', { parent, roles: added.join(', ') });
    }
    for (const parent of prev.memberships.keys()) {
      if (!cur.memberships.has(parent)) add('MEMBERSHIP_REMOVED', { parent });
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
  if (
    prev &&
    certChangeNotRenewal &&
    (has('CONTACT_DATA_CHANGED') ||
      has('ENDPOINT_FOREIGN_DOMAIN') ||
      has('ENDPOINT_ADDRESS_CHANGED'))
  ) {
    add('TAKEOVER_PATTERN');
  }
  if (
    prev &&
    input.current !== undefined &&
    snapshotsDiffer(input.current, input.previous) === false
  ) {
    add('NOTHING_CHANGED');
  }

  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const score = findings.reduce((sum, f) => sum + f.weight, 0);
  const hasSeverity = (s: RiskSeverity) => findings.some((f) => f.severity === s);
  const level: RiskLevel =
    hasSeverity('high') || score >= 6
      ? 'HIGH'
      : hasSeverity('medium') || score >= 3
        ? 'MEDIUM'
        : 'LOW';
  return { level, score, firstRequest: prev === null, findings };
}
