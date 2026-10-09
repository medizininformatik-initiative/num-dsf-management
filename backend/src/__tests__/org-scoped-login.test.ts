/**
 * org-scoped-login.test.ts – Certificate login through an ORGANIZATION login
 * certificate yields a session scoped to that organization's instance:
 * the token carries the scope, only that instance is visible/usable, the
 * session is never admin (even if the instance owner holds an admin grant),
 * refresh keeps the scope only with the same certificate, and in certificate
 * mode a removed login certificate ends the session on the next request.
 * Admin certificates stay unscoped admins. Also covers the migration 029
 * backfill and the per-certificate login rate limiter.
 * Dependencies: supertest, app, db, auth.service, helpers/allowListSites
 */
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../app';
import { db } from '../db/connection';
import { signGrant } from '../lib/adminGrants';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { writeAuditLog } from '../services/audit.service';
import { makeCertPem, mtlsHeaders } from './helpers/allowListSites';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ownerEmail = `scope-owner-${sfx}@example.de`;
const adminEmail = `scope-admin-${sfx}@imi-test.example.de`;
const ownerId = uuidv4();
const inst1 = uuidv4();
const inst2 = uuidv4();
const org1 = `scope-one-${sfx}.example.de`;
const org2 = `scope-two-${sfx}.example.de`;
const PEM1 = makeCertPem(`login.${org1}`);
const PEM2 = makeCertPem(`login.${org2}`);
const ADMIN_PEM = makeCertPem(`admin.${sfx}.example.de`);
const UNKNOWN_PEM = makeCertPem(`unknown.${sfx}.example.de`);

