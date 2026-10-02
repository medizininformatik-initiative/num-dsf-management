/**
 * certificate-ca-whitelist.test.ts – Certificates carry their issuer and
 * whether it is a CA DSF accepts in production (ca_whitelist); uploads from
 * other issuers are only refused when CA_WHITELIST_ENFORCE=true.
 *
 * The "DSF-issued" leaf comes from an in-test CA that merely carries the
 * subject DN of a whitelisted CA: the portal matches issuers by name (the DSF
 * proxies verify the chain), which is exactly what this test pins.
 * Dependencies: node-forge, certificate.service, helpers/allowListSites
 */
import forge from 'node-forge';
import { createCertificate, getCertificates } from '../services/certificate.service';
import { makeCertPem, removeSites, seedSite, type Site } from './helpers/allowListSites';

function leafIssuedBy(issuer: forge.pki.CertificateField[], cn: string): string {
  const caKeys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const leafKeys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = leafKeys.publicKey;
  leaf.serialNumber = '0a';
  leaf.validity.notBefore = new Date('2024-01-01T00:00:00Z');
  leaf.validity.notAfter = new Date('2035-01-01T00:00:00Z');
  leaf.setSubject([
    { shortName: 'C', value: 'DE' },
    { shortName: 'CN', value: cn },
  ]);
  leaf.setIssuer(issuer);
  leaf.sign(caKeys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(leaf);
}

const GEANT_TLS_RSA_ISSUER: forge.pki.CertificateField[] = [
  { shortName: 'C', value: 'GR' },
  { shortName: 'O', value: 'Hellenic Academic and Research Institutions CA' },
  { shortName: 'CN', value: 'GEANT TLS RSA 1' },
];

describe('certificates and the CA whitelist', () => {
  let site: Site;
  const enforce = process.env.CA_WHITELIST_ENFORCE;

  beforeAll(async () => {
    site = await seedSite({ label: 'cawl', certificate: false });
  });

  afterAll(async () => {
    await removeSites([site]);
  });

  afterEach(() => {
    if (enforce === undefined) delete process.env.CA_WHITELIST_ENFORCE;
    else process.env.CA_WHITELIST_ENFORCE = enforce;
  });

  it('flags a self-signed certificate as not issued by a DSF CA, without refusing it', async () => {
    delete process.env.CA_WHITELIST_ENFORCE;
    const cert = await createCertificate(
      site.instanceId,
      makeCertPem(`self.${site.orgId}`),
      site.email,
      '127.0.0.1',
    );
    expect(cert.issuerTrusted).toBe(false);
    expect(cert.issuerDn).toBe(`CN=self.${site.orgId}`);
    expect(cert).not.toHaveProperty('pem');
  });

  it('marks a certificate issued by a whitelisted CA as trusted', async () => {
    const cert = await createCertificate(
      site.instanceId,
      leafIssuedBy(GEANT_TLS_RSA_ISSUER, `dsf.${site.orgId}`),
      site.email,
      '127.0.0.1',
    );
    expect(cert.issuerTrusted).toBe(true);
    expect(cert.issuerDn).toBe(
      'C=GR,O=Hellenic Academic and Research Institutions CA,CN=GEANT TLS RSA 1',
    );
    const listed = await getCertificates(site.instanceId);
    expect(listed.map((c) => c.issuerTrusted).sort()).toEqual([false, true]);
  });

  it('refuses other issuers when CA_WHITELIST_ENFORCE=true', async () => {
    process.env.CA_WHITELIST_ENFORCE = 'true';
    await expect(
      createCertificate(
        site.instanceId,
        makeCertPem(`blocked.${site.orgId}`),
        site.email,
        '127.0.0.1',
      ),
    ).rejects.toThrow('CA_NOT_WHITELISTED');
    const accepted = await createCertificate(
      site.instanceId,
      leafIssuedBy(GEANT_TLS_RSA_ISSUER, `dsf2.${site.orgId}`),
      site.email,
      '127.0.0.1',
    );
    expect(accepted.issuerTrusted).toBe(true);
  });
});
