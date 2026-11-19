/**
 * requestRiskSupport.ts – Helpers of the request-risk assessment: tolerant normalisation of an
 * approval snapshot (certificates keep the issuer facts stored with the snapshot, endpoint
 * addresses are parsed, IPs are normalised) and DN utilities that respect escaped commas. Pure,
 * no I/O.
 * Dependencies: lib/requestRiskNet
 */
import { normalizeIp, parseEndpointAddress, type EndpointAddress } from './requestRiskNet';

const DAY_MS = 86400_000;

export interface NCert {
  id: string;
  thumbprint: string;
  /** CN as stored in the certificates table. */
  subject: string;
  validUntil: string | null;
  /** Facts stored with the snapshot since certDescribe; absent in older snapshots. */
  issuerDn?: string;
  subjectDn?: string;
  sanDns?: string[];
  notAfter?: string;
  /** Published in the allow list (migration 040); snapshots without the flag count as true. */
  publish: boolean;
  /** May log in as the organization once approved (migration 040); absent counts as true. */
  login: boolean;
}
export interface NEndpoint {
  identifier: string;
  /** Raw address as stored. */
  address: string;
  parsed: EndpointAddress;
  ips: Set<string>;
}
export interface NContact {
  id: string;
  types: string[];
  emailValidated: boolean;
}
export interface NMembership {
  /** Parent identifier as written in the snapshot (compared case-insensitively). */
  parent: string;
  roles: Set<string>;
}
export interface NSnap {
  /** False when the snapshot has no organization identifier (unreadable or empty). */
  readable: boolean;
  orgId: string;
  orgName: string | null;
  active: boolean | null;
  contacts: NContact[];
  endpoints: NEndpoint[];
  certs: NCert[];
  /** Keyed by the lower-cased parent identifier. */
  memberships: Map<string, NMembership>;
  digest: string | null;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}
/** A JSON column that may arrive as an array or as its JSON text. */
function list(v: unknown): string[] {
  let value = v;
  if (typeof v === 'string') {
    try {
      value = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return arr(value).filter((x): x is string => typeof x === 'string');
}
function parseSnapshotInput(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return rec(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return rec(raw);
}

export function normalize(raw: unknown): NSnap {
  const s = parseSnapshotInput(raw);
  const org = rec(s.organization);
  const memberships = new Map<string, NMembership>();
  for (const m of arr(s.memberships)) {
    const parent = str(rec(m).parent_organization).trim();
    if (!parent) continue;
    const entry = memberships.get(parent.toLowerCase()) ?? { parent, roles: new Set<string>() };
    list(rec(m).roles).forEach((r) => entry.roles.add(r));
    memberships.set(parent.toLowerCase(), entry);
  }
  const orgId = str(org.identifier).toLowerCase();
  return {
    readable: orgId !== '',
    orgId,
    orgName: typeof org.name === 'string' ? org.name : null,
    active: org.active === undefined || org.active === null ? null : !!org.active,
    contacts: arr(s.contacts).map((c) => ({
      id: str(rec(c).id),
      types: list(rec(c).types),
      emailValidated: !!rec(c).email_validated,
    })),
    endpoints: arr(s.endpoints).map((e) => {
      const address = str(rec(e).address);
      const ipList = arr(rec(e).ipAddresses ?? rec(e).ips).map((x) => str(rec(x).ip));
      const ips = ipList.filter(Boolean).map((ip) => normalizeIp(ip) ?? ip.toLowerCase());
      return {
        identifier: str(rec(e).identifier),
        address,
        parsed: parseEndpointAddress(address),
        ips: new Set(ips),
      };
    }),
    certs: arr(s.certificates).map((c) => {
      const r = rec(c);
      return {
        id: str(r.id),
        thumbprint: str(r.thumbprint),
        subject: str(r.subject),
        validUntil: typeof r.valid_until === 'string' ? r.valid_until : null,
        issuerDn: optStr(r.issuerDn),
        subjectDn: optStr(r.subjectDn),
        sanDns: Array.isArray(r.sanDns) ? list(r.sanDns) : undefined,
        notAfter: optStr(r.notAfter),
        publish: r.publish_in_allowlist !== false && r.publish_in_allowlist !== 0,
        login: r.use_for_login !== false && r.use_for_login !== 0,
      };
    }),
    memberships,
    digest: typeof s.editableDigest === 'string' ? s.editableDigest : null,
  };
}

// ── DN helpers ────────────────────────────────────────────────────────────────

/** RDNs of a DN, split on commas that are neither escaped (`\,`) nor inside double quotes. */
export function splitDn(dn: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < dn.length; i++) {
    const ch = dn[i];
    if (ch === '\\' && i + 1 < dn.length) {
      current += ch + dn[++i];
    } else if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (ch === ',' && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function unescapeDnValue(value: string): string {
  const trimmed =
    value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  return trimmed.replace(/\\(.)/g, '$1').trim();
}

/** Order- and case-insensitive form of a DN, for comparing two certificate DNs. */
export function normDn(dn: string): string {
  return splitDn(dn)
    .map((p) => p.toLowerCase())
    .sort()
    .join(',');
}

/** Common name of a DN (`CN=` RDN, escapes resolved), or the whole DN when it has none. */
export function commonName(dn: string): string {
  const rdn = splitDn(dn).find((p) => /^cn=/i.test(p));
  return rdn ? unescapeDnValue(rdn.slice(3)) : dn.trim();
}

export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((t - now.getTime()) / DAY_MS);
}

export function nameMatches(name: string, domain: string): boolean {
  const n = name.toLowerCase().replace(/^\*\./, '').replace(/\.+$/, '');
  return n === domain || n.endsWith(`.${domain}`);
}