async function grantAdmin(email: string): Promise<void> {
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(email, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
}

function login(pem: string) {
  return request(app)
    .post('/auth/client-cert-login')
    .set(mtlsHeaders(pem) as Record<string, string>);
}

beforeAll(async () => {
  for (const email of [ownerEmail, adminEmail]) {
    await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
  }
  await db('users').insert({ id: ownerId, email: ownerEmail, totp_enabled: true });
  await grantAdmin(ownerEmail); // the owner is an admin: scoped sessions must still not be
  for (const [iid, org, pem] of [
    [inst1, org1, PEM1],
    [inst2, org2, PEM2],
  ]) {
    await db('instances').insert({ id: iid, user_id: ownerId, label: org, created_at: new Date() });
    await db('organizations').insert({
      identifier: org,
      instance_id: iid,
      name: org,
      email: 'a@b.de',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('org_login_certificates').insert({
      fingerprint: sha512FingerprintFromPem(pem),
      organization_id: org,
      certificate_id: null,
      source: 'ADMIN',
      created_by: 'test',
      created_at: new Date(),
    });
  }
  await db('admin_cert_fingerprints').insert({
    id: uuidv4(),
    email: adminEmail,
    fingerprint: sha512FingerprintFromPem(ADMIN_PEM),
    created_at: new Date(),
    created_by: 'test',
  });
  await grantAdmin(adminEmail);
  await writeAuditLog({
    userEmail: 'x@example.de',
    instanceId: inst1,
    resourceType: 'ORGANIZATION',
    resourceId: org1,
    operation: 'UPDATE',
    ipAddress: '127.0.0.1',
  });
  await writeAuditLog({
    userEmail: 'x@example.de',
    instanceId: inst2,
    resourceType: 'ORGANIZATION',
    resourceId: org2,
    operation: 'UPDATE',
    ipAddress: '127.0.0.1',
  });
});

afterAll(async () => {
  await db('audit_logs').whereIn('instance_id', [inst1, inst2]).del();
  await db('admin_cert_fingerprints').where({ email: adminEmail }).del();
  await db('organizations').whereIn('identifier', [org1, org2]).del();
  await db('instances').whereIn('id', [inst1, inst2]).del();
  await db('admin_grants').whereIn('email', [ownerEmail, adminEmail]).del();
  await db('users').whereIn('email', [ownerEmail, adminEmail]).del();
  await db('email_whitelist').whereIn('email', [ownerEmail, adminEmail]).del();
});

describe('org login certificate → scoped session', () => {
  let token = '';

  beforeAll(async () => {
    const res = await login(PEM1);
    expect(res.status).toBe(200);
    token = res.body.data.accessToken;
  });

  const get = (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`);

  it('mints a token scoped to the organization instance', () => {
    const claims = jwt.decode(token) as { kind?: string; inst?: string; amr?: string };
    expect(claims).toMatchObject({ kind: 'org', inst: inst1, amr: 'cert' });
  });

  it('lists only its own instance although the owner has two', async () => {
    const res = await get('/api/v1/instances');
    expect(res.status).toBe(200);
    expect(res.body.data.map((i: { id: string }) => i.id)).toEqual([inst1]);
  });

  it('can read its instance but not the sibling instance of the same owner', async () => {
    expect((await get(`/api/v1/instances/${inst1}`)).status).toBe(200);
    expect((await get(`/api/v1/instances/${inst2}`)).status).toBe(404);
    expect((await get(`/api/v1/instances/${inst1}/organization`)).status).toBe(200);
    expect((await get(`/api/v1/instances/${inst2}/organization`)).status).toBe(403);
    expect((await get(`/api/v1/instances/${inst2}/certificates`)).status).toBe(403);
  });

  it('cannot modify or rename the sibling instance, nor create instances', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const put = await request(app)
      .put(`/api/v1/instances/${inst2}/organization`)
      .set(auth)
      .send({ name: 'hijack', email: 'a@b.de' });
    expect(put.status).toBe(403);
    expect(
      (await request(app).put(`/api/v1/instances/${inst2}/label`).set(auth).send({ label: 'x' }))
        .status,
    ).toBe(403);
    expect((await request(app).post('/api/v1/instances').set(auth).send({})).status).toBe(403);
    const unchanged = await db('organizations').where({ identifier: org2 }).first();
    expect(unchanged.name).toBe(org2);
  });

  it('is not admin although the owner has an admin grant', async () => {
    const me = await get('/auth/me');
    expect(me.body.data.isAdmin).toBe(false);
    expect((await get('/api/v1/admin/users')).status).toBe(403);
    expect((await get(`/api/v1/admin/organizations/${org1}/login-certificates`)).status).toBe(403);
  });

  it('sees only its own instance in the cross-instance audit view', async () => {
    const res = await get('/api/v1/audit?limit=100');
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ instance_id: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.instance_id === inst1)).toBe(true);
    expect(res.body.meta.isAdmin).toBe(false);
  });

  it('an unknown certificate is not registered for login', async () => {
    const res = await login(UNKNOWN_PEM);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CERT_NOT_REGISTERED');
  });
});

describe('admin certificate stays an unscoped admin', () => {
  it('has no scope claim, isAdmin and sees every instance', async () => {
    const res = await login(ADMIN_PEM);
    expect(res.status).toBe(200);
    const token = res.body.data.accessToken as string;
    const claims = jwt.decode(token) as { kind?: string; inst?: string };
    expect(claims.kind).toBeUndefined();
    expect(claims.inst).toBeUndefined();
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.data.isAdmin).toBe(true);
    const list = await request(app)
      .get('/api/v1/instances')
      .set('Authorization', `Bearer ${token}`);
    const ids = list.body.data.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([inst1, inst2]));
  });
});

describe('refresh keeps the scope', () => {
  it('stays scoped with the same certificate, fails without it or with a sibling certificate', async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post('/auth/client-cert-login').set(mtlsHeaders(PEM1) as never);
    expect(loginRes.status).toBe(200);

    const bare = await agent.post('/auth/refresh');
    expect(bare.status).toBe(401); // never degrades to an unscoped owner session

    const agent2 = request.agent(app);
    await agent2.post('/auth/client-cert-login').set(mtlsHeaders(PEM1) as never);
    const sibling = await agent2.post('/auth/refresh').set(mtlsHeaders(PEM2) as never);
    expect(sibling.status).toBe(401); // same owner, other instance

    const agent3 = request.agent(app);
    await agent3.post('/auth/client-cert-login').set(mtlsHeaders(PEM1) as never);
    const ok = await agent3.post('/auth/refresh').set(mtlsHeaders(PEM1) as never);
    expect(ok.status).toBe(200);
    const claims = jwt.decode(ok.body.data.accessToken) as { kind?: string; inst?: string };
    expect(claims).toMatchObject({ kind: 'org', inst: inst1 });
  });
});

describe('certificate-only mode binds the scope per request', () => {
  const prev = process.env.AUTH_MODE;
  beforeAll(() => {
    process.env.AUTH_MODE = 'cert';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prev;
  });

  it('accepts the token with its certificate, refuses a sibling certificate and a removed one', async () => {
    const token = (await login(PEM1)).body.data.accessToken as string;
    const call = (pem: string) =>
      request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${token}`)
        .set(mtlsHeaders(pem) as never);
    expect((await call(PEM1)).status).toBe(200);
    expect((await call(PEM2)).status).toBe(401);
    expect((await call(ADMIN_PEM)).status).toBe(401);

    const fp = sha512FingerprintFromPem(PEM1);
    const row = await db('org_login_certificates').where({ fingerprint: fp }).first();
    await db('org_login_certificates').where({ fingerprint: fp }).del();
    expect((await call(PEM1)).status).toBe(401);
    await db('org_login_certificates').insert(row);
  });
});

describe('migration 029 backfill', () => {
  it('copies organizations.client_cert_fingerprint as MIGRATED and links the uploaded certificate', async () => {
    const o = `backfill-${sfx}.example.de`;
    const iid = uuidv4();
    const pem = makeCertPem(`backfill.${o}`);
    const fp = sha512FingerprintFromPem(pem);
    const certId = uuidv4();
    await db('instances').insert({ id: iid, user_id: ownerId, label: o, created_at: new Date() });
    await db('organizations').insert({
      identifier: o,
      instance_id: iid,
      name: o,
      email: 'a@b.de',
      active: true,
      client_cert_fingerprint: fp.toUpperCase(),
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('certificates').insert({
      id: certId,
      organization_id: o,
      pem: pem.replace(/\n/g, '\r\n'),
      subject: o,
      thumbprint: 'a'.repeat(64),
      valid_until: '2099-01-01',
      created_at: new Date(),
    });
    try {
      const sql = fs.readFileSync(
        path.resolve(__dirname, '../../../db/migrations/029_org_login_certificates.sql'),
        'utf8',
      );
      const backfill = sql.slice(sql.indexOf('INSERT IGNORE INTO'));
      await db.raw(backfill);
      await db.raw(backfill); // idempotent
      const rows = await db('org_login_certificates').where({ organization_id: o });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        fingerprint: fp,
        source: 'MIGRATED',
        certificate_id: certId,
      });
    } finally {
      await db('organizations').where({ identifier: o }).del();
      await db('instances').where({ id: iid }).del();
    }
  });
});

describe('certificate login rate limiter', () => {
  it('is keyed per certificate: one IP, two certificates do not block each other', async () => {
    process.env.RATE_LIMIT_CERT_LOGIN_MAX = '2';
    let limiter: express.RequestHandler;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      limiter = require('../middleware/rateLimit.middleware').certLoginRateLimit;
    });
    const a = express();
    a.set('trust proxy', 1);
    a.post(
      '/x',
      (r, s, n) => limiter(r, s, n),
      (_r, s) => s.json({ ok: true }),
    );
    const post = (pem: string) =>
      request(a)
        .post('/x')
        .set(mtlsHeaders(pem) as never);
    const pemA = makeCertPem(`rl-a-${sfx}`);
    const pemB = makeCertPem(`rl-b-${sfx}`);
    expect((await post(pemA)).status).toBe(200);
    expect((await post(pemA)).status).toBe(200);
    expect((await post(pemA)).status).toBe(429);
    expect((await post(pemB)).status).toBe(200);
    delete process.env.RATE_LIMIT_CERT_LOGIN_MAX;
  });
});
