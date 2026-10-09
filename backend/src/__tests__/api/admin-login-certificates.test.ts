/**
 * admin-login-certificates.test.ts – Admin API that decides which certificates
 * of an organization may log in as that organization (the "Login" flag):
 * enable (SHA-512 computed server-side), refuse admin certificates and
 * certificates of another organization, delete (also fingerprint-only
 * entries), non-admin 403, missing step-up refused, audit written; plus the
 * read-only per-instance view and the onboarding import writing its entry.
 * Dependencies: supertest, app, db, helpers/allowListSites, onboarding.service
 */
jest.mock('../../services/totp.service', () => ({
  ...jest.requireActual('../../services/totp.service'),
  verifyTotpCode: jest.fn().mockResolvedValue(true),
}));

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';
import { signGrant } from '../../lib/adminGrants';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { makeCertPem } from '../helpers/allowListSites';
import { importSites, onboardingRowSchema } from '../../services/onboarding.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `lc-admin-${sfx}@imi-test.example.de`;
const adminId = uuidv4();
const siteEmail = `lc-site-${sfx}@example.de`;
const siteUserId = uuidv4();
const instA = uuidv4();
const instB = uuidv4();
const orgA = `lc-a-${sfx}.example.de`;
const orgB = `lc-b-${sfx}.example.de`;
const certPemA = makeCertPem(`dsf.${orgA}`);
const certPemB = makeCertPem(`dsf.${orgB}`);
const adminCertPem = makeCertPem(`admin-cert.${sfx}`);
const certIdA = uuidv4();
const certIdB = uuidv4();
const certIdAdmin = uuidv4();
const fpA = sha512FingerprintFromPem(certPemA);

const adminToken = () => getTestToken(adminEmail, adminId);
const siteToken = () => getTestToken(siteEmail, siteUserId);
const base = (o: string) => `/api/v1/admin/organizations/${o}/login-certificates`;

beforeAll(async () => {
  await db('email_whitelist').insert([
    { id: uuidv4(), email: adminEmail, created_at: new Date() },
    { id: uuidv4(), email: siteEmail, created_at: new Date() },
  ]);
  await db('users').insert([
    { id: adminId, email: adminEmail, totp_enabled: true, totp_secret: 'placeholder' },
    { id: siteUserId, email: siteEmail, totp_enabled: true, totp_secret: 'placeholder' },
  ]);
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: adminEmail,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(adminEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
  for (const [iid, org] of [
    [instA, orgA],
    [instB, orgB],
  ]) {
    await db('instances').insert({
      id: iid,
      user_id: siteUserId,
      label: org,
      created_at: new Date(),
    });
    await db('organizations').insert({
      identifier: org,
      instance_id: iid,
      name: org,
      email: 'a@b.de',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
  const certRow = (id: string, org: string, pem: string) => ({
    id,
    organization_id: org,
    pem,
    subject: org,
    thumbprint: 'a'.repeat(64),
    valid_until: '2099-01-01',
    created_at: new Date(),
  });
  await db('certificates').insert([
    certRow(certIdA, orgA, certPemA),
    certRow(certIdB, orgB, certPemB),
    certRow(certIdAdmin, orgA, adminCertPem),
  ]);
  await db('admin_cert_fingerprints').insert({
    id: uuidv4(),
    email: `other-admin-${sfx}@imi-test.example.de`,
    fingerprint: sha512FingerprintFromPem(adminCertPem),
    created_at: new Date(),
    created_by: 'test',
  });
});

afterAll(async () => {
  await db('audit_logs').whereIn('instance_id', [instA, instB]).del();
  await db('admin_cert_fingerprints').where('email', 'like', `other-admin-${sfx}%`).del();
  await db('organizations').whereIn('identifier', [orgA, orgB]).del();
  await db('instances').whereIn('id', [instA, instB]).del();
  await db('admin_grants').where({ email: adminEmail }).del();
  await db('users').whereIn('email', [adminEmail, siteEmail]).del();
  await db('email_whitelist').whereIn('email', [adminEmail, siteEmail]).del();
});

describe('admin login-certificates API', () => {
  it('refuses a non-admin (403) and an unauthenticated caller (401)', async () => {
    const r = await request(app).get(base(orgA)).set('Authorization', `Bearer ${siteToken()}`);
    expect(r.status).toBe(403);
    expect((await request(app).get(base(orgA))).status).toBe(401);
    const post = await request(app)
      .post(base(orgA))
      .set('Authorization', `Bearer ${siteToken()}`)
      .send({ certificateId: certIdA, totpCode: '123456' });
    expect(post.status).toBe(403);
  });

  it('requires the step-up for writes', async () => {
    const res = await request(app)
      .post(base(orgA))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ certificateId: certIdA });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOTP_REQUIRED');
    const del = await request(app)
      .delete(`${base(orgA)}/${fpA}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(del.status).toBe(400);
  });

  it('enables a certificate, computes the SHA-512 server-side, audits it, lists it', async () => {
    const res = await request(app)
      .post(base(orgA))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ certificateId: certIdA, totpCode: '123456' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      fingerprint: fpA,
      certificateId: certIdA,
      source: 'ADMIN',
    });

    const list = await request(app).get(base(orgA)).set('Authorization', `Bearer ${adminToken()}`);
    expect(list.body.data.map((e: { fingerprint: string }) => e.fingerprint)).toEqual([fpA]);

    const audit = await db('audit_logs')
      .where({ instance_id: instA, resource_type: 'ORGANIZATION', operation: 'UPDATE' })
      .orderBy('timestamp', 'desc')
      .first();
    const diff =
      typeof audit.diff_json === 'string' ? JSON.parse(audit.diff_json) : audit.diff_json;
    expect(diff).toMatchObject({ action: 'login_certificate', change: 'enable' });
    expect(JSON.stringify(diff)).not.toContain(fpA); // only a prefix is logged

    // idempotent
    const again = await request(app)
      .post(base(orgA))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ certificateId: certIdA, totpCode: '123456' });
    expect(again.status).toBe(201);
  });

  it('shows the login certificates read-only to the instance owner', async () => {
    const res = await request(app)
      .get(`/api/v1/instances/${instA}/certificates/login-certificates`)
      .set('Authorization', `Bearer ${siteToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].fingerprint).toBe(fpA);
  });

  it('refuses an admin certificate (409 ADMIN_CERTIFICATE)', async () => {
    const res = await request(app)
      .post(base(orgA))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ certificateId: certIdAdmin, totpCode: '123456' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ADMIN_CERTIFICATE');
  });

  it('refuses a certificate of another organization (404) and one used elsewhere (409)', async () => {
    const foreign = await request(app)
      .post(base(orgA))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ certificateId: certIdB, totpCode: '123456' });
    expect(foreign.status).toBe(404);

    // The same certificate uploaded under organization B, fingerprint already login for A.
    const dup = uuidv4();
    await db('certificates').insert({
      id: dup,
      organization_id: orgB,
      pem: certPemA,
      subject: orgB,
      thumbprint: 'b'.repeat(64),
      valid_until: '2099-01-01',
      created_at: new Date(),
    });
    const res = await request(app)
      .post(base(orgB))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ certificateId: dup, totpCode: '123456' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FINGERPRINT_IN_USE');
  });

  it('deletes a login entry; unknown fingerprint is 404', async () => {
    const miss = await request(app)
      .delete(`${base(orgA)}/${'f'.repeat(128)}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ totpCode: '123456' });
    expect(miss.status).toBe(404);
    const del = await request(app)
      .delete(`${base(orgA)}/${fpA}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ totpCode: '123456' });
    expect(del.status).toBe(200);
    expect(await db('org_login_certificates').where({ fingerprint: fpA }).first()).toBeUndefined();
  });

  it('deleting the uploaded certificate removes its login entry', async () => {
    await request(app)
      .post(base(orgA))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ certificateId: certIdA, totpCode: '123456' });
    await db('certificates').where({ id: certIdA }).del();
    expect(await db('org_login_certificates').where({ fingerprint: fpA }).first()).toBeUndefined();
  });
});

