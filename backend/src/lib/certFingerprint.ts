/**
 * certFingerprint.ts – SHA-512 certificate fingerprint helper, shared by the
 * mTLS client-cert login, the bulk import and the allow-list bundle so all of
 * them agree exactly on how a fingerprint is computed and normalized.
 * Dependencies: crypto (X509Certificate, SHA-512 digest).
 */
import crypto from 'crypto';

/**
 * Strip every non-hex character (colons, spaces, newlines from
 * `certtool`/`openssl` output) and lowercase, so fingerprints from different
 * tools compare equal.
 */
export function normalizeFingerprint(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

/** True iff `s` is exactly 128 lower-case hex characters (a SHA-512 digest). */
export function isValidSha512Fingerprint(s: string): boolean {
  return /^[0-9a-f]{128}$/.test(s);
}

/**
 * Private-key material in any common text format: PEM variants (PKCS#8,
 * PKCS#1, EC, DSA, ENCRYPTED, OPENSSH), PGP "PRIVATE KEY BLOCK", the SSH2
 * (RFC 4716 style) "ENCRYPTED PRIVATE KEY" and PuTTY .ppk files.
 * Case-insensitive and lenient on the separator between PRIVATE and KEY.
 */
export const PRIVATE_KEY_MARKER = /PRIVATE[\s_-]*KEY|PuTTY-User-Key-File/i;

/** @throws PRIVATE_KEY_REJECTED if the text carries private-key material. */
export function rejectPrivateKeyMaterial(text: string): void {
  if (PRIVATE_KEY_MARKER.test(text)) throw new Error('PRIVATE_KEY_REJECTED');
}

/**
 * Parse an X.509 PEM and compute the SHA-512 fingerprint of its DER, the value
 * DSF publishes as certificate thumbprint. node:crypto parses RSA, EC and EdDSA
 * certificates alike (node-forge only reads RSA keys) and hashes the DER
 * exactly as issued, like `openssl x509 -outform DER | openssl dgst -sha512`.
 * Rejects private keys before parsing; never logs the PEM.
 * @throws PRIVATE_KEY_REJECTED if the PEM carries a private key.
 */
export function sha512FingerprintFromPem(pem: string): string {
  rejectPrivateKeyMaterial(pem);
  const cert = new crypto.X509Certificate(pem);
  return crypto.createHash('sha512').update(cert.raw).digest('hex');
}
