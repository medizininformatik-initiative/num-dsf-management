/**
 * requestRiskSupport.ts – Helpers of the request-risk assessment: tolerant normalisation of an
 * approval snapshot, DN / domain / IP utilities. Pure, no I/O.
 * Dependencies: net (isIP)
 */
import { isIP } from 'net';

const DAY_MS = 86400_000;

export interface NCert {
  id: string;
  thumbprint: string;
  subject: string;
  validUntil: string | null;
}
export interface NEndpoint {
  identifier: string;
  host: string | null;
  ips: Set<string>;
}
export interface NContact {
  id: string;
  types: string[];
  emailValidated: boolean;
}
export interface NSnap {
  orgId: string;
  orgName: string | null;
  active: boolean | null;
  contacts: NContact[];
  endpoints: NEndpoint[];
  certs: NCert[];
  memberships: Map<string, Set<string>>;
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

function hostOf(address: string, fallback: string): string | null {
  try {
    return new URL(address).hostname.toLowerCase() || null;
  } catch {
    return fallback ? fallback.toLowerCase() : null;
  }
}

export function normalize(raw: unknown): NSnap {
  const s = parseSnapshotInput(raw);
  const org = rec(s.organization);
  const memberships = new Map<string, Set<string>>();
  for (const m of arr(s.memberships)) {
    const parent = str(rec(m).parent_organization);
    if (!parent) continue;
    const roles = memberships.get(parent) ?? new Set<string>();
    list(rec(m).roles).forEach((r) => roles.add(r));
    memberships.set(parent, roles);
  }
  return {
    orgId: str(org.identifier).toLowerCase(),
    orgName: typeof org.name === 'string' ? org.name : null,
    active: org.active === undefined || org.active === null ? null : !!org.active,
    contacts: arr(s.contacts).map((c) => ({
      id: str(rec(c).id),
      types: list(rec(c).types),
      emailValidated: !!rec(c).email_validated,
    })),
    endpoints: arr(s.endpoints).map((e) => {
      const identifier = str(rec(e).identifier);
      const ipList = arr(rec(e).ipAddresses ?? rec(e).ips).map((x) => str(rec(x).ip));
      return {
        identifier,
        host: hostOf(str(rec(e).address), identifier),
        ips: new Set(ipList.filter(Boolean)),
      };
    }),
    certs: arr(s.certificates).map((c) => ({
      id: str(rec(c).id),
      thumbprint: str(rec(c).thumbprint),
      subject: str(rec(c).subject),
      validUntil: typeof rec(c).valid_until === 'string' ? (rec(c).valid_until as string) : null,
    })),
    memberships,
    digest: typeof s.editableDigest === 'string' ? s.editableDigest : null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Same normalisation as ca-blacklist.service.normalizeDn (kept here to stay free of the DB). */
export function normDn(dn: string): string {
  return dn
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
}

/** Common name of a DN (`CN=` RDN), or the whole DN when it has none. */
export function commonName(dn: string): string {
  const m = /(?:^|,)\s*CN=([^,]*)/i.exec(dn);
  return (m ? m[1] : dn).trim();
}

/** Last two labels of a host; IP addresses and short names are returned unchanged. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase();
  if (isIP(h) !== 0) return h;
  const labels = h.split('.').filter(Boolean);
  return labels.length <= 2 ? h : labels.slice(-2).join('.');
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** RFC1918, loopback, link-local, CGNAT, 0.0.0.0/8, IPv6 ULA / link-local / loopback. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind !== 6) return false;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return privateV4(mapped[1]);
  if (lower === '::1' || lower === '::') return true;
  const first = parseInt(lower.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((t - now.getTime()) / DAY_MS);
}

export function nameMatches(name: string, domain: string): boolean {
  const n = name.toLowerCase().replace(/^\*\./, '');
  return n === domain || n.endsWith(`.${domain}`);
}
