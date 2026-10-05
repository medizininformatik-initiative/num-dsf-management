/**
 * cert-mode-access.test.ts – Access control of the certificate-only
 * deployment (AUTH_MODE=cert), exercised through the real Express app.
 *
 * Product requirements proven here:
 *  1. Nobody without a registered client certificate gets a session or any
 *     API data (OTP/TOTP routes refused, refresh needs the cert, every
 *     request re-binds the session to the certificate, revocation is
 *     immediate, spoofed headers do not count, a route sweep finds no open
 *     /api route).
 *  2. Admin actions (promotions) need an admin AND a cert-authenticated
 *     session with the certificate re-presented.
 *  3. The allow list is downloadable only with a certificate (GUI and /fhir).
 *
 * Dependencies: supertest, forge, app, db, auth.service, adminGrants
 */
import request from 'supertest';
import forge from 'node-forge';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../app';
import { db } from '../db/connection';
import { createTokenPair } from '../services/auth.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { signGrant } from '../lib/adminGrants';

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

const SITE_PEM = makeCert('site-cm.example.de');
const OTHER_PEM = makeCert('other-cm.example.de');
const ADMIN_PEM = makeCert('admin-cm.example.de');
const STRANGER_PEM = makeCert('stranger-cm.example.de');

const siteUserId = uuidv4();
const otherUserId = uuidv4();
const adminUserId = uuidv4();
const siteEmail = 'site-cm@example.de';
const otherEmail = 'other-cm@example.de';
const adminEmail = 'admin-cm@imi-test.example.de';
const siteInstanceId = uuidv4();
const otherInstanceId = uuidv4();
const siteOrg = 'site-cm.example.de';
const otherOrg = 'other-cm.example.de';

const certHeaders = (pem: string) => ({
  'x-client-verify': 'SUCCESS',
  'x-client-cert': encodeURIComponent(pem),
});

async function certToken(userId: string, email: string): Promise<string> {
  return (await createTokenPair({ id: userId, email, totpEnabled: true, authMethod: 'cert' }))
    .accessToken;
}

