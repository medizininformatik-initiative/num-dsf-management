/**
 * certificate-pem-strict.test.ts – An uploaded certificate must be exactly one
 * CERTIFICATE block and nothing else. Private keys in any common format (PEM
 * variants, PGP, PuTTY, SSH2) are refused, so is anything appended to the
 * certificate or a second certificate (a chain file would otherwise register
 * its first block, possibly the CA). A CA certificate is no DSF site or login
 * certificate and is refused. What is stored is the canonical PEM of the
 * parsed certificate, never the raw upload.
 * Dependencies: lib/certFingerprint, certificate.service, admin-certificates.service,
 *               node-forge, helpers/allowListSites
 */
import crypto from 'crypto';
import forge from 'node-forge';
import { db } from '../db/connection';
import { canonicalCertificatePem, sha512FingerprintFromPem } from '../lib/certFingerprint';
import { createCertificate, rejectPrivateKey } from '../services/certificate.service';
import { parseAdminCert } from '../services/admin-certificates.service';
import { makeCertPem, removeSites, seedSite, type Site } from './helpers/allowListSites';

function makeCaPem(cn: string): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date('2024-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2035-01-01T00:00:00Z');
  const attrs = [{ shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

const leaf = makeCertPem('strict-leaf.example.de');
const body = leaf.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, '');
const keyBody = crypto.randomBytes(600).toString('base64');

describe('private-key formats', () => {
  it.each([
    '-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF...\n-----END PGP PRIVATE KEY BLOCK-----',
    'PuTTY-User-Key-File-3: ssh-rsa\nEncryption: none\nPrivate-Lines: 14\nAAAA',
    '---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\nP2/56wAAA\n---- END SSH2 ENCRYPTED PRIVATE KEY ----',
  ])('rejectPrivateKey and the fingerprint helper refuse %p', (text) => {
    expect(() => rejectPrivateKey(`${leaf}\n${text}`)).toThrow('PRIVATE_KEY_REJECTED');
    expect(() => sha512FingerprintFromPem(`${leaf}\n${text}`)).toThrow('PRIVATE_KEY_REJECTED');
  });
});

describe('canonicalCertificatePem', () => {
  it('returns the canonical PEM of a single certificate, whatever its formatting', () => {
    const messy = `\r\n  -----BEGIN CERTIFICATE-----\r\n${body}\r\n-----END CERTIFICATE-----\r\n\r\n`;
    const canonical = canonicalCertificatePem(messy);
    expect(canonical).toBe(new crypto.X509Certificate(leaf).toString());
    expect(sha512FingerprintFromPem(canonical)).toBe(sha512FingerprintFromPem(leaf));
  });

  it.each([
    ['a bare base64 key body after the certificate', `${leaf}\n${keyBody}\n`],
    ['base64 appended inside the block', leaf.replace('-----END', `${keyBody}\n-----END`)],
    ['a second certificate (chain file)', `${leaf}${makeCertPem('second.example.de')}`],
    ['text before the certificate', `subject=CN=x\n${leaf}`],
  ])('refuses %s', (_label, input) => {
    expect(() => canonicalCertificatePem(input)).toThrow(/INVALID_PEM|PRIVATE_KEY_REJECTED/);
  });
});

describe('uploads', () => {
  let site: Site;

  beforeAll(async () => {
    site = await seedSite({ label: 'pem-strict', certificate: false, approval: null });
  });

  afterAll(async () => {
    await db('audit_logs').where({ instance_id: site.instanceId }).del();
    await removeSites([site]);
  });

  it('stores the canonical PEM, not the raw upload', async () => {
    const pem = makeCertPem(`dsf-client.${site.orgId}`);
    const raw = `\n${pem.replace(/\n/g, '\r\n')}\n\n`;
    const cert = await createCertificate(site.instanceId, raw, site.email, '127.0.0.1', false);
    const row = await db('certificates').where({ id: cert.id }).first();
    expect(row.pem).toBe(new crypto.X509Certificate(pem).toString());
  });

  it('refuses a chain file instead of registering its first block', async () => {
    const chain = `${makeCertPem(`a.${site.orgId}`)}${makeCaPem('chain-ca.example.de')}`;
    await expect(
      createCertificate(site.instanceId, chain, site.email, '127.0.0.1', false),
    ).rejects.toThrow('INVALID_PEM');
  });

  it('refuses a CA certificate as site certificate and as admin certificate', async () => {
    const ca = makeCaPem('site-ca.example.de');
    await expect(
      createCertificate(site.instanceId, ca, site.email, '127.0.0.1', false),
    ).rejects.toThrow('CA_CERTIFICATE_REJECTED');
    expect(() => parseAdminCert(ca)).toThrow('CA_CERTIFICATE_REJECTED');
  });
});
