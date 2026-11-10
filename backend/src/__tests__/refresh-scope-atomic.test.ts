/**
 * refresh-scope-atomic.test.ts – An org-scoped session (organization login
 * certificate) must never refresh into an unscoped one. The scope lives in
 * the refresh record itself, so it cannot be lost on its own (a separate
 * refreshscope:<hash> key could expire, be evicted or be deleted while the
 * refresh record stays). revokeAllSessions still finds scoped records.
 * Dependencies: auth.service, redis.service, db
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { redis } from '../services/redis.service';
import { createTokenPair, refreshAccessToken, revokeAllSessions } from '../services/auth.service';

const hashOf = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const email = `refresh-scope-${Date.now().toString(36)}@example.de`;
const userId = uuidv4();
const instanceId = uuidv4();

beforeAll(async () => {
  await db('users').insert({ id: userId, email, totp_enabled: true });
  await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
});

afterAll(async () => {
  await revokeAllSessions({ id: userId });
  await db('email_whitelist').where({ email }).del();
  await db('users').where({ id: userId }).del();
});

const scopedPair = () =>
  createTokenPair({
    id: userId,
    email,
    totpEnabled: true,
    authMethod: 'cert',
    scopeInstanceId: instanceId,
  });

describe('org-scoped refresh records', () => {
  it('stay scoped when the separate scope key is gone', async () => {
    const { refreshToken } = await scopedPair();
    await redis.del(`refreshscope:${hashOf(refreshToken)}`);
    await expect(refreshAccessToken(refreshToken)).rejects.toThrow('CERT_REQUIRED');
  });

  it('are revoked by revokeAllSessions', async () => {
    const { refreshToken } = await scopedPair();
    expect(await revokeAllSessions({ id: userId })).toBeGreaterThanOrEqual(1);
    expect(await redis.get(`refresh:${hashOf(refreshToken)}`)).toBeNull();
  });
});
