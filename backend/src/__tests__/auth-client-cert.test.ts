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
 */
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import forge from 'node-forge';
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
      client_cert_fingerprint: sha512FingerprintFromPem(SAMPLE_PEM),
      created_at: new Date(),
      updated_at: new Date(),
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
  const adminEmail = 'cert-admin@imi.uni-muenster.de';
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
      client_cert_fingerprint: orgFingerprint,
      created_at: new Date(),
      updated_at: new Date(),
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

  it('200 with a session for the org owner when the fingerprint matches organizations.client_cert_fingerprint', async () => {
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
