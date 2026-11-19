/**
 * auth-client-cert.test.ts – Contract tests for POST /auth/client-cert-login.
 * - 401 with no cert header
 * - 401 with cert whose thumbprint matches no org
 * - 200 with a cert whose thumbprint matches a seeded org (and access token returned)
 *
 * Also covers SHA-512 fingerprint resolution (resolveCertLogin): a fingerprint
 * registered in admin_cert_fingerprints logs in as that admin, one registered
 * on organizations.client_cert_fingerprint logs in as the org's user, an
 * unknown fingerprint is a 401, and the X-Client-Verify guard still rejects
 * before any DB lookup runs.
 *
 * Also covers the amr ("authentication method reference") claim: a
 * client-cert login mints an access token with amr:'cert', and /auth/refresh
 * preserves 'cert' only when the cert headers are re-presented and still
 * resolve to the same user, otherwise falling back to 'otp'.
 */
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import forge from 'node-forge';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { db } from '../db/connection';
import * as dbConnection from '../db/connection';
import { authRouter } from '../routes/auth.routes';
import { v4 as uuidv4 } from 'uuid';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';

// Real (forge-generated) self-signed certs. resolveCertLogin computes a
// SHA-512 fingerprint by parsing the cert (lib/certFingerprint), which a
// hand-crafted/truncated DER blob cannot survive — unlike a thumbprint's
// raw-byte SHA-256, this is not a hash over arbitrary bytes.
function makeSelfSignedCert(cn: string): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attrs = [{ shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return forge.pki.certificateToPem(cert);
}

const SAMPLE_PEM = makeSelfSignedCert('cert-login-test.example.de');
const OTHER_PEM = makeSelfSignedCert('other-cert-login-test.example.de');

function thumbprintOf(pem: string): string {
  const der = Buffer.from(
    pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, ''),
    'base64',
  );
  return crypto.createHash('sha256').update(der).digest('hex');
}

function appWith() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}

// Same as appWith() plus cookie-parser (mirrors app.ts) — /auth/refresh reads
// req.cookies.refreshToken, which only exists once cookie-parser has run.
function appWithCookies() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  return app;
}

