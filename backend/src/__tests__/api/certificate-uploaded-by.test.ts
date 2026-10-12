/**
 * certificate-uploaded-by.test.ts – Who uploaded an organization certificate:
 * the clinic's own session records uploaded_by_admin = 0, an admin session
 * (also an admin acting on his own instance or a clinic session of an admin
 * user is NOT admin) records 1; renewal does the same; the API reports
 * uploadedByClinic; migration 031's backfill statements are idempotent.
 * Dependencies: supertest, app, db, helpers/allowListSites, fs
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';
import { signGrant } from '../../lib/adminGrants';
import { makeCertPem } from '../helpers/allowListSites';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const clinic = { email: `ub-clinic-${sfx}@example.de`, id: uuidv4() };
const admin = { email: `ub-admin-${sfx}@imi-test.example.de`, id: uuidv4() };
const instId = uuidv4();
const orgId = `ub-${sfx}.example.de`;
const certsUrl = `/api/v1/instances/${instId}/certificates`;
const privateKey = () => Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString();
const clinicToken = () => `Bearer ${getTestToken(clinic.email, clinic.id)}`;
const adminToken = () => `Bearer ${getTestToken(admin.email, admin.id)}`;
/** Org-scoped session of the admin user: never admin. */
const adminAsOrgToken = () =>
  `Bearer ${jwt.sign(
    { email: admin.email, sub: admin.id, kind: 'org', inst: instId },
    privateKey(),
    {
      algorithm: 'RS256',
      expiresIn: '15m',
    },
  )}`;

const flags = (id: string) =>
  db('certificates').where({ id }).select('uploaded_by', 'uploaded_by_admin').first();

beforeAll(async () => {
  for (const u of [clinic, admin]) {
    await db('email_whitelist').insert({ id: uuidv4(), email: u.email, created_at: new Date() });
    await db('users').insert({ id: u.id, email: u.email, totp_enabled: true, totp_secret: 'x' });
  }
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: admin.email,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(admin.email, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
  await db('instances').insert({
    id: instId,
    user_id: clinic.id,
    label: orgId,
    created_at: new Date(),
  });
  await db('organizations').insert({
    identifier: orgId,
    instance_id: instId,
    name: orgId,
    email: 'a@b.de',
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterAll(async () => {
  await db('audit_logs').whereIn('user_email', [clinic.email, admin.email]).del();
  await db('audit_logs').where({ instance_id: instId }).del();
  await db('certificates').where({ organization_id: orgId }).del();
  await db('organizations').where({ identifier: orgId }).del();
  await db('instances').where({ id: instId }).del();
  await db('admin_grants').where({ email: admin.email }).del();
  await db('users').whereIn('email', [clinic.email, admin.email]).del();
  await db('email_whitelist').whereIn('email', [clinic.email, admin.email]).del();
});

describe('upload records who uploaded the certificate', () => {
  it('clinic session: uploaded_by_admin = 0 and uploadedByClinic in the API', async () => {
    const res = await request(app)
      .post(certsUrl)
      .set('Authorization', clinicToken())
      .send({ pem: makeCertPem(`clinic.${sfx}`) })
      .expect(201);
    expect(res.body.data.uploadedByClinic).toBe(true);
    expect(res.body.data.uploaded_by_admin).toBeUndefined();
    expect(await flags(res.body.data.id)).toEqual({
      uploaded_by: clinic.email,
      uploaded_by_admin: 0,
    });
  });

  it('admin session (cross-instance): uploaded_by_admin = 1 and uploadedByClinic false', async () => {
    const res = await request(app)
      .post(certsUrl)
      .set('Authorization', adminToken())
      .send({ pem: makeCertPem(`admin.${sfx}`) })
      .expect(201);
    expect(res.body.data.uploadedByClinic).toBe(false);
    expect(await flags(res.body.data.id)).toEqual({
      uploaded_by: admin.email,
      uploaded_by_admin: 1,
    });
  });

  it('org-scoped session of an admin user counts as the clinic (never admin)', async () => {
    const res = await request(app)
      .post(certsUrl)
      .set('Authorization', adminAsOrgToken())
      .send({ pem: makeCertPem(`scoped.${sfx}`) })
      .expect(201);
    expect(await flags(res.body.data.id)).toEqual({
      uploaded_by: admin.email,
      uploaded_by_admin: 0,
    });
  });

  it('renewal records the renewing session; the list reports uploadedByClinic', async () => {
    const created = await request(app)
      .post(certsUrl)
      .set('Authorization', clinicToken())
      .send({ pem: makeCertPem(`old.${sfx}`) })
      .expect(201);
    const renewedByAdmin = await request(app)
      .post(`${certsUrl}/${created.body.data.id}/renew`)
      .set('Authorization', adminToken())
      .send({ pem: makeCertPem(`renewed.${sfx}`) })
      .expect(200);
    expect(await flags(renewedByAdmin.body.data.id)).toEqual({
      uploaded_by: admin.email,
      uploaded_by_admin: 1,
    });
    const renewedByClinic = await request(app)
      .post(`${certsUrl}/${renewedByAdmin.body.data.id}/renew`)
      .set('Authorization', clinicToken())
      .send({ pem: makeCertPem(`renewed2.${sfx}`) })
      .expect(200);
    expect(await flags(renewedByClinic.body.data.id)).toEqual({
      uploaded_by: clinic.email,
      uploaded_by_admin: 0,
    });
    const list = await request(app).get(certsUrl).set('Authorization', clinicToken()).expect(200);
    for (const c of list.body.data as Array<{ uploadedByClinic: boolean; pem?: string }>) {
      expect(typeof c.uploadedByClinic).toBe('boolean');
      expect(c.pem).toBeUndefined();
    }
  });
});

describe('migration 031 backfill', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../../../db/migrations/031_cert_recovery_four_eyes.sql'),
    'utf8',
  );
  const backfill = sql
    .slice(sql.indexOf('-- Backfill'))
    .split(';')
    .map((s) =>
      s
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);

  it('derives uploader and admin flag from the audit log, leaves unknown NULL, is idempotent', async () => {
    const mk = (suffix: string) => ({
      id: uuidv4(),
      organization_id: orgId,
      pem: makeCertPem(`bf-${suffix}.${sfx}`),
      subject: suffix,
      thumbprint: 'a'.repeat(64),
      valid_until: '2099-01-01',
      created_at: new Date(),
    });
    const byClinic = mk('clinic');
    const byAdmin = mk('admin');
    const unknown = mk('unknown');
    await db('certificates').insert([byClinic, byAdmin, unknown]);
    for (const [row, who] of [
      [byClinic, clinic.email],
      [byAdmin, admin.email],
    ] as const) {
      await db('audit_logs').insert({
        id: uuidv4(),
        timestamp: new Date(),
        user_email: who,
        instance_id: instId,
        resource_type: 'CERTIFICATE',
        resource_id: row.id,
        operation: 'CREATE',
        diff_json: JSON.stringify({}),
        ip_address: '127.0.0.1',
      });
    }

    expect(backfill).toHaveLength(2);
    for (let run = 0; run < 2; run++) {
      for (const statement of backfill) await db.raw(statement);
      expect(await flags(byClinic.id)).toEqual({ uploaded_by: clinic.email, uploaded_by_admin: 0 });
      expect(await flags(byAdmin.id)).toEqual({ uploaded_by: admin.email, uploaded_by_admin: 1 });
      expect(await flags(unknown.id)).toEqual({ uploaded_by: null, uploaded_by_admin: null });
    }
  });
});
