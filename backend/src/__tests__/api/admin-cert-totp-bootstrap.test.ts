/**
 * admin-cert-totp-bootstrap.test.ts – an admin who signs in by certificate for
 * the first time must be able to enrol TOTP. The user row created at that
 * first login starts with totp_enabled=false; an older broken row (enabled but
 * no secret) is treated as not enrolled: gated, and /me/totp/setup works
 * without a code. Through the real Express app, AUTH_MODE=cert.
 * Dependencies: supertest, node-forge, app, db, auth.service
 */
import request from 'supertest';
import forge from 'node-forge';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { createTokenPair, resolveCertLogin } from '../../services/auth.service';
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

const stamp = `${Date.now()}-${uuidv4().slice(0, 4)}`;
const FRESH_PEM = makeCert(`admin-fresh-${stamp}`);
const BROKEN_PEM = makeCert(`admin-broken-${stamp}`);
const freshEmail = `admin-fresh-${stamp}@imi-test.example.de`;
const brokenEmail = `admin-broken-${stamp}@imi-test.example.de`;
const brokenId = uuidv4();

async function addAdminCert(email: string, pem: string): Promise<void> {
  await db('admin_cert_fingerprints').insert({
    id: uuidv4(),
    email,
    fingerprint: sha512FingerprintFromPem(pem),
    created_at: new Date(),
    created_by: 'test',
  });
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(email, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
}

describe('admin certificate first login and TOTP enrolment', () => {
  const prevMode = process.env.AUTH_MODE;
  const prevAuto = process.env.DEV_AUTO_LOGIN;
  const prevBypass = process.env.DEV_TOTP_BYPASS;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'cert';
    delete process.env.DEV_AUTO_LOGIN;
    delete process.env.DEV_TOTP_BYPASS;
    await db('email_whitelist').insert({ id: uuidv4(), email: freshEmail, created_at: new Date() });
    await db('email_whitelist').insert({
      id: uuidv4(),
      email: brokenEmail,
      created_at: new Date(),
    });
    await db('users').insert({
      id: brokenId,
      email: brokenEmail,
      totp_enabled: true,
      totp_secret: null,
      created_at: new Date(),
    });
    await addAdminCert(freshEmail, FRESH_PEM);
    await addAdminCert(brokenEmail, BROKEN_PEM);
  });

  afterAll(async () => {
    if (prevMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevMode;
    if (prevAuto !== undefined) process.env.DEV_AUTO_LOGIN = prevAuto;
    if (prevBypass !== undefined) process.env.DEV_TOTP_BYPASS = prevBypass;
    const emails = [freshEmail, brokenEmail];
    await db('admin_grants').whereIn('email', emails).del();
    await db('admin_cert_fingerprints').whereIn('email', emails).del();
    await db('users').whereIn('email', emails).del();
    await db('email_whitelist').whereIn('email', emails).del();
  });

  it('creates the user of a first admin certificate login without TOTP enabled', async () => {
    const resolved = await resolveCertLogin(sha512FingerprintFromPem(FRESH_PEM));
    expect(resolved?.kind).toBe('admin');
    const row = await db('users').where({ email: freshEmail }).first();
    expect(Boolean(row.totp_enabled)).toBe(false);
  });

  it('lets that admin start the enrolment without a code', async () => {
    const user = await db('users').where({ email: freshEmail }).first();
    const token = (
      await createTokenPair({
        id: user.id,
        email: freshEmail,
        totpEnabled: false,
        authMethod: 'cert',
      })
    ).accessToken;
    const headers = {
      Authorization: `Bearer ${token}`,
      'x-client-verify': 'SUCCESS',
      'x-client-cert': encodeURIComponent(FRESH_PEM),
    };
    const status = await request(app).get('/api/v1/me/totp/status').set(headers);
    expect(status.body.data).toMatchObject({ enabled: false, enrolmentRequired: true });
    const setup = await request(app).post('/api/v1/me/totp/setup').set(headers).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.data.secret).toBeTruthy();
  });

  it('treats an enabled row without a secret as not enrolled and allows the setup', async () => {
    const token = (
      await createTokenPair({
        id: brokenId,
        email: brokenEmail,
        totpEnabled: true,
        authMethod: 'cert',
      })
    ).accessToken;
    const headers = {
      Authorization: `Bearer ${token}`,
      'x-client-verify': 'SUCCESS',
      'x-client-cert': encodeURIComponent(BROKEN_PEM),
    };
    const gated = await request(app).get('/api/v1/instances').set(headers);
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('TOTP_ENROLMENT_REQUIRED');
    const status = await request(app).get('/api/v1/me/totp/status').set(headers);
    expect(status.body.data).toMatchObject({ enabled: false, enrolmentRequired: true });
    const setup = await request(app).post('/api/v1/me/totp/setup').set(headers).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.data.secret).toBeTruthy();
  });
});
