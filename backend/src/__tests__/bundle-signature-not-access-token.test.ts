/**
 * bundle-signature-not-access-token.test.ts – Bundle signatures are RS256 JWTs
 * made with the same key as access tokens and are handed to every tenant
 * (X-Bundle-Signature, bundle_versions.signature). Neither an already published
 * signature ({ contentHash, timestamp }) nor any other token without string
 * `sub` and `email` claims may pass as a bearer access token.
 * Dependencies: supertest, app, jsonwebtoken, auth.service
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../app';
import { verifyAccessToken } from '../services/auth.service';

const privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString();

function sign(claims: object): string {
  return jwt.sign(claims, privateKey, { algorithm: 'RS256', expiresIn: '365d' } as jwt.SignOptions);
}

/** A signature as published before bundle signatures carried a purpose claim. */
const legacySignature = sign({ contentHash: 'a'.repeat(64), timestamp: new Date().toISOString() });

describe('bundle signatures are not access tokens', () => {
  it('rejects a published bundle signature as bearer on a plain API route', async () => {
    const res = await request(app)
      .get('/api/v1/instances')
      .set('Authorization', `Bearer ${legacySignature}`);
    expect(res.status).toBe(401);
  });

  it('rejects it on an instance route instead of reaching the ownership check', async () => {
    const res = await request(app)
      .get(`/api/v1/instances/${uuidv4()}/organization`)
      .set('Authorization', `Bearer ${legacySignature}`);
    expect(res.status).toBe(401);
  });

  it('verifyAccessToken requires string sub and email claims', () => {
    expect(() => verifyAccessToken(sign({ email: 'x@example.de' }))).toThrow();
    expect(() => verifyAccessToken(sign({ sub: uuidv4() }))).toThrow();
    expect(() => verifyAccessToken(sign({ sub: 42, email: 'x@example.de' }))).toThrow();
    const ok = verifyAccessToken(sign({ sub: 'u1', email: 'x@example.de', amr: 'otp' }));
    expect(ok.sub).toBe('u1');
  });
});
