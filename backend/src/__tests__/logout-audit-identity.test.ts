/**
 * logout-audit-identity.test.ts – POST /auth/logout records a LOGOUT for the
 * owner of the refresh token, taken from its Redis record, never for an
 * e-mail the caller writes into the body; an unknown or already revoked token
 * records nothing.
 * Dependencies: supertest, app, db, auth.service (createTokenPair)
 */
import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../app';
import { db } from '../db/connection';
import { createTokenPair } from '../services/auth.service';

const sfx = `${Date.now().toString(36)}-${uuidv4().slice(0, 6)}`;
const ownerEmail = `logout-owner-${sfx}@example.de`;
const victimEmail = `logout-victim-${sfx}@example.de`;
const userId = uuidv4();

const logouts = (email: string) =>
  db('audit_logs').where({ user_email: email, operation: 'LOGOUT' }).count('id as n').first();

beforeAll(async () => {
  await db('users').insert({ id: userId, email: ownerEmail, totp_enabled: true });
});

afterAll(async () => {
  await db('audit_logs').whereIn('user_email', [ownerEmail, victimEmail]).del();
  await db('users').where({ id: userId }).del();
});

describe('POST /auth/logout audit identity', () => {
  it('logs the token owner, not the e-mail in the body', async () => {
    const { refreshToken } = await createTokenPair({
      id: userId,
      email: ownerEmail,
      totpEnabled: true,
    });
    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', `refreshToken=${refreshToken}`)
      .send({ email: victimEmail });
    expect(res.status).toBe(200);
    expect(Number((await logouts(ownerEmail))?.n)).toBe(1);
    expect(Number((await logouts(victimEmail))?.n)).toBe(0);
  });

  it('logs nothing for an unknown refresh token', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', `refreshToken=${crypto.randomBytes(48).toString('hex')}`)
      .send({ email: victimEmail });
    expect(res.status).toBe(200);
    expect(Number((await logouts(victimEmail))?.n)).toBe(0);
  });
});
