/**
 * admin-certificates.test.ts – Admin certificate lifecycle API: expiry recorded
 * on admin certificate login, own list (current marked, own only), successor
 * upload (private key / expired / not yet valid / duplicate admin / duplicate
 * organization certificate / CA whitelist, step-up, non-admin and org-scoped
 * refused, audit), removal (never the current certificate), colleague
 * recovery request (self target and non-admin target refused, audit; the four-eyes
 * decision is covered by admin-cert-requests.test.ts) and the
 * ADMIN_CHANGE anomaly flag severities.
 * Dependencies: supertest, app, db, helpers/allowListSites, node-forge
 */
jest.mock('../../services/totp.service', () => ({
  ...jest.requireActual('../../services/totp.service'),
  verifyTotpCode: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../services/notification.service', () => ({
  ...jest.requireActual('../../services/notification.service'),
  sendAdminCertChangedEmail: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import forge from 'node-forge';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';
import { signGrant } from '../../lib/adminGrants';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { makeCertPem, mtlsHeaders } from '../helpers/allowListSites';
import { verifyTotpCode } from '../../services/totp.service';
import { sendAdminCertChangedEmail } from '../../services/notification.service';
import { computeAnomalyFlags } from '../../services/auditAnomalies';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `ac-admin-${sfx}@imi-test.example.de`;
const colleagueEmail = `ac-colleague-${sfx}@imi-test.example.de`;
const plainEmail = `ac-plain-${sfx}@example.de`;
const adminId = uuidv4();
const colleagueId = uuidv4();
const plainId = uuidv4();
const instId = uuidv4();
const orgId = `ac-org-${sfx}.example.de`;
const CURRENT_PEM = makeCertPem(`admin-current.${sfx}`);
const OTHER_OWN_PEM = makeCertPem(`admin-other.${sfx}`);
const COLLEAGUE_PEM = makeCertPem(`colleague.${sfx}`);
const ORG_LOGIN_PEM = makeCertPem(`org-login.${sfx}`);
const BASE = '/api/v1/admin/me/certificates';

function pemWithValidity(cn: string, notBefore: Date, notAfter: Date): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const attrs = [{ shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

const adminToken = () => getTestToken(adminEmail, adminId);
const privateKey = () => Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString();
function claimToken(claims: Record<string, unknown>): string {
  return jwt.sign({ email: adminEmail, sub: adminId, ...claims }, privateKey(), {
    algorithm: 'RS256',
    expiresIn: '15m',
  });
}
const code = { totpCode: '123456' };

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

async function insertAdminCert(email: string, pem: string, extra: Record<string, unknown> = {}) {
  const id = uuidv4();
  await db('admin_cert_fingerprints').insert({
    id,
    email,
    fingerprint: sha512FingerprintFromPem(pem),
    created_at: new Date(),
    created_by: 'test',
    ...extra,
  });
  return id;
}

let currentId: string;

beforeAll(async () => {
  for (const [email, id] of [
    [adminEmail, adminId],
    [colleagueEmail, colleagueId],
    [plainEmail, plainId],
  ]) {
    await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
    await db('users').insert({ id, email, totp_enabled: true, totp_secret: 'placeholder' });
  }
  await grantAdmin(adminEmail);
  await grantAdmin(colleagueEmail);
  await db('instances').insert({
    id: instId,
    user_id: plainId,
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
  await db('org_login_certificates').insert({
    fingerprint: sha512FingerprintFromPem(ORG_LOGIN_PEM),
    organization_id: orgId,
    certificate_id: null,
    source: 'ADMIN',
    created_by: 'test',
    created_at: new Date(),
  });
  currentId = await insertAdminCert(adminEmail, CURRENT_PEM);
  await insertAdminCert(colleagueEmail, COLLEAGUE_PEM, { label: 'colleague' });
});

afterAll(async () => {
  await db('audit_logs').whereIn('user_email', [adminEmail, colleagueEmail]).del();
  await db('admin_cert_fingerprints').whereIn('email', [adminEmail, colleagueEmail]).del();
  await db('org_login_certificates').where({ organization_id: orgId }).del();
  await db('organizations').where({ identifier: orgId }).del();
  await db('instances').where({ id: instId }).del();
  await db('admin_grants').whereIn('email', [adminEmail, colleagueEmail]).del();
  await db('users').whereIn('email', [adminEmail, colleagueEmail, plainEmail]).del();
  await db('email_whitelist').whereIn('email', [adminEmail, colleagueEmail, plainEmail]).del();
});

beforeEach(() => {
  (verifyTotpCode as jest.Mock).mockResolvedValue(true);
  (sendAdminCertChangedEmail as jest.Mock).mockClear();
});

describe('expiry recorded on admin certificate login', () => {
  it('stores subject, valid_until and last_used_at', async () => {
    await request(app).post('/auth/client-cert-login').set(mtlsHeaders(CURRENT_PEM)).expect(200);
    const row = await db('admin_cert_fingerprints').where({ id: currentId }).first();
    expect(row.subject).toBe(`admin-current.${sfx}`);
    expect(new Date(row.valid_until).getUTCFullYear()).toBe(2035);
    expect(row.last_used_at).not.toBeNull();
  });
});

describe('GET /admin/me/certificates', () => {
  it('lists only the caller own certificates and marks the presented one', async () => {
    const res = await request(app)
      .get(BASE)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set(mtlsHeaders(CURRENT_PEM))
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: currentId, email: adminEmail, current: true });
    expect(res.body.data[0].pem).toBeUndefined();
  });

  it('marks nothing current without a presented certificate', async () => {
    const res = await request(app).get(BASE).set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.data[0].current).toBe(false);
  });

  it('refuses a non-admin with 403 and an org-scoped admin session with 403', async () => {
    await request(app)
      .get(BASE)
      .set('Authorization', `Bearer ${getTestToken(plainEmail, plainId)}`)
      .expect(403);
    await request(app)
      .get(BASE)
      .set('Authorization', `Bearer ${claimToken({ kind: 'org', inst: instId })}`)
      .expect(403);
  });
});

describe('POST /admin/me/certificates (successor)', () => {
  const post = (body: Record<string, unknown>, token = adminToken()) =>
    request(app).post(BASE).set('Authorization', `Bearer ${token}`).send(body);

  it('rejects a private key with 400 and stores nothing', async () => {
    const pem = `${OTHER_OWN_PEM}\n-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----`;
    const res = await post({ pem, ...code }).expect(400);
    expect(res.body.error.code).toBe('PRIVATE_KEY_REJECTED');
    expect(await db('admin_cert_fingerprints').where({ email: adminEmail })).toHaveLength(1);
  });

  it('rejects garbage as INVALID_PEM', async () => {
    const res = await post({ pem: 'not a certificate', ...code }).expect(400);
    expect(res.body.error.code).toBe('INVALID_PEM');
  });

  it('rejects an expired and a not yet valid certificate', async () => {
    const expired = pemWithValidity(
      `expired.${sfx}`,
      new Date('2020-01-01T00:00:00Z'),
      new Date('2021-01-01T00:00:00Z'),
    );
    const future = pemWithValidity(
      `future.${sfx}`,
      new Date('2090-01-01T00:00:00Z'),
      new Date('2091-01-01T00:00:00Z'),
    );
    expect((await post({ pem: expired, ...code }).expect(400)).body.error.code).toBe(
      'CERTIFICATE_EXPIRED',
    );
    expect((await post({ pem: future, ...code }).expect(400)).body.error.code).toBe(
      'CERTIFICATE_NOT_YET_VALID',
    );
  });

  it('rejects a fingerprint that is already an admin certificate (409)', async () => {
    const res = await post({ pem: COLLEAGUE_PEM, ...code }).expect(409);
    expect(res.body.error.code).toBe('ADMIN_CERTIFICATE_IN_USE');
  });

  it('rejects a fingerprint that is an organization login certificate (409)', async () => {
    const res = await post({ pem: ORG_LOGIN_PEM, ...code }).expect(409);
    expect(res.body.error.code).toBe('ORG_LOGIN_CERTIFICATE_IN_USE');
  });

  it('applies the CA whitelist when enforced', async () => {
    process.env.CA_WHITELIST_ENFORCE = 'true';
    try {
      const res = await post({ pem: makeCertPem(`unlisted.${sfx}`), ...code }).expect(400);
      expect(res.body.error.code).toBe('CA_NOT_WHITELISTED');
    } finally {
      delete process.env.CA_WHITELIST_ENFORCE;
    }
  });

  it('requires the step-up: no code 400, wrong code 401', async () => {
    const pem = makeCertPem(`stepup.${sfx}`);
    expect((await post({ pem }).expect(400)).body.error.code).toBe('TOTP_REQUIRED');
    (verifyTotpCode as jest.Mock).mockResolvedValue(false);
    expect((await post({ pem, ...code }).expect(401)).body.error.code).toBe('TOTP_INVALID');
    expect(await db('admin_cert_fingerprints').where({ email: adminEmail })).toHaveLength(1);
  });

  it('refuses a non-admin (403) and an org-scoped session (403)', async () => {
    const pem = makeCertPem(`nonadmin.${sfx}`);
    await post({ pem, ...code }, getTestToken(plainEmail, plainId)).expect(403);
    await post({ pem, ...code }, claimToken({ kind: 'org', inst: instId })).expect(403);
  });

  it('stores a valid successor with metadata, label and an audit entry', async () => {
    const res = await post({ pem: OTHER_OWN_PEM, label: ' Nachfolger ', ...code }).expect(201);
    expect(res.body.data).toMatchObject({
      email: adminEmail,
      label: 'Nachfolger',
      fingerprint: sha512FingerprintFromPem(OTHER_OWN_PEM),
      createdBy: adminEmail,
    });
    expect(res.body.data.validUntil).toBeTruthy();
    const audit = await db('audit_logs')
      .where({ user_email: adminEmail, resource_type: 'AUTH', operation: 'CREATE' })
      .orderBy('timestamp', 'desc')
      .first();
    const diff =
      typeof audit.diff_json === 'string' ? JSON.parse(audit.diff_json) : audit.diff_json;
    expect(diff).toMatchObject({ action: 'admin_certificate', change: 'add', self: true });
    expect(diff.fingerprintPrefix).toBe(sha512FingerprintFromPem(OTHER_OWN_PEM).slice(0, 16));
    expect(JSON.stringify(diff)).not.toContain('BEGIN CERTIFICATE');
  });
});

describe('PATCH + DELETE /admin/me/certificates/:id', () => {
  it('renames an own certificate and 404s for a foreign one', async () => {
    const own = await db('admin_cert_fingerprints')
      .where({ email: adminEmail, fingerprint: sha512FingerprintFromPem(OTHER_OWN_PEM) })
      .first();
    const ok = await request(app)
      .patch(`${BASE}/${own.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ label: 'Neu' })
      .expect(200);
    expect(ok.body.data.label).toBe('Neu');
    const foreign = await db('admin_cert_fingerprints').where({ email: colleagueEmail }).first();
    await request(app)
      .patch(`${BASE}/${foreign.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ label: 'x' })
      .expect(404);
  });

  it('refuses to remove the certificate of the current session (409)', async () => {
    // A cert session re-presenting CURRENT_PEM passes the cert step-up.
    const res = await request(app)
      .delete(`${BASE}/${currentId}`)
      .set('Authorization', `Bearer ${claimToken({ amr: 'cert' })}`)
      .set(mtlsHeaders(CURRENT_PEM))
      .expect(409);
    expect(res.body.error.code).toBe('CURRENT_CERTIFICATE');
    expect(await db('admin_cert_fingerprints').where({ id: currentId }).first()).toBeTruthy();
  });

  it('removes a non-current own certificate and audits it', async () => {
    const own = await db('admin_cert_fingerprints')
      .where({ email: adminEmail, fingerprint: sha512FingerprintFromPem(OTHER_OWN_PEM) })
      .first();
    await request(app)
      .delete(`${BASE}/${own.id}`)
      .set('Authorization', `Bearer ${claimToken({ amr: 'cert' })}`)
      .set(mtlsHeaders(CURRENT_PEM))
      .expect(200);
    expect(await db('admin_cert_fingerprints').where({ id: own.id }).first()).toBeUndefined();
    const audit = await db('audit_logs')
      .where({ user_email: adminEmail, resource_type: 'AUTH', operation: 'DELETE' })
      .first();
    expect(audit).toBeTruthy();
  });

  it('cannot remove another admin certificate through the self-service route', async () => {
    const foreign = await db('admin_cert_fingerprints').where({ email: colleagueEmail }).first();
    await request(app)
      .delete(`${BASE}/${foreign.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(code)
      .expect(404);
  });
});

describe('colleague recovery', () => {
  const colleagueUrl = (email: string) => `/api/v1/admin/users/${email}/certificates`;
  const NEW_PEM = makeCertPem(`recovered.${sfx}`);

  it('refuses the own e-mail (use self-service)', async () => {
    const res = await request(app)
      .post(colleagueUrl(adminEmail))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ pem: NEW_PEM, ...code })
      .expect(400);
    expect(res.body.error.code).toBe('USE_SELF_SERVICE');
  });

  it('refuses a target without an admin grant', async () => {
    const res = await request(app)
      .post(colleagueUrl(plainEmail))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ pem: NEW_PEM, ...code })
      .expect(400);
    expect(res.body.error.code).toBe('NOT_AN_ADMIN');
  });

  it('needs the step-up and an admin caller', async () => {
    await request(app)
      .post(colleagueUrl(colleagueEmail))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ pem: NEW_PEM })
      .expect(400);
    await request(app)
      .post(colleagueUrl(colleagueEmail))
      .set('Authorization', `Bearer ${getTestToken(plainEmail, plainId)}`)
      .send({ pem: NEW_PEM, ...code })
      .expect(403);
  });

  it('only opens a four-eyes request for the colleague (nothing becomes active)', async () => {
    const res = await request(app)
      .post(colleagueUrl(colleagueEmail))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ pem: NEW_PEM, label: 'Ersatz', ...code })
      .expect(201);
    expect(res.body.data).toEqual({ id: expect.any(String), status: 'PENDING' });
    expect(
      await db('admin_cert_fingerprints').where({ fingerprint: sha512FingerprintFromPem(NEW_PEM) }),
    ).toHaveLength(0);
    const audit = await db('audit_logs')
      .where({ user_email: adminEmail, operation: 'CREATE', resource_id: res.body.data.id })
      .first();
    const diff =
      typeof audit.diff_json === 'string' ? JSON.parse(audit.diff_json) : audit.diff_json;
    expect(diff).toMatchObject({ action: 'admin_certificate_request' });
    await db('admin_cert_requests').where({ id: res.body.data.id }).del();
  });

  it('lists all admin certificates for the overview', async () => {
    const res = await request(app)
      .get('/api/v1/admin/admin-certificates')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    const emails = (res.body.data as Array<{ email: string }>).map((c) => c.email);
    expect(emails).toContain(colleagueEmail);
    expect(emails).toContain(adminEmail);
  });

  it('removes a colleague certificate, mails them, and 404s for a foreign id', async () => {
    const rowId = await insertAdminCert(colleagueEmail, NEW_PEM, { label: 'Ersatz' });
    const row = await db('admin_cert_fingerprints').where({ id: rowId }).first();
    const own = await db('admin_cert_fingerprints').where({ email: adminEmail }).first();
    await request(app)
      .delete(`${colleagueUrl(colleagueEmail)}/${own.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(code)
      .expect(404);
    await request(app)
      .delete(`${colleagueUrl(colleagueEmail)}/${row.id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(code)
      .expect(200);
    expect(sendAdminCertChangedEmail).toHaveBeenCalledWith(
      colleagueEmail,
      expect.objectContaining({ change: 'remove', byAdmin: adminEmail }),
    );
  });
});

describe('anomaly flag', () => {
  const row = (self: boolean) => ({
    id: String(self),
    timestamp: new Date('2026-01-05T10:00:00Z'),
    user_email: 'a@b.de',
    ip_address: '1.1.1.1',
    resource_type: 'AUTH',
    operation: 'CREATE',
    diff_json: { action: 'admin_certificate', self },
  });

  it('flags colleague changes as warning and self-service as info', () => {
    const flags = computeAnomalyFlags([row(false), row(true)]);
    expect(flags.get('false')).toContainEqual({ code: 'ADMIN_CHANGE', severity: 'warning' });
    expect(flags.get('true')).toContainEqual({ code: 'ADMIN_CHANGE', severity: 'info' });
  });
});
