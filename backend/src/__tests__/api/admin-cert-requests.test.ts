/**
 * admin-cert-requests.test.ts – Four-eyes recovery of a colleague's admin
 * certificate: the request validates like an upload but activates nothing; only
 * a third admin (not requester, not target, other site than the requester)
 * approves; the first decision wins; reject / cancel / expiry after 7 days;
 * approval re-validates the certificate; the target logs in with the approved
 * certificate and not before; mails and audit/anomaly flags.
 * Dependencies: supertest, app, db, helpers/allowListSites, node-forge
 */
jest.mock('../../services/totp.service', () => ({
  ...jest.requireActual('../../services/totp.service'),
  verifyTotpCode: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../services/notification.service', () => ({
  ...jest.requireActual('../../services/notification.service'),
  sendAdminCertChangedEmail: jest.fn().mockResolvedValue(undefined),
  sendAdminCertRequestEmail: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import forge from 'node-forge';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';
import { signGrant } from '../../lib/adminGrants';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { makeCertPem, mtlsHeaders } from '../helpers/allowListSites';
import { sendAdminCertRequestEmail } from '../../services/notification.service';
import { expireStaleRequests } from '../../services/admin-cert-requests.service';
import { computeAnomalyFlags } from '../../services/auditAnomalies';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const A = { email: `cr-a-${sfx}@site-a.example.de`, id: uuidv4() }; // requester
const B = { email: `cr-b-${sfx}@site-b.example.de`, id: uuidv4() }; // target
const C = { email: `cr-c-${sfx}@site-c.example.de`, id: uuidv4() }; // eligible approver
const D = { email: `cr-d-${sfx}@site-a.example.de`, id: uuidv4() }; // same site as A
const PLAIN = { email: `cr-plain-${sfx}@example.de`, id: uuidv4() };
const all = [A, B, C, D, PLAIN];
const emails = all.map((u) => u.email);
const BASE = '/api/v1/admin/admin-cert-requests';
const colleagueUrl = `/api/v1/admin/users/${B.email}/certificates`;
const code = { totpCode: '123456' };
const mail = sendAdminCertRequestEmail as jest.Mock;
const token = (u: { email: string; id: string }) => `Bearer ${getTestToken(u.email, u.id)}`;

function pemWithValidity(cn: string, notBefore: Date, notAfter: Date): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '03';
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const attrs = [{ shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

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

const post = (url: string, u: { email: string; id: string }, body: object = code) =>
  request(app).post(url).set('Authorization', token(u)).send(body);

/** Open a request A -> B for a fresh certificate; returns its id and PEM. */
async function openRequest(cn: string): Promise<{ id: string; pem: string }> {
  const pem = makeCertPem(`${cn}.${sfx}`);
  const res = await post(colleagueUrl, A, { pem, ...code }).expect(201);
  return { id: res.body.data.id, pem };
}

beforeAll(async () => {
  for (const u of all) {
    await db('email_whitelist').insert({ id: uuidv4(), email: u.email, created_at: new Date() });
    await db('users').insert({
      id: u.id,
      email: u.email,
      totp_enabled: true,
      totp_secret: 'placeholder',
    });
  }
  for (const u of [A, B, C, D]) await grantAdmin(u.email);
});

afterAll(async () => {
  await db('audit_logs').whereIn('user_email', emails).del();
  await db('admin_cert_requests').whereIn('target_email', emails).del();
  await db('admin_cert_fingerprints').whereIn('email', emails).del();
  await db('admin_grants').whereIn('email', emails).del();
  await db('users').whereIn('email', emails).del();
  await db('email_whitelist').whereIn('email', emails).del();
});

beforeEach(() => mail.mockClear());

describe('POST /admin/users/:email/certificates (request)', () => {
  it('rejects a private key, a missing step-up, the own e-mail and a non-admin target', async () => {
    const pem = `${makeCertPem(`key.${sfx}`)}\n-----BEGIN PRIVATE${' '}KEY-----\nAAAA\n-----END PRIVATE KEY-----`;
    const key = await post(colleagueUrl, A, { pem, ...code }).expect(400);
    expect(key.body.error.code).toBe('PRIVATE_KEY_REJECTED');
    await post(colleagueUrl, A, { pem: makeCertPem(`x.${sfx}`) }).expect(400);
    const self = await post(`/api/v1/admin/users/${A.email}/certificates`, A, {
      pem: makeCertPem(`self.${sfx}`),
      ...code,
    }).expect(400);
    expect(self.body.error.code).toBe('USE_SELF_SERVICE');
    const plain = await post(`/api/v1/admin/users/${PLAIN.email}/certificates`, A, {
      pem: makeCertPem(`plain.${sfx}`),
      ...code,
    }).expect(400);
    expect(plain.body.error.code).toBe('NOT_AN_ADMIN');
    await post(colleagueUrl, PLAIN, { pem: makeCertPem(`np.${sfx}`), ...code }).expect(403);
    expect(await db('admin_cert_requests').where({ target_email: B.email })).toHaveLength(0);
  });

  it('creates a PENDING request, activates nothing, mails the target and audits it', async () => {
    const pem = makeCertPem(`created.${sfx}`);
    const res = await post(colleagueUrl, A, { pem, label: 'Ersatz', ...code }).expect(201);
    expect(res.body.data).toEqual({ id: expect.any(String), status: 'PENDING' });
    expect(
      await db('admin_cert_fingerprints').where({ fingerprint: sha512FingerprintFromPem(pem) }),
    ).toHaveLength(0);
    expect(mail).toHaveBeenCalledWith(
      [B.email],
      expect.objectContaining({ event: 'requested', requestedBy: A.email }),
    );
    const audit = await db('audit_logs')
      .where({ user_email: A.email, resource_id: res.body.data.id })
      .first();
    const diff =
      typeof audit.diff_json === 'string' ? JSON.parse(audit.diff_json) : audit.diff_json;
    expect(diff).toMatchObject({ action: 'admin_certificate_request', decision: 'request' });
    expect(JSON.stringify(diff)).not.toContain('BEGIN CERTIFICATE');
  });

  it('refuses a fingerprint that is already pending (409) or already active (409)', async () => {
    const { pem } = await openRequest('dup');
    const again = await post(colleagueUrl, A, { pem, ...code }).expect(409);
    expect(again.body.error.code).toBe('REQUEST_ALREADY_PENDING');
    const other = await post(colleagueUrl, D, { pem, ...code }).expect(409);
    expect(other.body.error.code).toBe('REQUEST_ALREADY_PENDING');

    const activePem = makeCertPem(`active.${sfx}`);
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: C.email,
      fingerprint: sha512FingerprintFromPem(activePem),
      created_at: new Date(),
      created_by: 'test',
    });
    const active = await post(colleagueUrl, A, { pem: activePem, ...code }).expect(409);
    expect(active.body.error.code).toBe('ADMIN_CERTIFICATE_IN_USE');
  });

  it('lists requests without the PEM', async () => {
    const res = await request(app).get(BASE).set('Authorization', token(C)).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain('BEGIN CERTIFICATE');
    expect(res.body.data[0]).toMatchObject({ targetEmail: B.email, status: 'PENDING' });
    await request(app).get(BASE).set('Authorization', token(PLAIN)).expect(403);
  });
});

describe('approval rules', () => {
  it('refuses requester, target and same-site admins; a non-admin is 403', async () => {
    const { id } = await openRequest('rules');
    const url = `${BASE}/${id}/approve`;
    expect((await post(url, A).expect(403)).body.error.code).toBe('SELF_APPROVE');
    expect((await post(url, B).expect(403)).body.error.code).toBe('TARGET_APPROVE');
    expect((await post(url, D).expect(403)).body.error.code).toBe('SAME_SITE');
    await post(url, PLAIN).expect(403);
    await post(url, C, {}).expect(400); // step-up missing
    const row = await db('admin_cert_requests').where({ id }).first();
    expect(row.status).toBe('PENDING');
  });

  it('a third admin from another site activates it; the target logs in only afterwards', async () => {
    const { id, pem } = await openRequest('approve');
    await request(app)
      .post('/auth/client-cert-login')
      .set(mtlsHeaders(pem))
      .expect((r) => {
        expect(r.status).not.toBe(200);
      });
    mail.mockClear();

    await post(`${BASE}/${id}/approve`, C).expect(200);
    const fp = await db('admin_cert_fingerprints')
      .where({ fingerprint: sha512FingerprintFromPem(pem) })
      .first();
    expect(fp).toMatchObject({ email: B.email, created_by: `request:${id}` });
    const row = await db('admin_cert_requests').where({ id }).first();
    expect(row).toMatchObject({ status: 'APPROVED', decided_by: C.email });
    expect(mail).toHaveBeenCalledWith(
      [A.email, B.email],
      expect.objectContaining({ event: 'approved', decidedBy: C.email }),
    );
    const audit = await db('audit_logs')
      .where({ user_email: C.email, operation: 'APPROVE', resource_id: id })
      .first();
    expect(audit).toBeDefined();

    await request(app).post('/auth/client-cert-login').set(mtlsHeaders(pem)).expect(200);
    // a second decision loses
    expect((await post(`${BASE}/${id}/approve`, C).expect(409)).body.error.code).toBe(
      'NOT_PENDING',
    );
  });

  it('the first decision wins when approve and reject race', async () => {
    const { id } = await openRequest('race');
    const [a, r] = await Promise.all([
      post(`${BASE}/${id}/approve`, C),
      post(`${BASE}/${id}/reject`, D, { comment: 'no', ...code }),
    ]);
    expect([a.status, r.status].sort()).toEqual([200, 409]);
    const row = await db('admin_cert_requests').where({ id }).first();
    expect(row.status).toBe(a.status === 200 ? 'APPROVED' : 'REJECTED');
    const active = await db('admin_cert_fingerprints').where({ created_by: `request:${id}` });
    expect(active).toHaveLength(a.status === 200 ? 1 : 0);
  });

  it('re-validates at approval: an expired certificate cannot be activated', async () => {
    const pem = pemWithValidity(
      `stale.${sfx}`,
      new Date(Date.now() - 20 * 86_400_000),
      new Date(Date.now() - 86_400_000),
    );
    const id = uuidv4();
    await db('admin_cert_requests').insert({
      id,
      target_email: B.email,
      fingerprint: sha512FingerprintFromPem(pem),
      pem,
      requested_by: A.email,
      status: 'PENDING',
      created_at: new Date(),
    });
    const res = await post(`${BASE}/${id}/approve`, C).expect(400);
    expect(res.body.error.code).toBe('CERTIFICATE_EXPIRED');
    expect((await db('admin_cert_requests').where({ id }).first()).status).toBe('PENDING');
    expect(await db('admin_cert_fingerprints').where({ created_by: `request:${id}` })).toHaveLength(
      0,
    );
  });

  it('refuses when the fingerprint became an active admin certificate meanwhile', async () => {
    const { id, pem } = await openRequest('taken');
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: C.email,
      fingerprint: sha512FingerprintFromPem(pem),
      created_at: new Date(),
      created_by: 'test',
    });
    const res = await post(`${BASE}/${id}/approve`, C).expect(409);
    expect(res.body.error.code).toBe('ADMIN_CERTIFICATE_IN_USE');
    expect((await db('admin_cert_requests').where({ id }).first()).status).toBe('PENDING');
  });
});

describe('reject, cancel and expiry', () => {
  it('rejects with a comment (required), mails both, and cannot be approved afterwards', async () => {
    const { id } = await openRequest('reject');
    await post(`${BASE}/${id}/reject`, C, { ...code }).expect(400);
    expect(
      (await post(`${BASE}/${id}/reject`, A, { comment: 'x', ...code }).expect(400)).body.error
        .code,
    ).toBe('USE_CANCEL');
    mail.mockClear();
    await post(`${BASE}/${id}/reject`, B, { comment: 'not mine', ...code }).expect(200);
    const row = await db('admin_cert_requests').where({ id }).first();
    expect(row).toMatchObject({ status: 'REJECTED', decided_by: B.email, comment: 'not mine' });
    expect(mail).toHaveBeenCalledWith(
      [A.email, B.email],
      expect.objectContaining({ event: 'rejected', comment: 'not mine' }),
    );
    expect((await post(`${BASE}/${id}/approve`, C).expect(409)).body.error.code).toBe(
      'NOT_PENDING',
    );
  });

  it('only the requester cancels', async () => {
    const { id } = await openRequest('cancel');
    expect((await post(`${BASE}/${id}/cancel`, D).expect(403)).body.error.code).toBe(
      'NOT_REQUESTER',
    );
    await post(`${BASE}/${id}/cancel`, A).expect(200);
    expect((await db('admin_cert_requests').where({ id }).first()).status).toBe('CANCELLED');
    await post(`${BASE}/${id}/cancel`, A).expect(409);
    await post(`${BASE}/${uuidv4()}/cancel`, A).expect(404);
  });

  it('expires pending requests after 7 days and leaves fresh ones', async () => {
    const old = await openRequest('old');
    const fresh = await openRequest('fresh');
    await db('admin_cert_requests')
      .where({ id: old.id })
      .update({ created_at: new Date(Date.now() - 8 * 86_400_000) });
    mail.mockClear();
    const n = await expireStaleRequests();
    expect(n).toBeGreaterThanOrEqual(1);
    const oldRow = await db('admin_cert_requests').where({ id: old.id }).first();
    expect(oldRow).toMatchObject({ status: 'CANCELLED', comment: 'expired' });
    expect((await db('admin_cert_requests').where({ id: fresh.id }).first()).status).toBe(
      'PENDING',
    );
    expect(mail).toHaveBeenCalledWith(
      expect.arrayContaining([A.email, B.email]),
      expect.objectContaining({ event: 'cancelled' }),
    );
    // an expired request can no longer be approved
    expect((await post(`${BASE}/${old.id}/approve`, C).expect(409)).body.error.code).toBe(
      'NOT_PENDING',
    );
  });
});

describe('colleague DELETE stays immediate', () => {
  it('removes an active certificate of the colleague without a second admin', async () => {
    const id = uuidv4();
    await db('admin_cert_fingerprints').insert({
      id,
      email: B.email,
      fingerprint: sha512FingerprintFromPem(makeCertPem(`del.${sfx}`)),
      created_at: new Date(),
      created_by: 'test',
    });
    await request(app)
      .delete(`${colleagueUrl}/${id}`)
      .set('Authorization', token(A))
      .send(code)
      .expect(200);
    expect(await db('admin_cert_fingerprints').where({ id })).toHaveLength(0);
  });
});

describe('anomaly flags', () => {
  const row = (decision: string) => ({
    id: decision,
    timestamp: new Date('2026-01-05T10:00:00Z'),
    user_email: 'a@b.de',
    ip_address: '1.1.1.1',
    resource_type: 'AUTH',
    operation: 'CREATE',
    diff_json: { action: 'admin_certificate_request', decision },
  });
  const loginRow = (change: string) => ({
    id: `login-${change}`,
    timestamp: new Date('2026-01-05T10:00:00Z'),
    user_email: 'a@b.de',
    ip_address: '1.1.1.1',
    resource_type: 'ORGANIZATION',
    operation: 'UPDATE',
    diff_json: { action: 'login_certificate', change },
  });

  it('request is info, approval is warning, enabling a login certificate is info', () => {
    const flags = computeAnomalyFlags([
      row('request'),
      row('approve'),
      loginRow('enable'),
      loginRow('disable'),
    ]);
    expect(flags.get('request')).toContainEqual({ code: 'ADMIN_CHANGE', severity: 'info' });
    expect(flags.get('approve')).toContainEqual({ code: 'ADMIN_CHANGE', severity: 'warning' });
    expect(flags.get('login-enable')).toContainEqual({ code: 'ADMIN_CHANGE', severity: 'info' });
    expect(flags.get('login-disable')).toBeUndefined();
  });
});
