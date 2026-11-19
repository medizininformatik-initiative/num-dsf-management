/**
 * requestRiskCerts.ts – Certificate part of the request-risk assessment: pairs replaced
 * certificates (same subject first, then the leftovers, independent of snapshot order), tells a
 * routine renewal from an early replacement, CA swap or subject change, and checks every new
 * certificate (CA list status, names against the organization / endpoint domains, expiry).
 * Issuer, subject and expiry come from the facts stored with the snapshot first and from the
 * database lookup second; when the issuer or the old expiry is unknown the replacement is
 * never rated a renewal.
 * Dependencies: lib/requestRiskSupport, lib/requestRiskNet
 */
import { registrableDomain } from './requestRiskNet';
import {
  commonName,
  daysUntil,
  nameMatches,
  normDn,
  type NCert,
  type NSnap,
} from './requestRiskSupport';

export interface RawFinding {
  code: string;
  params: Record<string, string | number>;
}

export type CaStatus = 'whitelisted' | 'blacklisted' | 'unknown';

/** Facts parsed from a stored certificate PEM; notAfter is an ISO date string. */
export interface CertInfo {
  issuerDn: string;
  subjectDn: string;
  sanDns: string[];
  notAfter: string;
}

export interface CertAnalysis {
  findings: RawFinding[];
  /** A certificate change that is not a routine renewal (feeds the takeover patterns). */
  nonRenewalChange: boolean;
  hasRenewal: boolean;
}

const RENEWAL_WINDOW_DAYS = 60;
const SHORT_VALIDITY_DAYS = 30;

interface Facts {
  issuerDn?: string;
  subjectDn?: string;
  names: string[];
  cn: string;
  notAfter: string | null;
}

function factsOf(c: NCert, certInfo: Record<string, CertInfo>): Facts {
  const db = certInfo[c.id];
  const subjectDn = c.subjectDn ?? db?.subjectDn;
  const cn = subjectDn ? commonName(subjectDn) : c.subject;
  const sans = c.sanDns ?? db?.sanDns ?? [];
  return {
    issuerDn: c.issuerDn ?? db?.issuerDn,
    subjectDn,
    cn,
    names: [cn, ...sans].filter(Boolean),
    notAfter: c.notAfter ?? db?.notAfter ?? c.validUntil,
  };
}

function sameSubject(a: Facts, b: Facts): boolean {
  if (a.subjectDn && b.subjectDn) return normDn(a.subjectDn) === normDn(b.subjectDn);
  return a.cn.toLowerCase() === b.cn.toLowerCase();
}

const byThumbprint = (a: NCert, b: NCert) => (a.thumbprint < b.thumbprint ? -1 : 1);