describe('POST /auth/client-cert-login', () => {
  const userId = uuidv4();
  const instanceId = uuidv4();
  const orgIdentifier = 'cert-login-test.example.de';
  const tp = thumbprintOf(SAMPLE_PEM);

  const ownerEmail = 'cert-user@example.de';

  beforeAll(async () => {
    await db('users').insert({ id: userId, email: ownerEmail, created_at: new Date() });
    await db('email_whitelist').insert({ id: uuidv4(), email: ownerEmail, created_at: new Date() });
    await db('instances').insert({
      id: instanceId,
      user_id: userId,
      label: 'L',
      created_at: new Date(),
    });
    await db('organizations').insert({
      identifier: orgIdentifier,
      instance_id: instanceId,
      name: 'CertLogin',
      email: 'a@b.de',
      active: true,
      client_cert_thumbprint: tp,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('org_login_certificates').insert({
      fingerprint: sha512FingerprintFromPem(SAMPLE_PEM),
      organization_id: orgIdentifier,
      certificate_id: null,
      source: 'ADMIN',
      created_by: 'test',
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    await db('organizations').where({ identifier: orgIdentifier }).del();
    await db('instances').where({ id: instanceId }).del();
    await db('users').where({ id: userId }).del();
    await db('email_whitelist').where({ email: ownerEmail }).del();
  });

  it('401 without cert header', async () => {
    const res = await request(appWith()).post('/auth/client-cert-login');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_CLIENT_CERT');
  });

  it('401 PROXY_NOT_TRUSTED when certificate headers come without a valid X-Proxy-Auth', async () => {
    process.env.CLIENT_CERT_PROXY_SECRET = 'p'.repeat(40);
    try {
      const headers = {
        'x-client-verify': 'SUCCESS',
        'x-client-cert': encodeURIComponent(SAMPLE_PEM),
      };
      const missing = await request(appWith()).post('/auth/client-cert-login').set(headers);
      expect(missing.status).toBe(401);
      expect(missing.body.error.code).toBe('PROXY_NOT_TRUSTED');
      const wrong = await request(appWith())
        .post('/auth/client-cert-login')
        .set({ ...headers, 'x-proxy-auth': 'nope' });
      expect(wrong.body.error.code).toBe('PROXY_NOT_TRUSTED');
      expect(JSON.stringify(wrong.body)).not.toContain('nope');
      // No certificate headers at all (the proxy did not see a certificate): still NO_CLIENT_CERT.
      const none = await request(appWith())
        .post('/auth/client-cert-login')
        .set('x-proxy-auth', 'p'.repeat(40));
      expect(none.body.error.code).toBe('NO_CLIENT_CERT');
    } finally {
      delete process.env.CLIENT_CERT_PROXY_SECRET;
    }
  });

  it('401 when a cert is presented but nginx verification did not succeed', async () => {
    const res = await request(appWith())
      .post('/auth/client-cert-login')
      .set('x-client-cert', encodeURIComponent(SAMPLE_PEM)); // no X-Client-Verify
    expect(res.status).toBe(401);
    // Rejected as "no cert" before any thumbprint lookup, so a spoofed
    // X-Client-Cert can never authenticate as the matching org.
    expect(res.body.error.code).toBe('NO_CLIENT_CERT');
  });

  it('401 when thumbprint does not match any org', async () => {
    const res = await request(appWith())
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(OTHER_PEM));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CERT_NOT_REGISTERED');
  });

  it('200 when thumbprint matches a registered org', async () => {
    const res = await request(appWith())
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(SAMPLE_PEM));
    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.email).toBe(ownerEmail);
  });

  it('rejects locked emails (account locked → 401)', async () => {
    await db('email_whitelist')
      .where({ email: ownerEmail })
      .update({ locked_at: new Date(), locked_by: 'test', locked_reason: 'test' });
    const res = await request(appWith())
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(SAMPLE_PEM));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    await db('email_whitelist')
      .where({ email: ownerEmail })
      .update({ locked_at: null, locked_by: null, locked_reason: null });
  });
});

describe('POST /auth/client-cert-login — SHA-512 fingerprint resolution', () => {
  const adminEmail = 'cert-admin@imi-test.example.de';
  const orgUserId = uuidv4();
  const orgInstanceId = uuidv4();
  const orgIdentifier = 'cert-fp-org.example.de';
  const orgOwnerEmail = 'cert-fp-org-user@example.de';

  const adminPem = makeSelfSignedCert('cert-admin.example.de');
  const orgPem = makeSelfSignedCert('cert-fp-org.example.de');
  const unknownPem = makeSelfSignedCert('unknown-cert.example.de');

  const adminFingerprint = sha512FingerprintFromPem(adminPem);
  const orgFingerprint = sha512FingerprintFromPem(orgPem);

  beforeAll(async () => {
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: adminEmail,
      fingerprint: adminFingerprint,
      created_at: new Date(),
      created_by: 'test',
    });
    // A certificate login does not whitelist; the admin must already be on it.
    await db('email_whitelist')
      .insert({ id: uuidv4(), email: adminEmail, created_at: new Date() })
      .onConflict('email')
      .ignore();

    await db('users').insert({ id: orgUserId, email: orgOwnerEmail, created_at: new Date() });
    await db('email_whitelist').insert({
      id: uuidv4(),
      email: orgOwnerEmail,
      created_at: new Date(),
    });
    await db('instances').insert({
      id: orgInstanceId,
      user_id: orgUserId,
      label: 'L2',
      created_at: new Date(),
    });
    await db('organizations').insert({
      identifier: orgIdentifier,
      instance_id: orgInstanceId,
      name: 'CertFpOrg',
      email: 'b@c.de',
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('org_login_certificates').insert({
      fingerprint: orgFingerprint,
      organization_id: orgIdentifier,
      certificate_id: null,
      source: 'ADMIN',
      created_by: 'test',
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    await db('admin_cert_fingerprints').where({ email: adminEmail }).del();
    await db('users').where({ email: adminEmail }).del();
    await db('email_whitelist').where({ email: adminEmail }).del();

    await db('organizations').where({ identifier: orgIdentifier }).del();
    await db('instances').where({ id: orgInstanceId }).del();
    await db('users').where({ id: orgUserId }).del();
    await db('email_whitelist').where({ email: orgOwnerEmail }).del();
  });

  it('200 with a session for the admin email when the fingerprint matches admin_cert_fingerprints', async () => {
    const res = await request(appWith())
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(adminPem));
    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.email).toBe(adminEmail);
  });

  it('200 with a session for the org owner when the fingerprint is an org login certificate', async () => {
    const res = await request(appWith())
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(orgPem));
    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.email).toBe(orgOwnerEmail);
  });

  it('401 when the fingerprint matches neither an admin nor an organization', async () => {
    const res = await request(appWith())
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(unknownPem));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('CERT_NOT_REGISTERED');
  });

  it('401 without querying the DB when X-Client-Verify is not SUCCESS', async () => {
    const dbSpy = jest.spyOn(dbConnection, 'db');
    // Cert would match the seeded admin fingerprint, but is presented without
    // the nginx verify header — the guard must reject before any DB lookup.
    const res = await request(appWith())
      .post('/auth/client-cert-login')
      .set('x-client-cert', encodeURIComponent(adminPem));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_CLIENT_CERT');
    expect(dbSpy).not.toHaveBeenCalled();
    dbSpy.mockRestore();
  });
});

