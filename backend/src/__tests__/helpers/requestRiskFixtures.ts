// Purpose: Snapshot / certificate / context builders and a `run` shortcut for the request-risk
// tests, so each rule test only states what differs between the previous and current snapshot.
// Dependencies: lib/requestRisk

import {
  assessRequest,
  type CaStatus,
  type CertInfo,
  type RiskContext,
  type RiskInput,
} from '../../lib/requestRisk';

export const NOW = new Date('2026-11-19T12:00:00Z');
export const DAY = 86400_000;
export const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();
export const ORG = 'ukm.de';
export const GEANT = 'C=NL,O=GEANT Vereniging,CN=GEANT TLS ECC 1';
export const R11 = "C=US,O=Let's Encrypt,CN=R11";

export interface CertSpec {
  id: string;
  cn?: string;
  days: number;
  issuer?: string;
  sans?: string[];
  /** Store issuer / subject / SAN / expiry in the snapshot entry (as buildSnapshot does). */
  embed?: boolean;
}

export function certRow(c: CertSpec) {
  const cn = c.cn ?? `dsf.${ORG}`;
  return {
    id: c.id,
    subject: cn,
    thumbprint: `T-${c.id}`,
    valid_until: inDays(c.days),
    ...(c.embed
      ? {
          issuerDn: c.issuer ?? GEANT,
          subjectDn: `C=DE,CN=${cn}`,
          sanDns: c.sans ?? [cn],
          notAfter: inDays(c.days),
        }
      : {}),
  };
}

export function infoFor(specs: CertSpec[]): Record<string, CertInfo> {
  const out: Record<string, CertInfo> = {};
  for (const c of specs) {
    const cn = c.cn ?? `dsf.${ORG}`;
    out[c.id] = {
      issuerDn: c.issuer ?? GEANT,
      subjectDn: `C=DE,CN=${cn}`,
      sanDns: c.sans ?? [cn],
      notAfter: inDays(c.days),
    };
  }
  return out;
}

export interface SnapSpec {
  name?: string;
  active?: boolean;
  certs?: CertSpec[];
  endpoints?: Array<{ id: string; address?: string; ips?: string[] }>;
  contacts?: Array<{ id: string; types?: string[]; validated?: boolean }>;
  memberships?: Array<{ parent: string; roles: string[] }>;
  digest?: string | null;
}

export function snap(s: SnapSpec = {}) {
  return {
    organization: { identifier: ORG, name: s.name ?? 'UKM', active: s.active ?? true },
    contacts: (s.contacts ?? [{ id: 'c1', types: ['DSF_ADMIN'], validated: true }]).map((c) => ({
      id: c.id,
      types: c.types ?? ['DSF_ADMIN'],
      email_validated: c.validated ?? true,
    })),
    endpoints: (s.endpoints ?? [{ id: `dsf.${ORG}`, ips: ['93.184.216.34'] }]).map((e) => ({
      identifier: e.id,
      address: e.address ?? `https://${e.id}/fhir`,
      ipAddresses: (e.ips ?? []).map((ip) => ({ ip })),
    })),
    certificates: (s.certs ?? [{ id: 'old', days: 300 }]).map(certRow),
    memberships: (s.memberships ?? [{ parent: 'num.de', roles: ['DIC'] }]).map((m) => ({
      parent_organization: m.parent,
      roles: m.roles,
    })),
    ...(s.digest === null ? {} : { editableDigest: s.digest ?? 'd1' }),
  };
}

export function ctx(over: Partial<RiskContext> = {}): RiskContext {
  return {
    rejectedLast30d: 0,
    withdrawnLast30d: 0,
    submitterIp: null,
    knownSubmitIps: [],
    otherOrgsByIp: {},
    now: NOW,
    ...over,
  };
}

export interface Case {
  current: SnapSpec;
  previous?: SnapSpec | null;
  caStatus?: Record<string, CaStatus>;
  context?: Partial<RiskContext>;
  extraInfo?: CertSpec[];
  /** Pass no database certificate facts (the rows are gone). */
  noDb?: boolean;
  previousResolvedAt?: Date | null;
  beforePrevious?: SnapSpec | null;
}

export function run(c: Case) {
  const prev = c.previous === undefined ? {} : c.previous;
  const curCerts = c.current.certs ?? [{ id: 'old', days: 300 }];
  const prevCerts = prev ? (prev.certs ?? [{ id: 'old', days: 300 }]) : [];
  const input: RiskInput = {
    current: snap(c.current),
    previous: prev === null ? null : snap(prev),
    previousResolvedAt: c.previousResolvedAt ?? null,
    beforePrevious: c.beforePrevious ? snap(c.beforePrevious) : null,
    certInfo: c.noDb ? {} : infoFor([...prevCerts, ...curCerts, ...(c.extraInfo ?? [])]),
    caStatus: c.caStatus ?? { [GEANT]: 'whitelisted', [R11]: 'whitelisted' },
    context: ctx(c.context),
  };
  return assessRequest(input);
}

export const codes = (r: ReturnType<typeof assessRequest>) => r.findings.map((f) => f.code);
