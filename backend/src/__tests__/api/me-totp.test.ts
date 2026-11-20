/**
 * me-totp.test.ts – forced TOTP enrolment of an admin who signs in with a
 * client certificate (AUTH_MODE=cert), through the real Express app.
 *
 *  - Until the admin has enrolled, the session reaches only /auth/me and the
 *    /api/v1/me/totp endpoints; everything else answers 403
 *    TOTP_ENROLMENT_REQUIRED.
 *  - Enrolment: setup (QR + secret) → confirm with a code → 10 TANs.
 *  - Afterwards the session is normal; re-setup needs a code or TAN; the TAN
 *    list can be regenerated with step-up (certificate + code/TAN) and the
 *    old list stops working.
 *  - An organization-scoped site session is never gated and never uses TOTP.
 *
 * Dependencies: supertest, node-forge, speakeasy, app, db, auth.service
 */
import request from 'supertest';
import forge from 'node-forge';
import speakeasy from 'speakeasy';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { createTokenPair } from '../../services/auth.service';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { signGrant } from '../../lib/adminGrants';

function makeCert(cn: string): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2035-01-01T00:00:00Z');
  const attrs = [{ shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return forge.pki.certificateToPem(cert);
}

const certHeaders = (pem: string) => ({
  'x-client-verify': 'SUCCESS',
  'x-client-cert': encodeURIComponent(pem),
});

const stamp = Date.now();
const ADMIN_PEM = makeCert(`admin-mt-${stamp}.example.de`);
const SITE_PEM = makeCert(`site-mt-${stamp}.example.de`);
const adminId = uuidv4();
const siteId = uuidv4();
const adminEmail = `admin-mt-${stamp}@imi-test.example.de`;
const siteEmail = `site-mt-${stamp}@example.de`;
const siteInstanceId = uuidv4();
const siteOrg = `site-mt-${stamp}.example.de`;

describe('forced TOTP enrolment for certificate admins', () => {
  const prevMode = process.env.AUTH_MODE;
  const prevAuto = process.env.DEV_AUTO_LOGIN;
  const prevBypass = process.env.DEV_TOTP_BYPASS;
  let adminToken: string;
  let siteToken: string;
  let secret = '';
  let tans: string[] = [];

  beforeAll(async () => {
    process.env.AUTH_MODE = 'cert';
    delete process.env.DEV_AUTO_LOGIN;
    delete process.env.DEV_TOTP_BYPASS;
    for (const [id, email] of [
      [adminId, adminEmail],
      [siteId, siteEmail],
    ]) {
      await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
      await db('users').insert({ id, email, totp_enabled: false, created_at: new Date() });
    }
    await db('instances').insert({
      id: siteInstanceId,
      user_id: siteId,
      label: 'L',
      created_at: new Date(),
    });
    await db('organizations').insert({
      identifier: siteOrg,
      instance_id: siteInstanceId,
      name: siteOrg,
      email: 'a@b.de',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('org_login_certificates').insert({
      fingerprint: sha512FingerprintFromPem(SITE_PEM),
      organization_id: siteOrg,
      certificate_id: null,
      source: 'ADMIN',
      created_by: 'test',
      created_at: new Date(),
    });
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: adminEmail,
      fingerprint: sha512FingerprintFromPem(ADMIN_PEM),
      created_at: new Date(),
      created_by: 'test',
    });
    const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await db('admin_grants').insert({
      email: adminEmail,
      granted_at: grantedAt,
      granted_by_a: 'SYSTEM:test',
      granted_by_b: 'SYSTEM:test',
      signature_hex: signGrant(adminEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
    });
    adminToken = (
      await createTokenPair({
        id: adminId,
        email: adminEmail,
        totpEnabled: false,
        authMethod: 'cert',
      })
    ).accessToken;
    siteToken = (
      await createTokenPair({
        id: siteId,
        email: siteEmail,
        totpEnabled: false,
        authMethod: 'cert',
        scopeInstanceId: siteInstanceId,
      })
    ).accessToken;
  });

  afterAll(async () => {
    if (prevMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevMode;
    if (prevAuto !== undefined) process.env.DEV_AUTO_LOGIN = prevAuto;
    if (prevBypass !== undefined) process.env.DEV_TOTP_BYPASS = prevBypass;
    await db('admin_grants').where({ email: adminEmail }).del();
    await db('admin_cert_fingerprints').where({ email: adminEmail }).del();
    await db('org_login_certificates').where({ organization_id: siteOrg }).del();
    await db('organizations').where({ identifier: siteOrg }).del();
    await db('instances').where({ id: siteInstanceId }).del();
    await db('users').whereIn('id', [adminId, siteId]).del();
    await db('email_whitelist').whereIn('email', [adminEmail, siteEmail]).del();
  });

  const asAdmin = (method: 'get' | 'post', url: string) => {
    const agent = request(app);
    return agent[method](url)
      .set('Authorization', `Bearer ${adminToken}`)
      .set(certHeaders(ADMIN_PEM));
  };
  const asSite = (method: 'get' | 'post', url: string) => {
    const agent = request(app);
    return agent[method](url)
      .set('Authorization', `Bearer ${siteToken}`)
      .set(certHeaders(SITE_PEM));
  };

  it('/auth/me tells the unenrolled admin that enrolment is required', async () => {
    const res = await asAdmin('get', '/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isAdmin: true, totpEnrolmentRequired: true });
  });

  it('refuses ordinary and admin API routes with 403 TOTP_ENROLMENT_REQUIRED', async () => {
    for (const url of ['/api/v1/instances', '/api/v1/admin/users']) {
      const res = await asAdmin('get', url);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TOTP_ENROLMENT_REQUIRED');
    }
  });

  it('does not gate an org-scoped site session, and keeps it out of TOTP', async () => {
    expect((await asSite('get', '/api/v1/instances')).status).toBe(200);
    expect((await asSite('get', '/auth/me')).body.data.totpEnrolmentRequired).toBe(false);
    expect((await asSite('post', '/api/v1/me/totp/setup').send({})).status).toBe(403);
  });

  it('reports the status before enrolment', async () => {
    const res = await asAdmin('get', '/api/v1/me/totp/status');
    expect(res.body.data).toEqual({ enabled: false, remainingTans: 0, enrolmentRequired: true });
  });

  it('confirm without a started setup answers 409 TOTP_ENROLMENT_EXPIRED', async () => {
    const res = await asAdmin('post', '/api/v1/me/totp/confirm').send({ code: '123456' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOTP_ENROLMENT_EXPIRED');
  });

  it('setup returns a QR code and the secret', async () => {
    const res = await asAdmin('post', '/api/v1/me/totp/setup').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.qrCodeUrl).toMatch(/^data:image\/png/);
    secret = res.body.data.secret;
    expect(secret).toBeTruthy();
  });

  it('a repeated setup returns the same secret; restart issues a new one', async () => {
    const again = await asAdmin('post', '/api/v1/me/totp/setup').send({});
    expect(again.status).toBe(200);
    expect(again.body.data.secret).toBe(secret);
    const restarted = await asAdmin('post', '/api/v1/me/totp/setup').send({ restart: true });
    expect(restarted.body.data.secret).not.toBe(secret);
    secret = restarted.body.data.secret;
  });

  it('confirm refuses a wrong code and a malformed one', async () => {
    const wrong = await asAdmin('post', '/api/v1/me/totp/confirm').send({ code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('TOTP_INVALID');
    const malformed = await asAdmin('post', '/api/v1/me/totp/confirm').send({ code: 'abc' });
    expect(malformed.status).toBe(400);
    expect((await asAdmin('get', '/api/v1/instances')).status).toBe(403);
  });

  it('confirm with the right code returns 10 TANs and lifts the gate', async () => {
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    const res = await asAdmin('post', '/api/v1/me/totp/confirm').send({ code });
    expect(res.status).toBe(200);
    tans = res.body.data.backupCodes;
    expect(tans).toHaveLength(10);
    expect((await asAdmin('get', '/api/v1/instances')).status).toBe(200);
    expect((await asAdmin('get', '/auth/me')).body.data.totpEnrolmentRequired).toBe(false);
    expect((await asAdmin('get', '/api/v1/me/totp/status')).body.data).toEqual({
      enabled: true,
      remainingTans: 10,
      enrolmentRequired: false,
    });
  });

  it('writes the enrolment steps to the audit log', async () => {
    // The route writes audit rows fire-and-forget, so the last one may land
    // just after the response; poll briefly instead of reading once.
    const readActions = async (): Promise<string[]> => {
      const rows = await db('audit_logs').where({
        user_email: adminEmail,
        operation: 'TOTP_SETUP',
      });
      return rows.map(
        (r) => (typeof r.diff_json === 'string' ? JSON.parse(r.diff_json) : r.diff_json).action,
      );
    };
    let actions = await readActions();
    for (let i = 0; i < 20 && !actions.includes('enrolled'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      actions = await readActions();
    }
    expect(actions).toEqual(
      expect.arrayContaining(['started', 'resumed', 'restarted', 'enrolled']),
    );
    const failed = await db('audit_logs').where({
      user_email: adminEmail,
      operation: 'STEP_UP_FAILED',
    });
    const reasons = failed.map(
      (r) => (typeof r.diff_json === 'string' ? JSON.parse(r.diff_json) : r.diff_json).reason,
    );
    expect(reasons).toEqual(expect.arrayContaining(['NO_PENDING', 'INVALID_CODE']));
  });

  it('a re-setup of an enrolled account needs a current code or TAN', async () => {
    expect((await asAdmin('post', '/api/v1/me/totp/setup').send({})).status).toBe(400);
    const wrong = await asAdmin('post', '/api/v1/me/totp/setup').send({ code: '000000' });
    expect(wrong.status).toBe(401);
    const ok = await asAdmin('post', '/api/v1/me/totp/setup').send({ code: tans[0] });
    expect(ok.status).toBe(200);
    const status = await asAdmin('get', '/api/v1/me/totp/status');
    expect(status.body.data).toMatchObject({ enabled: true, remainingTans: 9 });
  });

  it('regenerating the TAN list needs step-up and invalidates the old list', async () => {
    const none = await asAdmin('post', '/api/v1/me/totp/backup-codes').send({});
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('TOTP_REQUIRED');

    const res = await asAdmin('post', '/api/v1/me/totp/backup-codes').send({ totpCode: tans[1] });
    expect(res.status).toBe(200);
    const fresh: string[] = res.body.data.backupCodes;
    expect(fresh).toHaveLength(10);

    const old = await asAdmin('post', '/api/v1/me/totp/backup-codes').send({ totpCode: tans[2] });
    expect(old.status).toBe(401);
    const again = await asAdmin('post', '/api/v1/me/totp/backup-codes').send({
      totpCode: fresh[0],
    });
    expect(again.status).toBe(200);
    expect((await asAdmin('get', '/api/v1/me/totp/status')).body.data.remainingTans).toBe(10);
  });
});