describe('POST /auth/client-cert-login — amr claim, carried through /auth/refresh', () => {
  const amrAdminEmail = 'cert-amr-admin@imi-test.example.de';
  const amrPem = makeSelfSignedCert('cert-amr-admin.example.de');
  const amrFingerprint = sha512FingerprintFromPem(amrPem);

  beforeAll(async () => {
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: amrAdminEmail,
      fingerprint: amrFingerprint,
      created_at: new Date(),
      created_by: 'test',
    });
    await db('email_whitelist')
      .insert({ id: uuidv4(), email: amrAdminEmail, created_at: new Date() })
      .onConflict('email')
      .ignore();
  });

  afterAll(async () => {
    await db('admin_cert_fingerprints').where({ email: amrAdminEmail }).del();
    await db('users').where({ email: amrAdminEmail }).del();
    await db('email_whitelist').where({ email: amrAdminEmail }).del();
  });

  it('mints an access token with amr:"cert"', async () => {
    const res = await request(appWithCookies())
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(amrPem));
    expect(res.status).toBe(200);
    const decoded = jwt.decode(res.body.data.accessToken) as { amr?: string } | null;
    expect(decoded?.amr).toBe('cert');
  });

  it('keeps amr:"cert" on /auth/refresh when the cert headers are re-presented', async () => {
    const agent = request.agent(appWithCookies());
    const loginRes = await agent
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(amrPem));
    expect(loginRes.status).toBe(200);

    const refreshRes = await agent
      .post('/auth/refresh')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(amrPem));
    expect(refreshRes.status).toBe(200);
    const decoded = jwt.decode(refreshRes.body.data.accessToken) as { amr?: string } | null;
    expect(decoded?.amr).toBe('cert');
  });

  it('falls back to amr:"otp" on /auth/refresh without the cert headers', async () => {
    const agent = request.agent(appWithCookies());
    const loginRes = await agent
      .post('/auth/client-cert-login')
      .set('x-client-verify', 'SUCCESS')
      .set('x-client-cert', encodeURIComponent(amrPem));
    expect(loginRes.status).toBe(200);

    const refreshRes = await agent.post('/auth/refresh'); // no cert headers this time
    expect(refreshRes.status).toBe(200);
    const decoded = jwt.decode(refreshRes.body.data.accessToken) as { amr?: string } | null;
    expect(decoded?.amr).toBe('otp');
  });
});
