/**
 * certDescribe.test.ts – issuer, subject, SAN and expiry are read from a PEM; garbage gives null.
 * Dependencies: lib/certDescribe, node-forge
 */
import forge from 'node-forge';
import { describeCertificate } from '../lib/certDescribe';

function pem(opts: { cn: string; issuerCn: string; sans?: string[]; years: number }): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2024-01-01T00:00:00Z');
  cert.validity.notAfter = new Date(`${2024 + opts.years}-01-01T00:00:00Z`);
  cert.setSubject([{ shortName: 'CN', value: opts.cn }]);
  cert.setIssuer([{ shortName: 'CN', value: opts.issuerCn }]);
  if (opts.sans) {
    cert.setExtensions([
      { name: 'subjectAltName', altNames: opts.sans.map((value) => ({ type: 2, value })) },
    ]);
  }
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe('describeCertificate', () => {
  it('returns issuer, subject, DNS names and expiry', () => {
    const d = describeCertificate(
      pem({ cn: 'dsf.ukm.de', issuerCn: 'Test CA', sans: ['dsf.ukm.de', 'fhir.ukm.de'], years: 3 }),
    );
    expect(d).toEqual({
      issuerDn: 'CN=Test CA',
      subjectDn: 'CN=dsf.ukm.de',
      sanDns: ['dsf.ukm.de', 'fhir.ukm.de'],
      notAfter: '2027-01-01T00:00:00.000Z',
    });
  });

  it('returns an empty SAN list without the extension and null for garbage', () => {
    expect(describeCertificate(pem({ cn: 'a.de', issuerCn: 'CA', years: 1 }))?.sanDns).toEqual([]);
    expect(describeCertificate('not a certificate')).toBeNull();
  });
});