describe('onboarding import writes the login certificate', () => {
  const emails: string[] = [];
  const ids: string[] = [];
  afterAll(async () => {
    await db('organizations').whereIn('identifier', ids).del();
    await db('instances').whereIn('label', ids).del();
    await db('admin_grants').whereIn('email', emails).del();
    await db('users').whereIn('email', emails).del();
    await db('email_whitelist').whereIn('email', emails).del();
  });

  function row(identifier: string, fp: string, contactEmail: string) {
    ids.push(identifier);
    emails.push(contactEmail);
    return onboardingRowSchema.parse({
      organizationIdentifier: identifier,
      organizationName: 'Onboard Test',
      contactEmail,
      clientCertFingerprint: fp,
    });
  }

  it('creates an ONBOARDING entry, replaces it on re-import, refuses a fingerprint of another org', async () => {
    const id1 = `ob-1-${sfx}.example.de`;
    const id2 = `ob-2-${sfx}.example.de`;
    const fp1 = 'd'.repeat(128);
    const fp1b = 'e'.repeat(128);
    const mail = `ob-${sfx}@example.de`;
    const res = await importSites([row(id1, fp1, mail)], 'actor@example.de', '127.0.0.1');
    expect(res.summary.created).toBe(1);
    let entries = await db('org_login_certificates').where({ organization_id: id1 });
    expect(entries).toMatchObject([{ fingerprint: fp1, source: 'ONBOARDING' }]);

    await importSites([row(id1, fp1b, mail)], 'actor@example.de', '127.0.0.1');
    entries = await db('org_login_certificates').where({ organization_id: id1 });
    expect(entries.map((e) => e.fingerprint)).toEqual([fp1b]);

    const clash = await importSites([row(id2, fp1b, `ob2-${sfx}@example.de`)], 'a@example.de', '1');
    expect(clash.rows[0]).toMatchObject({ ok: false, issue: 'FINGERPRINT_IN_USE' });
  });

  it('moves the instance of an existing site from an admin to the contact user (audited)', async () => {
    const id = `ob-3-${sfx}.example.de`;
    const iid = uuidv4();
    await db('instances').insert({ id: iid, user_id: adminId, label: id, created_at: new Date() });
    await db('organizations').insert({
      identifier: id,
      instance_id: iid,
      name: id,
      email: 'a@b.de',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    ids.push(id);
    const contact = `ob3-${sfx}@example.de`;
    const res = await importSites([row(id, 'f'.repeat(128), contact)], 'actor@example.de', '1');
    expect(res.rows[0]).toMatchObject({ action: 'updated', ok: true });
    const inst = await db('instances').where({ id: iid }).first();
    const owner = await db('users').where({ id: inst.user_id }).first();
    expect(owner.email).toBe(contact);
    const audit = await db('audit_logs').where({ instance_id: iid }).select('diff_json');
    expect(JSON.stringify(audit)).toContain('instance_owner_transfer');
    await db('audit_logs').where({ instance_id: iid }).del();
  });
});
