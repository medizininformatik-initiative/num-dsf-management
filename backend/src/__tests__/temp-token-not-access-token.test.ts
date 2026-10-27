/**
 * temp-token-not-access-token.test.ts – The 10-minute temp token that
 * /auth/verify-otp hands out before the TOTP step must not work as a bearer
 * access token; otherwise the first factor alone opens the API.
 * Dependencies: supertest, app, jsonwebtoken
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../app';

const privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString();
const email = `temp-token-${Date.now().toString(36)}@example.de`;

function tempToken(purpose: 'totp_required' | 'totp_setup'): string {
  return jwt.sign({ sub: uuidv4(), email, purpose }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '10m',
  } as jwt.SignOptions);
}

describe('temp tokens are not access tokens', () => {
  it.each(['totp_required', 'totp_setup'] as const)(
    'rejects a %s temp token as bearer',
    async (p) => {
      const res = await request(app)
        .get('/api/v1/instances')
        .set('Authorization', `Bearer ${tempToken(p)}`);
      expect(res.status).toBe(401);
    },
  );

  it('still accepts an access token', async () => {
    const access = jwt.sign({ sub: uuidv4(), email, amr: 'otp' }, privateKey, {
      algorithm: 'RS256',
      expiresIn: '15m',
    } as jwt.SignOptions);
    const res = await request(app)
      .get('/api/v1/instances')
      .set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
  });
});
