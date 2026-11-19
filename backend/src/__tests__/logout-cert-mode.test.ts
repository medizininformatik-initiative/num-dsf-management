/**
 * logout-cert-mode.test.ts – In AUTH_MODE=cert, POST /auth/logout revokes the
 * refresh token only when the presented client certificate belongs to the
 * token's user. A stolen cookie alone (no cert, or someone else's cert) just
 * gets its cookie cleared and a success answer; the real session survives.
 * Dependencies: supertest, node-forge, app, db, auth.service, redis.service
 */
import request from 'supertest';
import forge from 'node-forge';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../app';
import { db } from '../db/connection';
import { createTokenPair } from '../services/auth.service';
import { getRefreshToken } from '../services/redis.service';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';

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

const sfx = uuidv4().slice(0, 8);
const OWNER_PEM = makeCert(`owner-${sfx}`);
const OTHER_PEM = makeCert(`other-${sfx}`);
const ownerEmail = `logout-cm-${sfx}@imi-test.example.de`;
const otherEmail = `logout-cm-other-${sfx}@imi-test.example.de`;
const ownerId = uuidv4();
const otherId = uuidv4();

const hdr = (pem: string) => ({
  'x-client-verify': 'SUCCESS',
  'x-client-cert': encodeURIComponent(pem),
});
const hashOf = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

describe('POST /auth/logout in cert mode', () => {
  const prevMode = process.env.AUTH_MODE;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'cert';
    for (const [id, email, pem] of [
      [ownerId, ownerEmail, OWNER_PEM],
      [otherId, otherEmail, OTHER_PEM],
    ]) {
      await db('users').insert({ id, email, totp_enabled: false, created_at: new Date() });
      await db('admin_cert_fingerprints').insert({
        id: uuidv4(),
        email,
        fingerprint: sha512FingerprintFromPem(pem),
        created_at: new Date(),
        created_by: 'test',
      });
    }
  });

  afterAll(async () => {
    if (prevMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prevMode;
    await db('audit_logs').whereIn('user_email', [ownerEmail, otherEmail]).del();
    await db('admin_cert_fingerprints').whereIn('email', [ownerEmail, otherEmail]).del();
    await db('users').whereIn('id', [ownerId, otherId]).del();
  });

  const mint = async () =>
    (
      await createTokenPair({
        id: ownerId,
        email: ownerEmail,
        totpEnabled: false,
        authMethod: 'cert',
      })
    ).refreshToken;

  it('does not revoke with the cookie alone, but still answers 200', async () => {
    const rt = await mint();
    const res = await request(app).post('/auth/logout').set('Cookie', `refreshToken=${rt}`);
    expect(res.status).toBe(200);
    expect(await getRefreshToken(hashOf(rt))).toBe(ownerId);
  });

  it("does not revoke with another user's certificate", async () => {
    const rt = await mint();
    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', `refreshToken=${rt}`)
      .set(hdr(OTHER_PEM));
    expect(res.status).toBe(200);
    expect(await getRefreshToken(hashOf(rt))).toBe(ownerId);
  });

  it('revokes with the owning certificate', async () => {
    const rt = await mint();
    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', `refreshToken=${rt}`)
      .set(hdr(OWNER_PEM));
    expect(res.status).toBe(200);
    expect(await getRefreshToken(hashOf(rt))).toBeNull();
  });
});
