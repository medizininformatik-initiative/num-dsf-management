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

function peerTrusted(req: Request, list: string): boolean {
  const raw = req.socket?.remoteAddress;
  if (!raw) return false;
  const addr = normaliseAddress(raw);
  const family = familyOf(addr);
  if (!family) return false;
  const block = new net.BlockList();
  for (const entry of list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [rawIp, prefix] = entry.split('/');
    const ip = normaliseAddress(rawIp);
    const entryFamily = familyOf(ip);
    if (!entryFamily) continue; // a malformed entry never widens trust
    try {
      if (prefix !== undefined) block.addSubnet(ip, Number(prefix), entryFamily);
      else block.addAddress(ip, entryFamily);
    } catch {
      // invalid prefix: skip the entry
    }
  }
  return block.check(addr, family);
}

/** True when the request may be treated as coming from the configured proxy. */
export function isFromTrustedProxy(req: Request): boolean {
  const secret = process.env.CLIENT_CERT_PROXY_SECRET;
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
  const secret = process.env.CLIENT_CERT_PROXY_SECRET ?? '';
  if (secret.length < MIN_PROXY_SECRET_LENGTH) {
    throw new Error(
      `AUTH_MODE=cert in production requires CLIENT_CERT_PROXY_SECRET of at least ${MIN_PROXY_SECRET_LENGTH} characters ` +
        '(generate with: openssl rand -hex 32) and the proxy must send it as X-Proxy-Auth',
    );
  }
}
