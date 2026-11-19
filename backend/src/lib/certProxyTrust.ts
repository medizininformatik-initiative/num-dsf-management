/**
 * certProxyTrust.ts – Proves that X-Client-* headers come from our front proxy.
 * The backend trusts X-Client-Verify / X-Client-Cert, so anything that can reach
 * its port directly could impersonate a site or admin with just a public cert.
 * With CLIENT_CERT_PROXY_SECRET set, the proxy must also send it as X-Proxy-Auth;
 * with CLIENT_CERT_TRUSTED_PROXIES set, the TCP peer must be in that list
 * (X-Forwarded-For is deliberately not consulted). Both are read per call.
 * Dependencies: crypto, net, lib/authMode
 */
import crypto from 'crypto';
import net from 'net';
import type { Request } from 'express';
import { isCertAuthMode } from './authMode';

export const MIN_PROXY_SECRET_LENGTH = 32;

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

function secretMatches(req: Request, secret: string): boolean {
  const presented = req.headers['x-proxy-auth'];
  if (typeof presented !== 'string') return false;
  // Hash both sides so the comparison is fixed-length and never throws.
  return crypto.timingSafeEqual(sha256(presented), sha256(secret));
}

function normaliseAddress(addr: string): string {
  return addr.toLowerCase().startsWith('::ffff:') ? addr.slice(7) : addr;
}

function familyOf(addr: string): 'ipv4' | 'ipv6' | null {
  if (net.isIPv4(addr)) return 'ipv4';
  if (net.isIPv6(addr)) return 'ipv6';
  return null;
}

let cachedList: { raw: string; block: net.BlockList } | null = null;

/** BlockList for a CLIENT_CERT_TRUSTED_PROXIES value, rebuilt only when it changes. */
function blockListFor(raw: string): net.BlockList {
  if (cachedList?.raw === raw) return cachedList.block;
  const block = new net.BlockList();
  for (const entry of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [rawIp, prefix, ...rest] = entry.split('/');
    const ip = normaliseAddress(rawIp);
    const entryFamily = familyOf(ip);
    if (!entryFamily || rest.length > 0) continue; // malformed: never widens trust
    try {
      if (prefix === undefined) {
        block.addAddress(ip, entryFamily);
      } else {
        // Digits only: Number('') is 0 and Number('1e1') is 10, both would misread.
        if (!/^\d{1,3}$/.test(prefix)) continue;
        const bits = Number(prefix);
        if (bits > (entryFamily === 'ipv4' ? 32 : 128)) continue;
        block.addSubnet(ip, bits, entryFamily);
      }
    } catch {
      // invalid entry: skip it
    }
  }
  cachedList = { raw, block };
  return block;
}

function peerTrusted(req: Request, list: string): boolean {
  const raw = req.socket?.remoteAddress;
  if (!raw) return false;
  const addr = normaliseAddress(raw);
  const family = familyOf(addr);
  if (!family) return false;
  return blockListFor(list).check(addr, family);
}

function proxySecret(): string {
  return (process.env.CLIENT_CERT_PROXY_SECRET ?? '').trim();
}

function isDevOrTest(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

/**
 * True when the request may be treated as coming from the configured proxy.
 * Outside development/test (an unset NODE_ENV counts as production) a missing
 * secret turns client-certificate features off instead of trusting everyone.
 */
export function isFromTrustedProxy(req: Request): boolean {
  const secret = proxySecret();
  if (!secret && !isDevOrTest()) return false;
  if (secret && !secretMatches(req, secret)) return false;
  const proxies = process.env.CLIENT_CERT_TRUSTED_PROXIES;
  if (proxies && !peerTrusted(req, proxies)) return false;
  return true;
}

/**
 * Startup guard: cert mode in production must not run without the proxy secret.
 * Throws an Error whose message never contains the secret itself.
 */
export function assertCertProxyConfig(): void {
  if (!isCertAuthMode() || process.env.NODE_ENV !== 'production') return;
  const secret = proxySecret();
  if (secret.length < MIN_PROXY_SECRET_LENGTH) {
    throw new Error(
      `AUTH_MODE=cert in production requires CLIENT_CERT_PROXY_SECRET of at least ${MIN_PROXY_SECRET_LENGTH} characters ` +
        '(generate with: openssl rand -hex 32) and the proxy must send it as X-Proxy-Auth',
    );
  }
}

/**
 * One startup warning when client-certificate features are off for lack of a
 * secret (not cert mode, which refuses to start instead). Never logs the secret.
 */
export function warnIfProxySecretMissing(log: { warn: (msg: string) => void }): void {
  if (isDevOrTest() || isCertAuthMode() || proxySecret()) return;
  log.warn(
    'CLIENT_CERT_PROXY_SECRET is not set: client-certificate login and FHIR access are disabled until it is configured',
  );
}
