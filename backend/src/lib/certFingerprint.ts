/**
 * certFingerprint.ts – SHA-512 certificate fingerprint helper, shared by the
 * mTLS client-cert login and the (future) bulk-import so both agree exactly
 * on how a fingerprint is computed and normalized.
 * Dependencies: node-forge (PEM → DER), crypto (SHA-512 digest).
 */
import crypto from 'crypto';
import forge from 'node-forge';

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

/** SHA-512 hex digest of a certificate's DER bytes (binary-encoded string). */
export function sha512FingerprintFromDer(derBinary: string): string {
  return crypto.createHash('sha512').update(Buffer.from(derBinary, 'binary')).digest('hex');
}

/**
 * Parse an X.509 PEM and compute the SHA-512 fingerprint of its DER.
 * Rejects private keys before parsing; never logs the PEM.
 * @throws PRIVATE_KEY_REJECTED if the PEM carries a private key.
 */
export function sha512FingerprintFromPem(pem: string): string {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) throw new Error('PRIVATE_KEY_REJECTED');
  const cert = forge.pki.certificateFromPem(pem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return sha512FingerprintFromDer(der);
}
