/**
 * scope-revocation.test.ts – Ending every session of one instance's
 * organization scope (incident measure REMOVE_LOGINS): refresh tokens scoped
 * to the instance go, in the current value format and the legacy separate
 * scope key, personal sessions of the same user stay; access tokens of that
 * scope issued before the revocation are refused until they expire.
 * Dependencies: supertest, jsonwebtoken, uuid, app, db, redis.service,
 *               scope-revocation.service, helpers/allowListSites
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../app';
import { redis, setRefreshToken } from '../services/redis.service';
import { revokeInstanceSessions } from '../services/scope-revocation.service';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';

let site: Site;

function accessToken(scope: string | null, iat = Math.floor(Date.now() / 1000)): string {
  const privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString();
  return jwt.sign(
    {
      sub: site.userId,
      email: site.email,
      iat,
      ...(scope ? { kind: 'org', inst: scope } : {}),
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '15m' } as jwt.SignOptions,
  );
}

beforeAll(async () => {
  site = await seedSite({ label: 'scope-revoke' });
});

afterAll(async () => {
  await redis.del(`scope-revoked:${site.instanceId}`);
  await removeSites([site]);
});

describe('revokeInstanceSessions', () => {
  it('deletes refresh tokens of the scope in both formats and keeps personal ones', async () => {
    const scoped = uuidv4();
    const legacy = uuidv4();
    const personal = uuidv4();
    await setRefreshToken(scoped, site.userId, 600, site.instanceId);
    await setRefreshToken(legacy, site.userId, 600);
    await redis.setex(`refreshscope:${legacy}`, 600, site.instanceId);
    await setRefreshToken(personal, site.userId, 600);

    expect(await revokeInstanceSessions(site.instanceId)).toBe(2);

    expect(await redis.get(`refresh:${scoped}`)).toBeNull();
    expect(await redis.get(`refresh:${legacy}`)).toBeNull();
    expect(await redis.get(`refreshscope:${legacy}`)).toBeNull();
    expect(await redis.get(`refresh:${personal}`)).toBe(site.userId);
    await redis.del(`refresh:${personal}`);
  });

  it('refuses access tokens of the scope issued before the revocation', async () => {
    await redis.del(`scope-revoked:${site.instanceId}`);
    const before = accessToken(site.instanceId, Math.floor(Date.now() / 1000) - 5);
    const personal = accessToken(null, Math.floor(Date.now() / 1000) - 5);
    const get = (token: string) =>
      request(app).get('/api/v1/instances').set('Authorization', `Bearer ${token}`);
    expect((await get(before)).status).toBe(200);

    await revokeInstanceSessions(site.instanceId);

    expect((await get(before)).status).toBe(401);
    expect((await get(personal)).status).toBe(200);
    const ttl = await redis.ttl(`scope-revoked:${site.instanceId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15 * 60);
  });
});
