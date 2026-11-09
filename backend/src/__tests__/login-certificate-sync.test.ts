/**
 * login-certificate-sync.test.ts – Login certificates follow the approved allow
 * list: an approval enables the snapshot's thumbprints as login (an
 * admin-uploaded certificate only after two approvals from distinct sites), a later approval without a thumbprint removes
 * its APPROVAL entry but keeps onboarding entries, admin certificates and
 * thumbprints of another organization are skipped, withdrawals change
 * nothing. Uploading links a fingerprint-only entry, renewing keeps the old
 * login, and the daily cleanup removes certificates and login entries 30 days
 * after expiry.
 * Dependencies: db, approval.service, certificate.service, login-certificate-sync,
 *               cert-cleanup, auth.service, helpers/allowListSites
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { approveRequest } from '../services/approval.service';
import { createCertificate, renewCertificate } from '../services/certificate.service';
import { syncLoginCertificatesFromApproval } from '../services/login-certificate-sync.service';
import { runExpiredCertificateCleanup } from '../services/cert-cleanup.service';
import { resolveCertLogin } from '../services/auth.service';
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
  const org = `sync-${label}-${sfx}.example.de`;
  const email = `sync-${label}-${sfx}@example.de`;
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

async function insertCert(site: Site, pem: string, uploadedByAdmin: boolean, validUntil?: Date) {
  const id = uuidv4();
  await db('certificates').insert({
    id,
    organization_id: site.org,
    pem,
    subject: 'CN=test',
    thumbprint: uuidv4().replace(/-/g, ''),
    valid_until: validUntil ?? new Date('2035-01-01'),
    created_at: new Date(),
    uploaded_by: site.email,
    uploaded_by_admin: uploadedByAdmin ? 1 : 0,
  });
  return id;
}

async function approvedRequest(site: Site, thumbprints: string[], active = true): Promise<string> {
  const id = uuidv4();
  await db('approval_requests').insert({
    id,
    instance_id: site.instanceId,
    status: 'APPROVED',
    created_at: new Date(),
    submitted_at: new Date(),
    resolved_at: new Date(),
    resolved_by: 'test',
    snapshot_json: JSON.stringify({
      allowList: { version: 1, active, member: { identifier: site.org, thumbprints } },
    }),
  });
  return id;
}

async function sign(requestId: string, adminEmail: string): Promise<void> {
  await db('approval_signatures').insert({
    id: uuidv4(),
    approval_request_id: requestId,
    admin_email: adminEmail,
    admin_site: adminEmail.split('@')[1],
    decision: 'APPROVE',
    signed_at: new Date(),
  });
}

function entry(fingerprint: string) {
  return db('org_login_certificates').where({ fingerprint }).first();
}

describe('login certificates from the approved allow list', () => {
  it('enables every approved thumbprint, linked to its certificate', async () => {
    const site = await makeSite('a');
    const pem = makeCertPem(`dsf.${site.org}`);
    const fp = sha512FingerprintFromPem(pem);
    const certId = await insertCert(site, pem, false);

    const res = await syncLoginCertificatesFromApproval(await approvedRequest(site, [fp]));

    expect(res).toEqual({ added: [fp], removed: [] });
    const row = await entry(fp);
    expect(row).toMatchObject({
      organization_id: site.org,
      certificate_id: certId,
      source: 'APPROVAL',
    });
    expect(row.valid_until).not.toBeNull();
    expect(await resolveCertLogin(fp)).toMatchObject({ kind: 'org', instanceId: site.instanceId });
  });

  it('enables an admin-uploaded certificate after two approvals from distinct sites', async () => {
    const site = await makeSite('b');
    const pem = makeCertPem(`dsf.${site.org}`);
    const fp = sha512FingerprintFromPem(pem);
    await insertCert(site, pem, true);
    const id = await approvedRequest(site, [fp]);
    await sign(id, `a-${sfx}@site-one.example.de`);
    await sign(id, `b-${sfx}@site-two.example.de`);

    await syncLoginCertificatesFromApproval(id);

    expect(await entry(fp)).toMatchObject({ source: 'APPROVAL' });
  });

  it('skips an admin-uploaded certificate approved by one site and silent consent', async () => {
    const site = await makeSite('b2');
    const pem = makeCertPem(`dsf.${site.org}`);
    const fp = sha512FingerprintFromPem(pem);
    const clinicPem = makeCertPem(`clinic.${site.org}`);
    const clinicFp = sha512FingerprintFromPem(clinicPem);
    await insertCert(site, pem, true);
    await insertCert(site, clinicPem, false);
    const id = await approvedRequest(site, [fp, clinicFp]);
    await sign(id, `a-${sfx}@site-one.example.de`);
    await sign(id, `a2-${sfx}@site-one.example.de`);

    const res = await syncLoginCertificatesFromApproval(id);

    expect(res.added).toEqual([clinicFp]);
    expect(await entry(fp)).toBeUndefined();
  });

  it('removes an APPROVAL entry the next approval no longer lists, keeps onboarding entries', async () => {
    const site = await makeSite('c');
    const oldFp = sha512FingerprintFromPem(makeCertPem(`old.${site.org}`));
    const onbFp = sha512FingerprintFromPem(makeCertPem(`onb.${site.org}`));
    await db('org_login_certificates').insert({
      fingerprint: onbFp,
      organization_id: site.org,
      source: 'ONBOARDING',
      created_at: new Date(),
    });
    await syncLoginCertificatesFromApproval(await approvedRequest(site, [oldFp]));

    const newFp = sha512FingerprintFromPem(makeCertPem(`new.${site.org}`));
    const res = await syncLoginCertificatesFromApproval(await approvedRequest(site, [newFp]));

    expect(res).toEqual({ added: [newFp], removed: [oldFp] });
    expect(await entry(oldFp)).toBeUndefined();
    expect(await entry(onbFp)).toBeDefined();
  });

  it('skips admin certificates and thumbprints of another organization', async () => {
    const site = await makeSite('d');
    const other = await makeSite('e');
    const adminFp = sha512FingerprintFromPem(makeCertPem(`admin.${site.org}`));
    const foreignFp = sha512FingerprintFromPem(makeCertPem(`foreign.${other.org}`));
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: `admin-${sfx}@imi-test.example.de`,
      fingerprint: adminFp,
      created_at: new Date(),
      created_by: 'test',
    });
    await db('org_login_certificates').insert({
      fingerprint: foreignFp,
      organization_id: other.org,
      source: 'ADMIN',
      created_at: new Date(),
    });

    const res = await syncLoginCertificatesFromApproval(
      await approvedRequest(site, [adminFp, foreignFp]),
    );

    expect(res.added).toEqual([]);
    expect(await entry(adminFp)).toBeUndefined();
    expect(await entry(foreignFp)).toMatchObject({ organization_id: other.org });
  });

  it('leaves logins alone for a withdrawal', async () => {
    const site = await makeSite('f');
    const fp = sha512FingerprintFromPem(makeCertPem(`w.${site.org}`));
    expect(
      await syncLoginCertificatesFromApproval(await approvedRequest(site, [fp], false)),
    ).toEqual({
      added: [],
      removed: [],
    });
    expect(await entry(fp)).toBeUndefined();
  });

  it('syncs when two admins approve a pending request', async () => {
    const site = await makeSite('g');
    const pem = makeCertPem(`dsf.${site.org}`);
    const fp = sha512FingerprintFromPem(pem);
    await insertCert(site, pem, false);
    const id = await approvedRequest(site, [fp]);
    await db('approval_requests').where({ id }).update({ status: 'PENDING', resolved_at: null });

    await approveRequest(id, `a-${sfx}@site-one.example.de`, ip);
    expect(await entry(fp)).toBeUndefined();
    await approveRequest(id, `b-${sfx}@site-two.example.de`, ip);

    expect(await entry(fp)).toMatchObject({ source: 'APPROVAL', organization_id: site.org });
  });
});

describe('uploading and renewing certificates', () => {
  it('links an uploaded PEM to the fingerprint-only entry with the same thumbprint', async () => {
    const site = await makeSite('h');
    const pem = makeCertPem(`dsf.${site.org}`);
    const fp = sha512FingerprintFromPem(pem);
    await db('org_login_certificates').insert({
      fingerprint: fp,
      organization_id: site.org,
      source: 'ONBOARDING',
      created_at: new Date(),
    });

    const cert = await createCertificate(site.instanceId, pem, site.email, ip, false);

    const row = await entry(fp);
    expect(row.certificate_id).toBe(cert.id);
    expect(row.valid_until).not.toBeNull();
  });

  it('keeps the login of a renewed certificate as a fingerprint-only entry', async () => {
    const site = await makeSite('i');
    const pem = makeCertPem(`dsf.${site.org}`);
    const fp = sha512FingerprintFromPem(pem);
    const certId = await insertCert(site, pem, false);
    await syncLoginCertificatesFromApproval(await approvedRequest(site, [fp]));

    await renewCertificate(
      site.instanceId,
      certId,
      { pem: makeCertPem(`dsf2.${site.org}`) },
      site.email,
      ip,
      false,
    );

    const row = await entry(fp);
    expect(row).toMatchObject({ certificate_id: null, source: 'APPROVAL' });
    expect(row.valid_until).not.toBeNull();
  });
});

describe('expired certificate cleanup', () => {
  // The real date: a fixed future date would sweep other suites' (still valid)
  // certificates out of the shared test database.
  const now = new Date();
  const daysBefore = (d: number) => new Date(now.getTime() - d * 86400_000);

  it('removes certificates and login entries 30 days after expiry, keeps the rest', async () => {
    const site = await makeSite('j');
    const oldPem = makeCertPem(`old.${site.org}`);
    const freshPem = makeCertPem(`fresh.${site.org}`);
    const oldId = await insertCert(site, oldPem, false, daysBefore(31));
    const freshId = await insertCert(site, freshPem, false, daysBefore(29));
    const oldFp = sha512FingerprintFromPem(oldPem);
    await db('org_login_certificates').insert({
      fingerprint: oldFp,
      organization_id: site.org,
      certificate_id: oldId,
      source: 'APPROVAL',
      created_at: new Date(),
      valid_until: daysBefore(31),
    });
    const unlinkedFp = sha512FingerprintFromPem(makeCertPem(`unlinked.${site.org}`));
    const unknownFp = sha512FingerprintFromPem(makeCertPem(`unknown.${site.org}`));
    await db('org_login_certificates').insert([
      {
        fingerprint: unlinkedFp,
        organization_id: site.org,
        source: 'ONBOARDING',
        created_at: new Date(),
        valid_until: daysBefore(40),
      },
      {
        fingerprint: unknownFp,
        organization_id: site.org,
        source: 'ONBOARDING',
        created_at: new Date(),
      },
    ]);

    const res = await runExpiredCertificateCleanup(now);

    expect(res.certificates).toBeGreaterThanOrEqual(1);
    expect(await db('certificates').where({ id: oldId }).first()).toBeUndefined();
    expect(await db('certificates').where({ id: freshId }).first()).toBeDefined();
    expect(await entry(oldFp)).toBeUndefined();
    expect(await entry(unlinkedFp)).toBeUndefined();
    expect(await entry(unknownFp)).toBeDefined();
    const audit = await db('audit_logs')
      .where({ resource_type: 'CERTIFICATE', resource_id: oldId, operation: 'DELETE' })
      .first();
    expect(audit).toBeDefined();
  });
});
