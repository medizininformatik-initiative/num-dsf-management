/**
 * redis.service.ts – Redis connection and base functions
 * Key prefixes:
 *   otp:{email}              – pending OTP (TTL 10 min)
 *   refresh:{tokenHash}      – active refresh tokens (TTL 7 d)
 *   ratelimit:{ip|key}       – express-rate-limit Redis store
 *   totp_used:{sha256}       – anti-replay window for TOTP codes (TTL 120 s)
 *   activity:{userId}        – last-activity heartbeat for idle-timeout
 *                              (TTL = idle window, refreshed in auth middleware)
 * Depends on: REDIS_URL env var
 */
import Redis from 'ioredis';
import { logger } from '../lib/logger';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));

export async function testRedisConnection(): Promise<void> {
  await redis.ping();
}

// OTP helpers
export async function setOtp(email: string, hashedCode: string, ttlSeconds = 600): Promise<void> {
  await redis.setex(`otp:${email}`, ttlSeconds, hashedCode);
}

export async function getOtp(email: string): Promise<string | null> {
  return redis.get(`otp:${email}`);
}

export async function deleteOtp(email: string): Promise<void> {
  await redis.del(`otp:${email}`);
}

// Refresh Token helpers
//
// Value of refresh:{tokenHash}: the userId, or `<userId>|org:<instanceId>` for
// an org-scoped session (organization login certificate). The scope lives in
// the same value, so it can never be lost on its own and a refresh can never
// widen it. Records written before that kept the scope in a separate
// refreshscope:{tokenHash} key; it is still read for them until they expire.
const SCOPE_SEPARATOR = '|org:';

export function parseRefreshValue(
  value: string | null,
): { userId: string; scopeInstanceId: string | null } | null {
  if (!value) return null;
  const at = value.indexOf(SCOPE_SEPARATOR);
  if (at === -1) return { userId: value, scopeInstanceId: null };
  return {
    userId: value.slice(0, at),
    scopeInstanceId: value.slice(at + SCOPE_SEPARATOR.length) || null,
  };
}

export async function setRefreshToken(
  tokenHash: string,
  userId: string,
  ttlSeconds: number,
  scopeInstanceId?: string,
): Promise<void> {
  const value = scopeInstanceId ? `${userId}${SCOPE_SEPARATOR}${scopeInstanceId}` : userId;
  await redis.setex(`refresh:${tokenHash}`, ttlSeconds, value);
}

/** The user id of a refresh record, or null. */
export async function getRefreshToken(tokenHash: string): Promise<string | null> {
  return parseRefreshValue(await redis.get(`refresh:${tokenHash}`))?.userId ?? null;
}

/** User id and scope of a refresh record (legacy separate scope key as fallback). */
export async function getRefreshRecord(
  tokenHash: string,
): Promise<{ userId: string; scopeInstanceId: string | null } | null> {
  const record = parseRefreshValue(await redis.get(`refresh:${tokenHash}`));
  if (!record) return null;
  if (record.scopeInstanceId) return record;
  return { ...record, scopeInstanceId: await redis.get(`refreshscope:${tokenHash}`) };
}

export async function deleteRefreshToken(tokenHash: string): Promise<void> {
  await redis.del(`refresh:${tokenHash}`, `refreshscope:${tokenHash}`);
}
