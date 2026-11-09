/**
 * certificate-uniqueness.test.ts – A certificate belongs to one organization:
 * uploading or renewing to a PEM that another organization already registered
 * (certificate thumbprint or login fingerprint) is refused with
 * CERT_REGISTERED_ELSEWHERE; the same organization may still re-upload it.
 * Dependencies: db, certificate.service, lib/certFingerprint, helpers/allowListSites
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { createCertificate, renewCertificate } from '../services/certificate.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { makeCertPem } from './helpers/allowListSites';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ip = '127.0.0.1';

interface Site {
  instanceId: string;
  org: string;
  email: string;
}

async function makeSite(label: string): Promise<Site> {
  const userId = uuidv4();
  const instanceId = uuidv4();
  const org = `uniq-${label}-${sfx}.example.de`;
  const email = `uniq-${label}-${sfx}@example.de`;
  await db('users').insert({ id: userId, email, totp_enabled: true, created_at: new Date() });
  await db('instances').insert({
    id: instanceId,
    user_id: userId,
    label: org,
    created_at: new Date(),
  });
  await db('organizations').insert({
    identifier: org,
    instance_id: instanceId,
    name: org,
    email,
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return { instanceId, org, email };
}

describe('certificate uniqueness across organizations', () => {
  it('refuses to upload a certificate another organization registered', async () => {
    const a = await makeSite('a');
    const b = await makeSite('b');
    const pem = makeCertPem(`dsf.${a.org}`);
    await createCertificate(a.instanceId, pem, a.email, ip, false);

    await expect(createCertificate(b.instanceId, pem, b.email, ip, false)).rejects.toThrow(
      'CERT_REGISTERED_ELSEWHERE',
    );
    expect(await db('certificates').where({ organization_id: b.org }).count('* as n')).toEqual([
      { n: 0 },
    ]);
  });

  it('refuses a certificate whose fingerprint logs in for another organization', async () => {
    const a = await makeSite('c');
    const b = await makeSite('d');
    const pem = makeCertPem(`dsf.${a.org}`);
    await db('org_login_certificates').insert({
      fingerprint: sha512FingerprintFromPem(pem),
      organization_id: a.org,
      source: 'ONBOARDING',
      created_at: new Date(),
    });

    await expect(createCertificate(b.instanceId, pem, b.email, ip, false)).rejects.toThrow(
      'CERT_REGISTERED_ELSEWHERE',
    );
  });

  it('refuses to renew to a certificate another organization registered', async () => {
    const a = await makeSite('e');
    const b = await makeSite('f');
    const pemA = makeCertPem(`dsf.${a.org}`);
    await createCertificate(a.instanceId, pemA, a.email, ip, false);
    const old = await createCertificate(
      b.instanceId,
      makeCertPem(`dsf.${b.org}`),
      b.email,
      ip,
      false,
    );

    await expect(
      renewCertificate(b.instanceId, old.id, { pem: pemA }, b.email, ip, false),
    ).rejects.toThrow('CERT_REGISTERED_ELSEWHERE');
    expect(await db('certificates').where({ id: old.id }).first()).toBeDefined();
  });

  it('lets the same organization upload its certificate again', async () => {
    const a = await makeSite('g');
    const pem = makeCertPem(`dsf.${a.org}`);
    await createCertificate(a.instanceId, pem, a.email, ip, false);

    await expect(createCertificate(a.instanceId, pem, a.email, ip, false)).resolves.toBeDefined();
  });
});