export function analyzeCertificates(args: {
  cur: NSnap;
  prev: NSnap | null;
  certInfo: Record<string, CertInfo>;
  caStatus: Record<string, CaStatus>;
  now: Date;
  /** Domains a new certificate may legitimately be issued for. */
  allowedDomains: string[];
}): CertAnalysis {
  const { cur, prev, certInfo, caStatus, now, allowedDomains } = args;
  const out: CertAnalysis = { findings: [], nonRenewalChange: false, hasRenewal: false };
  const add = (code: string, params: Record<string, string | number> = {}) =>
    out.findings.push({ code, params });
  const facts = (c: NCert) => factsOf(c, certInfo);

  // A previous snapshot whose certificates carry no thumbprint cannot be matched at all.
  const comparable = !!prev && prev.certs.every((c) => c.thumbprint !== '');
  const prevThumbs = new Set((comparable ? prev.certs : []).map((c) => c.thumbprint));
  const curThumbs = new Set(cur.certs.map((c) => c.thumbprint));
  const newCerts = cur.certs.filter((c) => !comparable || !prevThumbs.has(c.thumbprint));
  const removed = comparable ? prev.certs.filter((c) => !curThumbs.has(c.thumbprint)) : [];

  if (prev && !comparable) add('CERT_NOT_COMPARABLE', { cn: '' });

  if (prev && comparable) {
    // Pair replacements: same subject first (both lists sorted, so the result does not depend
    // on the order of the snapshot), then whatever is left over.
    const oldLeft = [...removed].sort(byThumbprint);
    const newLeft = [...newCerts].sort(byThumbprint);
    const pairs: Array<[NCert, NCert]> = [];
    for (const nc of [...newLeft]) {
      const idx = oldLeft.findIndex((oc) => sameSubject(facts(oc), facts(nc)));
      if (idx < 0) continue;
      pairs.push([oldLeft.splice(idx, 1)[0], nc]);
      newLeft.splice(newLeft.indexOf(nc), 1);
    }
    while (oldLeft.length > 0 && newLeft.length > 0) {
      pairs.push([oldLeft.shift() as NCert, newLeft.shift() as NCert]);
    }
    let renewals = 0;
    for (const [oc, nc] of pairs) {
      const o = facts(oc);
      const n = facts(nc);
      const days = daysUntil(o.notAfter, now);
      const sameSubj = sameSubject(o, n);
      const knownIssuers = !!o.issuerDn && !!n.issuerDn;
      const issuerChanged =
        knownIssuers && normDn(o.issuerDn as string) !== normDn(n.issuerDn as string);
      if (!knownIssuers || days === null) {
        add('CERT_NOT_COMPARABLE', { cn: n.cn });
        out.nonRenewalChange = true;
      } else {
        if (issuerChanged) {
          add('CERT_ISSUER_CHANGED', {
            from: commonName(o.issuerDn as string),
            to: commonName(n.issuerDn as string),
          });
          out.nonRenewalChange = true;
        }
        if (days > RENEWAL_WINDOW_DAYS) {
          add('CERT_EARLY_REPLACE', { cn: o.cn, days });
          out.nonRenewalChange = true;
        } else if (sameSubj && !issuerChanged) {
          add('CERT_RENEWAL', { cn: n.cn, days });
          renewals++;
        }
      }
      if (!sameSubj) {
        add('CERT_SUBJECT_CHANGED', { from: o.cn, to: n.cn });
        out.nonRenewalChange = true;
      }
    }
    out.hasRenewal = renewals > 0;
    const allRenewals = pairs.length > 0 && renewals === pairs.length && newLeft.length === 0;
    if (newLeft.length > 0) {
      if (cur.certs.length > prev.certs.length) add('CERT_ADDED', { n: newLeft.length });
      out.nonRenewalChange = true;
      const prevIssuers = prev.certs.map((c) => facts(c).issuerDn).filter((d): d is string => !!d);
      for (const nc of newLeft) {
        const own = facts(nc).issuerDn;
        if (own && prevIssuers.length > 0 && !prevIssuers.some((p) => normDn(p) === normDn(own))) {
          add('CERT_ISSUER_CHANGED', { from: commonName(prevIssuers[0]), to: commonName(own) });
        }
      }
    }
    if (prev.certs.length > 1 && removed.length === prev.certs.length && !allRenewals) {
      add('CERT_ALL_REPLACED', { n: prev.certs.length });
      out.nonRenewalChange = true;
    }
  }

  // Facts about every new certificate (all of them when there is nothing to compare with).
  const seenIssuers = new Set<string>();
  for (const c of newCerts) {
    const f = facts(c);
    if (f.issuerDn) {
      const status = caStatus[f.issuerDn] ?? 'unknown';
      if (status !== 'whitelisted' && !seenIssuers.has(f.issuerDn)) {
        seenIssuers.add(f.issuerDn);
        add(status === 'blacklisted' ? 'CERT_CA_BLACKLISTED' : 'CERT_CA_NOT_WHITELISTED', {
          ca: commonName(f.issuerDn),
        });
      }
    }
    if (f.names.length > 0 && !f.names.some((n) => allowedDomains.some((d) => nameMatches(n, d)))) {
      add('CERT_SUBJECT_MISMATCH', { cn: f.cn || f.names[0] });
    }
    const days = daysUntil(f.notAfter, now);
    if (days !== null && days < 0) add('CERT_EXPIRED', { cn: f.cn, days });
    else if (days !== null && days <= SHORT_VALIDITY_DAYS)
      add('CERT_SHORT_VALIDITY', { cn: f.cn, days });
  }
  return out;
}

/** Domains a certificate of this organization may be issued for: identifier and endpoint hosts. */
export function allowedCertDomains(cur: NSnap): string[] {
  const hosts = cur.endpoints.filter((e) => e.parsed.readable).map((e) => e.parsed.host);
  const domains = [cur.orgId, registrableDomain(cur.orgId), ...hosts.map(registrableDomain)];
  return [...new Set(domains.filter(Boolean))];
}
