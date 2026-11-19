/**
 * certDescribe.ts – Facts of a stored certificate PEM that the request-risk assessment needs
 * (issuer DN, subject DN, DNS names, expiry). Pure; the PEM itself is never returned or logged.
 * Dependencies: node:crypto
 */
import crypto from 'crypto';

export interface CertDescription {
  issuerDn: string;
  subjectDn: string;
  sanDns: string[];
  /** ISO timestamp of the certificate's notAfter. */
  notAfter: string;
}

const MAX_SAN = 20;

/** Issuer, subject, DNS names and expiry of a PEM; null when it cannot be parsed. */
export function describeCertificate(pem: string): CertDescription | null {
  try {
    const cert = new crypto.X509Certificate(pem);
    const sanDns = (cert.subjectAltName ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('DNS:'))
      .map((part) => part.slice(4))
      .slice(0, MAX_SAN);
    return {
      issuerDn: cert.issuer.split('\n').join(','),
      subjectDn: cert.subject.split('\n').join(','),
      sanDns,
      notAfter: new Date(cert.validTo).toISOString(),
    };
  } catch {
    return null;
  }
}
