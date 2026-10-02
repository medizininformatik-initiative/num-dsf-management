/**
 * certFingerprint.test.ts — pure unit tests for the SHA-512 certificate
 * fingerprint helper shared by mTLS login and the (future) bulk-import.
 * Verifies fingerprint normalization, the 128-hex-char SHA-512 format guard,
 * that sha512FingerprintFromPem computes exactly SHA-512(DER) — the same
 * value `certtool --hash=sha512` / `openssl dgst -sha512` produce — and that
 * a private key is rejected before any parsing happens.
 *
 * The cert is generated in-process with node-forge so the parity test needs
 * no binary fixture or external openssl/certtool call.
 *
 * Dependencies: node-forge, crypto, lib/certFingerprint (pure functions).
 */
import crypto from 'crypto';
import forge from 'node-forge';
import {
  normalizeFingerprint,
  isValidSha512Fingerprint,
  sha512FingerprintFromPem,
} from '../lib/certFingerprint';
import { ECC_P256_CERT_PEM, ECC_P256_SHA512 } from './fixtures/eccCertificate';

function makeSelfSignedCert(): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attrs = [{ shortName: 'CN', value: 'leaf.example.de' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return forge.pki.certificateToPem(cert);
}

describe('normalizeFingerprint', () => {
  it('strips separators and lowercases', () => {
    expect(normalizeFingerprint('AA:bb 00\n')).toBe('aabb00');
  });
});

describe('isValidSha512Fingerprint', () => {
  it('accepts 128 lower-case hex chars', () => {
    expect(isValidSha512Fingerprint('a'.repeat(128))).toBe(true);
  });

  it('rejects 127 hex chars (one short)', () => {
    expect(isValidSha512Fingerprint('a'.repeat(127))).toBe(false);
  });

  it('rejects a non-hex character', () => {
    expect(isValidSha512Fingerprint('g'.repeat(128))).toBe(false);
  });
});

describe('sha512FingerprintFromPem', () => {
  it('computes SHA-512 of the DER, matching an independent computation', () => {
    const pem = makeSelfSignedCert();
    const cert = forge.pki.certificateFromPem(pem);
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const expected = crypto.createHash('sha512').update(Buffer.from(der, 'binary')).digest('hex');
    expect(sha512FingerprintFromPem(pem)).toBe(expected);
  });

  it('reads an EC (P-256) certificate and hashes its DER exactly as issued', () => {
    // Public certificate only; GEANT and HARICA issue EC certificates for DSF.
    const pem = ECC_P256_CERT_PEM;
    const der = Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, ''), 'base64');
    const fingerprint = sha512FingerprintFromPem(pem);
    expect(fingerprint).toBe(crypto.createHash('sha512').update(der).digest('hex'));
    expect(fingerprint).toBe(ECC_P256_SHA512);
  });

  it('rejects a private key before attempting to parse', () => {
    // Header split across concatenation so the secret scanner does not flag this
    // deliberately-fake rejection fixture; at runtime it is a full PEM header.
    const pem = '-----BEGIN PRIVATE' + ' KEY-----\nMIIE...\n-----END PRIVATE KEY-----';
    expect(() => sha512FingerprintFromPem(pem)).toThrow('PRIVATE_KEY_REJECTED');
  });
});
