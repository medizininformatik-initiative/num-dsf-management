/**
 * requestRiskNet.ts – Network helpers of the request-risk assessment: IP normalisation (IPv6
 * canonical form, IPv4-mapped to IPv4) and special-purpose range classification, host
 * normalisation, registrable domains (last two labels, three under a short list of common
 * second-level public suffixes) and endpoint address parsing. Pure, no dependencies.
 */

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

type V4Octets = [number, number, number, number];

function parseV4(s: string): V4Octets | null {
  const m = V4.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? [o[0], o[1], o[2], o[3]] : null;
}

/** Eight 16-bit groups of an IPv6 address (zone id and embedded IPv4 handled), or null. */
function parseV6(input: string): number[] | null {
  let s = input.split('%')[0].toLowerCase();
  if (!s.includes(':')) return null;
  const cut = s.lastIndexOf(':') + 1;
  if (s.slice(cut).includes('.')) {
    const v4 = parseV4(s.slice(cut));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, cut)}${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === '' ? [] : part.split(':'));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const fill = Array<string>(halves.length === 2 ? missing : 0).fill('0');
  const nums = [...head, ...fill, ...rest].map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

function v4FromGroups(hi: number, lo: number): V4Octets {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

/** Canonical text of an IP address (IPv6 compressed, IPv4-mapped as IPv4); null if not an IP. */
export function normalizeIp(ip: string): string | null {
  const text = ip.trim();
  const v4 = parseV4(text);
  if (v4) return v4.join('.');
  const g = parseV6(text);
  if (!g) return null;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return v4FromGroups(g[6], g[7]).join('.');
  }
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = g.map((n) => n.toString(16));
  if (bestLen < 2) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}

function privateV4([a, b, c]: V4Octets): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast 224/4 and reserved 240/4 including 255.255.255.255
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/**
 * Special-purpose addresses that are never a public DSF endpoint: RFC1918, loopback, link-local,
 * CGNAT, 0.0.0.0/8, documentation and benchmarking ranges, multicast and reserved IPv4; IPv6
 * loopback, unspecified, ULA, link-local, site-local, multicast, and IPv4-mapped / NAT64
 * (64:ff9b::/96) addresses whose embedded IPv4 is private.
 */
export function isPrivateIp(ip: string): boolean {
  const canonical = normalizeIp(ip);
  if (!canonical) return false;
  const v4 = parseV4(canonical);
  if (v4) return privateV4(v4);
  const g = parseV6(canonical);
  if (!g) return false;
  if (g.slice(0, 7).every((n) => n === 0) && g[7] <= 1) return true; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // fe80::/10, fec0::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) {
    return privateV4(v4FromGroups(g[6], g[7]));
  }
  return false;
}

/** Lower-case host without brackets or trailing dots. */
export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.+$/, '');
}

// Common second-level public suffixes; a host under one of them is registered one label deeper.
const SECOND_LEVEL_SUFFIXES = new Set(
  (
    'co.uk ac.uk gov.uk org.uk me.uk ltd.uk plc.uk nhs.uk sch.uk net.uk ' +
    'ac.at gv.at co.at or.at com.au net.au org.au edu.au gov.au co.nz ac.nz govt.nz org.nz ' +
    'co.jp ac.jp go.jp or.jp ne.jp com.br gov.br edu.br org.br net.br co.za ac.za gov.za org.za ' +
    'com.cn edu.cn gov.cn org.cn net.cn com.tr edu.tr gov.tr org.tr co.il ac.il gov.il org.il ' +
    'co.in ac.in gov.in nic.in org.in com.mx gob.mx edu.mx org.mx co.kr ac.kr go.kr or.kr ' +
    'com.sg edu.sg gov.sg com.hk edu.hk gov.hk co.id ac.id go.id com.pl edu.pl gov.pl'
  ).split(' '),
);

/**
 * Registrable domain of a host: last two labels, or last three under a known second-level
 * suffix (`dsf.evil.ac.uk` -> `evil.ac.uk`). There is no full public-suffix list, so rare
 * suffixes are treated as plain two-label domains. IP addresses are returned unchanged.
 */
export function registrableDomain(host: string): string {
  const h = normalizeHost(host);
  const ip = normalizeIp(h);
  if (ip) return ip;
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join('.');
  return SECOND_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

export interface EndpointAddress {
  readable: boolean;
  scheme: string;
  host: string;
  port: number;
  path: string;
}

/** Parse an endpoint address into comparable parts; only http(s) URLs with a host are readable. */
export function parseEndpointAddress(address: string): EndpointAddress {
  const unreadable: EndpointAddress = { readable: false, scheme: '', host: '', port: 0, path: '' };
  try {
    const url = new URL(address);
    const scheme = url.protocol.replace(':', '');
    if ((scheme !== 'http' && scheme !== 'https') || !url.hostname) return unreadable;
    return {
      readable: true,
      scheme,
      host: normalizeHost(url.hostname),
      port: url.port ? Number(url.port) : scheme === 'https' ? 443 : 80,
      path: url.pathname.replace(/\/+$/, ''),
    };
  } catch {
    return unreadable;
  }
}