describe('certificate-only mode (AUTH_MODE=cert)', () => {
  const prevMode = process.env.AUTH_MODE;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'cert';
    for (const [id, email] of [
      [siteUserId, siteEmail],
      [otherUserId, otherEmail],
      [adminUserId, adminEmail],
    ]) {
      await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
      await db('users').insert({ id, email, totp_enabled: true, created_at: new Date() });
    }
    for (const [iid, uid, org, pem] of [
      [siteInstanceId, siteUserId, siteOrg, SITE_PEM],
      [otherInstanceId, otherUserId, otherOrg, OTHER_PEM],
    ]) {
      await db('instances').insert({ id: iid, user_id: uid, label: 'L', created_at: new Date() });
      await db('organizations').insert({
        identifier: org,
        instance_id: iid,
        name: org,
        email: 'a@b.de',
        active: true,
        client_cert_fingerprint: sha512FingerprintFromPem(pem),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
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
  });

  afterAll(async () => {
    if (prevMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevMode;
    await db('admin_grants').where({ email: adminEmail }).del();
    await db('admin_cert_fingerprints').where({ email: adminEmail }).del();
    await db('organizations').whereIn('identifier', [siteOrg, otherOrg]).del();
    await db('instances').whereIn('id', [siteInstanceId, otherInstanceId]).del();
    await db('users').whereIn('id', [siteUserId, otherUserId, adminUserId]).del();
    await db('email_whitelist').whereIn('email', [siteEmail, otherEmail, adminEmail]).del();
  });

  describe('req 1: no session and no data without a registered certificate', () => {
    it.each(['request-otp', 'verify-otp', 'verify-totp', 'setup-totp', 'confirm-totp'])(
      'POST /auth/%s is refused by the backend (403 OTP_DISABLED)',
      async (route) => {
        const res = await request(app).post(`/auth/${route}`).send({ email: siteEmail });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('OTP_DISABLED');
      },
    );

    it('refuses the OTP routes also with a trailing slash and other casing', async () => {
      expect((await request(app).post('/auth/Request-OTP/').send({})).status).toBe(403);
    });

    it('client-cert-login without a certificate gives no session', async () => {
      const res = await request(app).post('/auth/client-cert-login');
      expect(res.status).toBe(401);
      expect(res.body.data).toBeUndefined();
    });

    it('client-cert-login with an unregistered certificate gives no session', async () => {
      const res = await request(app).post('/auth/client-cert-login').set(certHeaders(STRANGER_PEM));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CERT_NOT_REGISTERED');
    });

    it('an OTP-style token (amr otp) is useless even with a valid certificate', async () => {
      const { accessToken } = await createTokenPair({
        id: siteUserId,
        email: siteEmail,
        totpEnabled: true,
      });
      const res = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${accessToken}`)
        .set(certHeaders(SITE_PEM));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CERT_REQUIRED');
    });

    it('a stolen cert token without the certificate is rejected', async () => {
      const token = await certToken(siteUserId, siteEmail);
      const res = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CERT_REQUIRED');
    });

    it('a spoofed X-Client-Cert without a verified handshake is rejected', async () => {
      const token = await certToken(siteUserId, siteEmail);
      const res = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${token}`)
        .set('x-client-cert', encodeURIComponent(SITE_PEM));
      expect(res.status).toBe(401);
    });

    it('a token presented with another site certificate is rejected', async () => {
      const token = await certToken(siteUserId, siteEmail);
      const res = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(OTHER_PEM));
      expect(res.status).toBe(401);
    });

    it('the token plus its own certificate works', async () => {
      const token = await certToken(siteUserId, siteEmail);
      const res = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(SITE_PEM));
      expect(res.status).toBe(200);
    });

    it('revoking the certificate ends the session on the next request', async () => {
      const token = await certToken(otherUserId, otherEmail);
      const ok = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(OTHER_PEM));
      expect(ok.status).toBe(200);
      await db('organizations').where({ identifier: otherOrg }).update({
        client_cert_fingerprint: null,
      });
      const after = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(OTHER_PEM));
      expect(after.status).toBe(401);
      await db('organizations')
        .where({ identifier: otherOrg })
        .update({ client_cert_fingerprint: sha512FingerprintFromPem(OTHER_PEM) });
    });

    it('a locked account is cut off even with its certificate', async () => {
      const token = await certToken(otherUserId, otherEmail);
      await db('email_whitelist').where({ email: otherEmail }).update({ locked_at: new Date() });
      const res = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(OTHER_PEM));
      expect(res.status).toBe(401);
      await db('email_whitelist').where({ email: otherEmail }).update({ locked_at: null });
    });

    it('refresh without the certificate fails and does not burn the token', async () => {
      const { refreshToken } = await createTokenPair({
        id: siteUserId,
        email: siteEmail,
        totpEnabled: true,
        authMethod: 'cert',
      });
      const bare = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${refreshToken}`);
      expect(bare.status).toBe(401);
      const wrong = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${refreshToken}`)
        .set(certHeaders(OTHER_PEM));
      expect(wrong.status).toBe(401);
      const good = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${refreshToken}`)
        .set(certHeaders(SITE_PEM));
      expect(good.status).toBe(200);
      const claims = jwt.decode(good.body.data.accessToken) as { amr?: string };
      expect(claims.amr).toBe('cert');
    });

    it('dev-login mints nothing in certificate mode (404)', async () => {
      const res = await request(app).post('/auth/dev-login').send({ role: 'admin' });
      expect(res.status).toBe(404);
    });

    it('route sweep: no /api route answers an unauthenticated request with anything but 401', async () => {
      interface Layer {
        route?: { path: string; methods: Record<string, boolean> };
        name?: string;
        regexp?: RegExp;
        handle?: { stack?: Layer[] };
      }
      const mountOf = (l: Layer): string =>
        l
          .regexp!.source.replace('^\\/?(?=\\/|$)', '')
          .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
          .replace(/^\^/, '')
          .replace(/\\\//g, '/')
          .split('(?:/([^/]+?))')
          .join('/x');
      const found: Array<{ method: string; path: string }> = [];
      const walk = (stack: Layer[], prefix: string) => {
        for (const l of stack) {
          if (l.route) {
            for (const m of Object.keys(l.route.methods)) {
              found.push({ method: m, path: prefix + (l.route.path === '/' ? '' : l.route.path) });
            }
          } else if (l.name === 'router' && l.handle?.stack) {
            walk(l.handle.stack, prefix + mountOf(l));
          }
        }
      };
      walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, '');
      const apiRoutes = found
        .filter((r) => r.path.startsWith('/api/'))
        .map((r) => ({ ...r, path: r.path.replace(/:\w+/g, 'x') }));
      expect(apiRoutes.length).toBeGreaterThan(40);
      const agent = request(app) as unknown as Record<string, (p: string) => request.Test>;
      const open: string[] = [];
      for (const r of apiRoutes) {
        const res = await agent[r.method](r.path);
        if (res.status !== 401) open.push(`${r.method.toUpperCase()} ${r.path} -> ${res.status}`);
      }
      expect(open).toEqual([]);
    });
  });

  describe('req 3: allow-list download only with a certificate', () => {
    it('GUI full bundle needs a cert-bound session', async () => {
      const token = await certToken(siteUserId, siteEmail);
      const bare = await request(app)
        .get('/api/v1/download/full-bundle')
        .set('Authorization', `Bearer ${token}`);
      expect(bare.status).toBe(401);
      const withCert = await request(app)
        .get('/api/v1/download/full-bundle')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(SITE_PEM));
      expect(withCert.status).toBe(200);
    });

    it('instance bundle: a site cannot download another site (403) and needs the cert', async () => {
      const token = await certToken(siteUserId, siteEmail);
      const bare = await request(app)
        .get(`/api/v1/instances/${siteInstanceId}/download/bundle?endpointId=e`)
        .set('Authorization', `Bearer ${token}`);
      expect(bare.status).toBe(401);
      const foreign = await request(app)
        .get(`/api/v1/instances/${otherInstanceId}/download/bundle?endpointId=e`)
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(SITE_PEM));
      expect(foreign.status).toBe(403);
      const history = await request(app)
        .get(`/api/v1/instances/${otherInstanceId}/bundle-history?endpointId=e`)
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(SITE_PEM));
      expect(history.status).toBe(403);
    });

    it('/fhir/Bundle: no certificate 401, unregistered certificate 403, spoofed header 401', async () => {
      expect((await request(app).get('/fhir/Bundle')).status).toBe(401);
      expect((await request(app).get('/fhir/Bundle').set(certHeaders(STRANGER_PEM))).status).toBe(
        403,
      );
      expect(
        (await request(app).get('/fhir/Bundle').set('x-client-cert', encodeURIComponent(SITE_PEM)))
          .status,
      ).toBe(401);
      expect((await request(app).get('/fhir/Bundle').set(certHeaders(SITE_PEM))).status).toBe(200);
    });

    it('/fhir history and versioned reads also need the certificate', async () => {
      expect((await request(app).get('/fhir/Bundle/e/_history')).status).toBe(401);
      expect((await request(app).get('/fhir/Bundle/e/_history/1')).status).toBe(401);
      expect((await request(app).get('/fhir/Bundle/e')).status).toBe(401);
    });

    it('the Excel IP list is admin only', async () => {
      const token = await certToken(siteUserId, siteEmail);
      const res = await request(app)
        .get('/api/v1/download/ip-address-list')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(SITE_PEM));
      expect(res.status).toBe(403);
    });
  });

  describe('req 2: admin actions need an admin with a re-presented certificate', () => {
    const adminRoutes: Array<[string, string]> = [
      ['post', '/api/v1/admin/promotions'],
      ['post', '/api/v1/admin/promotions/x/approve'],
      ['post', '/api/v1/admin/promotions/x/reject'],
      ['post', '/api/v1/admin/promotions/x/cancel'],
      ['post', '/api/v1/admin/users'],
      ['post', '/api/v1/admin/users/a@b.de/demote'],
      ['post', '/api/v1/admin/approval/x/approve'],
      ['post', '/api/v1/admin/ca-blacklist'],
      ['post', '/api/v1/admin/ca-whitelist'],
      ['post', '/api/v1/admin/bundle-versions/x/restore'],
      ['post', '/api/v1/admin/bundle-restores/x/approve'],
      ['post', '/api/v1/admin/bundle-restores/x/reject'],
      ['post', '/api/v1/admin/bundle-restores/x/cancel'],
      ['post', '/api/v1/admin/marketplace'],
      ['post', '/api/v1/admin/onboarding/import'],
    ];

    it.each(adminRoutes)('a site user (non-admin) gets 403 on %s %s', async (method, path) => {
      const token = await certToken(siteUserId, siteEmail);
      const agent = request(app) as unknown as Record<string, (p: string) => request.Test>;
      const res = await agent[method](path)
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(SITE_PEM))
        .send({});
      expect(res.status).toBe(403);
    });

    it('an admin session without the certificate is rejected before any admin logic', async () => {
      const token = await certToken(adminUserId, adminEmail);
      const res = await request(app)
        .post('/api/v1/admin/promotions')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetEmail: siteEmail });
      expect(res.status).toBe(401);
    });

    it('an admin session re-presenting a different (site) certificate is rejected', async () => {
      const token = await certToken(adminUserId, adminEmail);
      const res = await request(app)
        .post('/api/v1/admin/promotions')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(SITE_PEM))
        .send({ targetEmail: siteEmail });
      expect(res.status).toBe(401);
    });

    it('the onboarding import needs admin plus a cert step-up (no body TOTP path)', async () => {
      const token = await certToken(adminUserId, adminEmail);
      const bare = await request(app)
        .post('/api/v1/admin/onboarding/import')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/csv')
        .send('a,b');
      expect(bare.status).toBe(401);
    });

    it('an admin with the certificate passes authentication and step-up and reaches the service rule', async () => {
      const token = await certToken(adminUserId, adminEmail);
      const res = await request(app)
        .post('/api/v1/admin/promotions')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(ADMIN_PEM))
        .send({ targetEmail: siteEmail });
      // Reaches the promotion service (target is whitelisted and not an admin).
      expect(res.status).toBe(201);
      await db('admin_promotion_requests').where({ target_email: siteEmail }).del();
    });

    it('admin_grants are written only by the signed promotion path (no route inserts them)', async () => {
      const token = await certToken(adminUserId, adminEmail);
      const res = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .set(certHeaders(ADMIN_PEM))
        .send({ email: 'new-cm@example.de', makeAdmin: true, isAdmin: true });
      expect(res.status).toBeLessThan(500);
      expect(
        await db('admin_grants').where({ email: 'new-cm@example.de' }).first(),
      ).toBeUndefined();
      await db('email_whitelist').where({ email: 'new-cm@example.de' }).del();
    });
  });
});
