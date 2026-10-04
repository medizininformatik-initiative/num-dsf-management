/**
 * seedCertificates.ts – Real, parseable X.509 certificates for the dev seed.
 * The portal parses every stored PEM (fingerprints in the certificates API,
 * thumbprints in the allow-list bundle), so a placeholder PEM breaks both.
 * DSF-issued certificates carry the subject DN of a CA on the DSF whitelist
 * (GEANT TLS RSA 1) as issuer, to show the DSF-CA badge; the others are
 * self-signed. Test data only: one throwaway key signs everything and is
 * never stored.
 * Dependencies: node-forge, crypto
 */
import crypto from 'crypto';
import forge from 'node-forge';

const GEANT_TLS_RSA_1: forge.pki.CertificateField[] = [
  { shortName: 'C', value: 'GR' },
  { shortName: 'O', value: 'Hellenic Academic and Research Institutions CA' },
  { shortName: 'CN', value: 'GEANT TLS RSA 1' },
];

let keys: forge.pki.rsa.KeyPair | null = null;
let serial = 0;

export interface SeedCertificate {
  pem: string;
  /** CN, as the upload parser stores it. */
  subject: string;
  /** SHA-256 of the DER, upper-case hex. */
  thumbprint: string;
  validUntil: string;
}

/** A certificate for `cn` expiring on `validUntil` (YYYY-MM-DD, may be in the past). */
export function seedCertificate(
  cn: string,
  validUntil: string,
  dsfIssued: boolean,
): SeedCertificate {
  keys ??= forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  // Leading 01 keeps the DER integer positive.
  cert.serialNumber = `01${(++serial).toString(16).padStart(4, '0')}`;
  const notAfter = new Date(`${validUntil}T12:00:00Z`);
  cert.validity.notAfter = notAfter;
  cert.validity.notBefore = new Date(notAfter.getTime() - 2 * 365 * 86400_000);
  const subject = [
    { shortName: 'C', value: 'DE' },
    { shortName: 'CN', value: cn },
  ];
  cert.setSubject(subject);
  cert.setIssuer(dsfIssued ? GEANT_TLS_RSA_1 : subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  const der = new crypto.X509Certificate(pem).raw;
  return {
    pem,
    subject: cn,
    thumbprint: crypto.createHash('sha256').update(der).digest('hex').toUpperCase(),
    validUntil,
  };
}
