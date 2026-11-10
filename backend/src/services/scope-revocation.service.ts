/**
 * scope-revocation.service.ts – End every session of one instance's
 * organization scope (organization certificate login), whoever owns the
 * instance: used when an incident removes a site's logins. The owner's
 * personal sessions are not touched.
 * - Refresh tokens: refresh:<hash> values `<userId>|org:<instanceId>` and the
 *   legacy refresh:<hash> + refreshscope:<hash> pairs are deleted.
 * - Access tokens cannot be deleted; scope-revoked:<instanceId> holds the
 *   revocation time for one access-token lifetime, and requireAuth refuses
 *   kind:'org' tokens of that instance issued before it.
 * Dependencies: redis.service
 */
import { parseRefreshValue, redis } from './redis.service';

const REVOKED_PREFIX = 'scope-revoked:';

/** Access-token lifetime in seconds (JWT_EXPIRES_IN like '15m'); one day when unreadable. */
export function accessTokenTtlSeconds(raw = process.env.JWT_EXPIRES_IN || '15m'): number {
  const match = /^(\d+)\s*([smhd]?)$/.exec(raw.trim());
  if (!match) return 86_400;
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as '' | 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}

async function scanKeys(pattern: string): Promise<string[]> {
  const keys = new Set<string>();
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    for (const key of batch) keys.add(key);
  } while (cursor !== '0');
  return [...keys];
}

async function values(keys: string[]): Promise<Array<string | null>> {
  if (keys.length === 0) return [];
  return redis.mget(...keys);
}

/**
 * Revoke every session scoped to the instance. Returns the number of refresh
 * tokens deleted.
 */
export async function revokeInstanceSessions(instanceId: string): Promise<number> {
  // Set first: an access token minted from a refresh token deleted below is
  // refused as well.
  await redis.setex(`${REVOKED_PREFIX}${instanceId}`, accessTokenTtlSeconds(), String(Date.now()));

  const refreshKeys = await scanKeys('refresh:*');
  const refreshValues = await values(refreshKeys);
  const hashes = new Set<string>();
  refreshKeys.forEach((key, i) => {
    if (parseRefreshValue(refreshValues[i])?.scopeInstanceId === instanceId) {
      hashes.add(key.slice('refresh:'.length));
    }
  });
  const scopeKeys = await scanKeys('refreshscope:*');
  const scopeValues = await values(scopeKeys);
  scopeKeys.forEach((key, i) => {
    if (scopeValues[i] === instanceId) hashes.add(key.slice('refreshscope:'.length));
  });
  if (hashes.size === 0) return 0;
  const toDelete = [...hashes].flatMap((h) => [`refresh:${h}`, `refreshscope:${h}`]);
  const existing = await values([...hashes].map((h) => `refresh:${h}`));
  await redis.del(...toDelete);
  return existing.filter((v) => v !== null).length;
}

/** True when an org-scoped access token of the instance was issued before its revocation. */
export async function isScopeRevoked(instanceId: string, issuedAtSec: number): Promise<boolean> {
  const at = await redis.get(`${REVOKED_PREFIX}${instanceId}`);
  return at !== null && issuedAtSec * 1000 <= Number(at);
}
