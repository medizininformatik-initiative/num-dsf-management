/**
 * automation-contract.test.ts – Guards the documented site automation flow
 * (docs/automation.md, scripts/site-cert-renew.sh): certificate login -> list
 * instances -> list certificates -> renew -> submit approval -> status.
 * The documented response fields must keep existing (stability promise).
 * Dependencies: supertest, node-forge, app, db
 */
import request from 'supertest';
import forge from 'node-forge';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';

const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const orgId = `auto-${sfx}.example.de`;
const userId = uuidv4();
const email = `auto-${sfx}@example.de`;
const instanceId = uuidv4();
const oldCertId = uuidv4();

function makeCert(cn: string, days: number): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + days * 86400_000);
  const attrs = [
    { shortName: 'CN', value: cn },
    { shortName: 'O', value: `AutoTestCA-${sfx}` },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return forge.pki.certificateToPem(cert);
}

const OLD_PEM = makeCert(`old.${orgId}`, 10);
const NEW_PEM = makeCert(`new.${orgId}`, 365);
const certHeaders = (pem: string) => ({
  'x-client-verify': 'SUCCESS',
  'x-client-cert': encodeURIComponent(pem),
});

describe('site automation contract', () => {
  const prevMode = process.env.AUTH_MODE;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'cert';
    await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
    await db('users').insert({ id: userId, email, totp_enabled: true, created_at: new Date() });
    await db('instances').insert({
      id: instanceId,
      user_id: userId,
      label: 'automation',
      created_at: new Date(),
    });
    await db('organizations').insert({
      identifier: orgId,
      instance_id: instanceId,
      name: 'Automation Test',
      active: true,
      email: `admin@${orgId}`,
      address_line: 'Test Street 1',
      postal_code: '12345',
      city: 'Teststadt',
      country_code: 'DE',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('certificates').insert({
      id: oldCertId,
      organization_id: orgId,
      pem: OLD_PEM,
      subject: `CN=old.${orgId}`,
      thumbprint: 'A'.repeat(64),
      valid_until: new Date(Date.now() + 10 * 86400_000),
      created_at: new Date(),
      uploaded_by: 'test',
      uploaded_by_admin: 0,
      publish_in_allowlist: 1,
      use_for_login: 1,
    });
    await db('org_login_certificates').insert({
      fingerprint: sha512FingerprintFromPem(OLD_PEM),
      organization_id: orgId,
      certificate_id: oldCertId,
      source: 'ADMIN',
      created_by: 'test',
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    if (prevMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevMode;
    await db('audit_logs').where({ instance_id: instanceId }).del();
    await db('approval_requests').where({ instance_id: instanceId }).del();
    await db('org_login_certificates').where({ organization_id: orgId }).del();
    await db('certificates').where({ organization_id: orgId }).del();
    await db('organizations').where({ identifier: orgId }).del();
    await db('instances').where({ id: instanceId }).del();
    await db('users').where({ id: userId }).del();
    await db('email_whitelist').where({ email }).del();
  });

  it('login -> instances -> certificates -> renew -> submit -> status', async () => {
    const h = certHeaders(OLD_PEM);

    const login = await request(app).post('/auth/client-cert-login').set(h);
    expect(login.status).toBe(200);
    expect(typeof login.body.data.accessToken).toBe('string');
    const auth = { ...h, Authorization: `Bearer ${login.body.data.accessToken}` };

    const instances = await request(app).get('/api/v1/instances').set(auth);
    expect(instances.status).toBe(200);
    expect(instances.body.data).toHaveLength(1);
    expect(instances.body.data[0].id).toBe(instanceId);

    const certs = await request(app).get(`/api/v1/instances/${instanceId}/certificates`).set(auth);
    expect(certs.status).toBe(200);
    const current = certs.body.data.find(
      (c: { thumbprintSha512: string }) => c.thumbprintSha512 === sha512FingerprintFromPem(OLD_PEM),
    );
    expect(current).toBeDefined();
    for (const f of [
      'id',
      'subject',
      'thumbprint',
      'thumbprintSha512',
      'valid_until',
      'publishInAllowlist',
      'useForLogin',
    ]) {
      expect(current).toHaveProperty(f);
    }
    expect(current.pem).toBeUndefined();

    const renewed = await request(app)
      .post(`/api/v1/instances/${instanceId}/certificates/${current.id}/renew`)
      .set(auth)
      .send({ pem: NEW_PEM });
    expect(renewed.status).toBe(200);
    expect(renewed.body.data.id).not.toBe(current.id);
    expect(renewed.body.data.thumbprintSha512).toBe(sha512FingerprintFromPem(NEW_PEM));
    expect(renewed.body.data.publishInAllowlist).toBe(true);
    expect(renewed.body.data.useForLogin).toBe(true);

    // The old certificate keeps working as a login until it expires.
    const stillOk = await request(app).get('/api/v1/instances').set(auth);
    expect(stillOk.status).toBe(200);

    const submitted = await request(app)
      .post(`/api/v1/instances/${instanceId}/approval/submit`)
      .set(auth);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('PENDING');

    const status = await request(app)
      .get(`/api/v1/instances/${instanceId}/approval/status`)
      .set(auth);
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('PENDING');
    expect(status.body.data.fourEyes).toEqual(
      expect.objectContaining({ approvals: 0, required: 2 }),
    );

    const again = await request(app)
      .post(`/api/v1/instances/${instanceId}/approval/submit`)
      .set(auth);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('APPROVAL_ALREADY_PENDING');
  });

  it('documented errors: no certificate, private key in PEM', async () => {
    const none = await request(app).post('/auth/client-cert-login');
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('NO_CLIENT_CERT');

    const h = certHeaders(OLD_PEM);
    const login = await request(app).post('/auth/client-cert-login').set(h);
    const auth = { ...h, Authorization: `Bearer ${login.body.data.accessToken}` };
    const certs = await request(app).get(`/api/v1/instances/${instanceId}/certificates`).set(auth);
    const anyId = certs.body.data[0].id;
    const bad = await request(app)
      .post(`/api/v1/instances/${instanceId}/certificates/${anyId}/renew`)
      .set(auth)
      .send({ pem: `${NEW_PEM}\n-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n` });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('PRIVATE_KEY_REJECTED');
  });
});
