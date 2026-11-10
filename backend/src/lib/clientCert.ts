/**
 * clientCert.ts – Pure helpers for client-certificate authentication.
 * Used by the mTLS-protected /fhir routes AND the /auth/client-cert-login
 * endpoint. FHIR still matches organizations by the SHA-256 `thumbprint`;
 * the human login matches by the SHA-512 `fingerprint` (lib/certFingerprint),
 * resolved against admins first, then organizations (auth.service.resolveCertLogin).
 */
import crypto from 'crypto';
import type { Request } from 'express';
import { sha512FingerprintFromPem } from './certFingerprint';

export interface ClientCertInfo {
  thumbprint: string;
  /**
   * SHA-512 fingerprint used by the human cert-login match. Null when the
   * presented bytes base64-decode but do not parse as a valid X.509
   * certificate (e.g. a private key, or malformed DER). The SHA-256
   * `thumbprint` above is a raw-byte hash with no such failure mode, so
   * FHIR's thumbprint match is unaffected by a null fingerprint here.
   */
  fingerprint: string | null;
  pem: string;
}

/**
 * Extract a client certificate from request headers (set by nginx via
 * $ssl_client_escaped_cert) and compute its SHA-256 thumbprint. Returns
 * null when no usable cert is present.
 *
 * The cert is only trusted when nginx's mTLS verification succeeded:
 * `X-Client-Verify` (from $ssl_client_verify) must be 'SUCCESS'. Without
 * this guard a caller could spoof `X-Client-Cert` with any thumbprint and
 * authenticate as the matching org. We check the verify result BEFORE doing
 * any thumbprint work so a forged/unverified cert never reaches a lookup.
 * A certificate outside its validity period is refused here as well (null).
 */
export function extractClientCert(req: Request): ClientCertInfo | null {
  const verify = req.headers['x-client-verify'];
  if (verify !== 'SUCCESS') return null;
  const raw = (req.headers['x-client-cert'] ?? req.headers['x-ssl-client-cert']) as
    | string
    | undefined;
  if (!raw) return null;
  let pem: string;
  try {
    pem = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!pem.includes('BEGIN CERTIFICATE')) return null;
  const der = Buffer.from(
    pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, ''),
    'base64',
  );
  if (der.length === 0) return null;
  const thumbprint = crypto.createHash('sha256').update(der).digest('hex');
  // The proxy uses optional_no_ca, which does not check the validity period:
  // a certificate that is expired or not yet valid is no client certificate.
  if (!withinValidity(pem)) return null;
  let fingerprint: string | null;
  try {
    fingerprint = sha512FingerprintFromPem(pem);
  } catch {
    fingerprint = null;
  }
  return { thumbprint, fingerprint, pem };
}

/** False when the certificate parses and now is outside notBefore..notAfter. */
function withinValidity(pem: string, now = Date.now()): boolean {
  let cert: crypto.X509Certificate;
  try {
    cert = new crypto.X509Certificate(pem);
  } catch {
    return true; // unparseable: fingerprint stays null, nothing logs in with it
  }
  return Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo);
}
