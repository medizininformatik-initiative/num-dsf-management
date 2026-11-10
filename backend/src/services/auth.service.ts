/**
 * auth.service.ts – Auth flow orchestration
 * Dependencies: otp.service, totp.service, mail.service, audit.service, DB, JWT, Redis
 *
 * Flow:
 * requestOtp → verifyOtp → (verifyTotp | setupTotp + confirmTotp) → createSession
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db/connection';
import { v4 as uuidv4 } from 'uuid';
import { createAndStoreOtp, verifyOtp } from './otp.service';
import { verifyTotpCode, verifyBackupCode, generateBackupCodes } from './totp.service';
import { sendOtpEmail } from './mail.service';
import {
  setRefreshToken,
  deleteRefreshToken,
  getRefreshToken,
  getRefreshRecord,
  parseRefreshValue,
  redis,
} from './redis.service';
import { writeAuditLog } from './audit.service';
import type { AuthUser, JwtPayload, TempTokenPayload } from '../types/auth.types';
import { REFRESH_TOKEN_TTL_SEC as REFRESH_TTL_SEC } from '../lib/time';
import { logger } from '../lib/logger';
import { isValidSha512Fingerprint } from '../lib/certFingerprint';
import { isCertAuthMode } from '../lib/authMode';

// JWT keys loaded from Base64 env vars
const JWT_PRIVATE_KEY = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64 || '', 'base64').toString(
  'utf8',
);
const JWT_PUBLIC_KEY = Buffer.from(process.env.JWT_PUBLIC_KEY_BASE64 || '', 'base64').toString(
  'utf8',
);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';

// ─── Helper functions ───────────────────────────────────────────────────────

function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      amr: user.authMethod ?? 'otp',
      ...(user.scopeInstanceId ? { kind: 'org', inst: user.scopeInstanceId } : {}),
    } as Omit<JwtPayload, 'iat' | 'exp'>,
    JWT_PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: JWT_EXPIRES_IN } as any,
  );
}

function signTempToken(user: AuthUser, purpose: TempTokenPayload['purpose']): string {
  return jwt.sign({ sub: user.id, email: user.email, purpose }, JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: '10m',
  } as any);
}

export function verifyAccessToken(token: string): JwtPayload {
  const payload = jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as JwtPayload;
  // Temp tokens share the key; one with a `purpose` must never pass as an access token.
  if ('purpose' in payload) throw new Error('INVALID_TOKEN_TYPE');
  // Bundle signatures share the key too and carry no identity; every access
  // token names its user, so anything without string sub and email is refused.
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string') {
    throw new Error('INVALID_TOKEN_TYPE');
  }
  return payload;
}

export function verifyTempToken(token: string): TempTokenPayload {
  return jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: ['RS256'] }) as TempTokenPayload;
}

// ─── Auth flow steps ────────────────────────────────────────────────────────

/**
 * Step 1: whitelist-check an email and send a one-time code (fire-and-forget).
 * Side-effects: stores an OTP in Redis, sends mail, writes an audit log.
 * Failure and success take the same generic path so membership never leaks.
 * @throws NOT_WHITELISTED if the email is absent or the account is locked.
 */
export async function requestOtp(email: string, ipAddress: string): Promise<void> {
  const normalized = email.toLowerCase().trim();

  // Whitelist check (generic error message on rejection – no hint if email exists or is locked)
  const whitelisted = await db('email_whitelist').where({ email: normalized }).first();
  if (!whitelisted || whitelisted.locked_at) {
    await writeAuditLog({
      userEmail: normalized,
      resourceType: 'AUTH',
      operation: 'FAILED_LOGIN',
      ipAddress,
    });
    throw new Error('NOT_WHITELISTED');
  }

  const code = await createAndStoreOtp(normalized);
  // Fire-and-forget the SMTP send. Awaiting it makes the whitelisted path block
  // on an SMTP round-trip while the non-whitelisted path throws immediately —
  // the latency gap leaks whitelist membership despite the identical generic
  // 200 the route returns. The mail still goes out; the response no longer
  // waits on it.
  sendOtpEmail(normalized, code).catch((err) =>
    logger.error({ err }, '[auth] OTP mail send failed'),
  );
  await writeAuditLog({
    userEmail: normalized,
    resourceType: 'AUTH',
    operation: 'OTP_REQUEST',
    ipAddress,
  });
}

/**
 * Step 2: verify the OTP and return a short-lived temp token for the TOTP step.
 * Side-effects: lazily creates the user, writes an audit log.
 * @throws INVALID_OTP if the code is wrong or expired.
 */
export async function verifyOtpAndGetTempToken(
  email: string,
  code: string,
  ipAddress: string,
): Promise<{ tempToken: string; requiresTotpSetup: boolean }> {
  const normalized = email.toLowerCase().trim();
  const valid = await verifyOtp(normalized, code);

  if (!valid) {
    await writeAuditLog({
      userEmail: normalized,
      resourceType: 'AUTH',
      operation: 'FAILED_LOGIN',
      ipAddress,
    });
    throw new Error('INVALID_OTP');
  }

  // Get or create user in DB
  let user = await db('users').where({ email: normalized }).first();
  if (!user) {
    const id = uuidv4();
    await db('users').insert({ id, email: normalized, created_at: new Date() });
    user = await db('users').where({ id }).first();
  }

  await writeAuditLog({
    userEmail: normalized,
    resourceType: 'AUTH',
    operation: 'OTP_VERIFY',
    ipAddress,
  });

  const requiresTotpSetup = !user.totp_enabled;
  const purpose = requiresTotpSetup ? 'totp_setup' : 'totp_required';
  const tempToken = signTempToken(
    { id: user.id, email: user.email, totpEnabled: user.totp_enabled },
    purpose,
  );

  return { tempToken, requiresTotpSetup };
}

/**
 * Step 3a: verify a TOTP (or backup) code and mint the access/refresh pair.
 * Side-effects: updates last_login, writes TOTP_VERIFY + LOGIN audit logs.
 * @throws INVALID_TOKEN_PURPOSE if the temp token is not a 'totp_required' token.
 * @throws USER_NOT_FOUND if the token's user no longer exists.
 * @throws INVALID_TOTP if neither the TOTP nor a backup code matches.
 */
export async function verifyTotpAndCreateSession(
  tempToken: string,
  code: string,
  ipAddress: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = verifyTempToken(tempToken);
  if (payload.purpose !== 'totp_required') throw new Error('INVALID_TOKEN_PURPOSE');

  const user = await db('users').where({ id: payload.sub }).first();
  if (!user) throw new Error('USER_NOT_FOUND');

  // Accept TOTP code or backup code
  const totpValid = await verifyTotpCode(user.id, code);
  const backupValid = !totpValid && (await verifyBackupCode(user.id, code));

  if (!totpValid && !backupValid) {
    await writeAuditLog({
      userEmail: user.email,
      resourceType: 'AUTH',
      operation: 'FAILED_LOGIN',
      ipAddress,
    });
    throw new Error('INVALID_TOTP');
  }

  await db('users').where({ id: user.id }).update({ last_login: new Date() });
  await writeAuditLog({
    userEmail: user.email,
    resourceType: 'AUTH',
    operation: 'TOTP_VERIFY',
    ipAddress,
  });
  await writeAuditLog({
    userEmail: user.email,
    resourceType: 'AUTH',
    operation: 'LOGIN',
    ipAddress,
  });

  return createTokenPair({ id: user.id, email: user.email, totpEnabled: true });
}

/**
 * Step 3b: confirm a freshly set-up TOTP secret, enable 2FA, and create a session.
 * Side-effects: sets totp_enabled + last_login, writes TOTP_SETUP + LOGIN audit
 * logs, generates one-time backup codes.
 * @throws INVALID_TOKEN_PURPOSE if the temp token is not a 'totp_setup' token.
 * @throws TOTP_NOT_INITIALIZED if no secret was provisioned for the user.
 * @throws INVALID_TOTP_CODE if the confirmation code does not match.
 */
export async function confirmTotpSetupAndCreateSession(
  tempToken: string,
  code: string,
  ipAddress: string,
): Promise<{ accessToken: string; refreshToken: string; backupCodes: string[] }> {
  const payload = verifyTempToken(tempToken);
  if (payload.purpose !== 'totp_setup') throw new Error('INVALID_TOKEN_PURPOSE');

  const user = await db('users').where({ id: payload.sub }).first();
  if (!user?.totp_secret) throw new Error('TOTP_NOT_INITIALIZED');

  const valid = await verifyTotpCode(user.id, code);
  if (!valid) throw new Error('INVALID_TOTP_CODE');

  await db('users').where({ id: user.id }).update({ totp_enabled: true, last_login: new Date() });
  await writeAuditLog({
    userEmail: user.email,
    resourceType: 'AUTH',
    operation: 'TOTP_SETUP',
    ipAddress,
  });
  await writeAuditLog({
    userEmail: user.email,
    resourceType: 'AUTH',
    operation: 'LOGIN',
    ipAddress,
  });

  const backupCodes = await generateBackupCodes(user.id);
  const tokens = await createTokenPair({ id: user.id, email: user.email, totpEnabled: true });

  return { ...tokens, backupCodes };
}

// Create token pair + store refresh in Redis.
// IMPORTANT: the returned `refreshToken` is the PLAINTEXT token (set on the
// httpOnly cookie). Redis stores the SHA-256 hash so a DB dump of the
// `refresh:*` keyspace does not yield usable tokens.
export async function createTokenPair(
  user: AuthUser,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken(user);
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // An org scope is stored in the same record (redis.service), never apart.
  await setRefreshToken(refreshTokenHash, user.id, REFRESH_TTL_SEC, user.scopeInstanceId);
  return { accessToken, refreshToken };
}

/**
 * Rotate the refresh token and mint a new access/refresh pair.
 * Re-checks the whitelist/lock and idle timeout on every rotation; fails soft
 * if Redis is unreachable. Side-effects: deletes the old token, stores a new one.
 *
 * `opts.certFingerprint` lets a cert-authenticated session re-prove possession
 * of its client certificate on refresh instead of silently degrading to an
 * OTP-equivalent long-lived session: when it is a valid SHA-512 fingerprint
 * AND resolveCertLogin resolves it to this same user, the new pair is minted
 * with amr:'cert'; otherwise (no fingerprint, invalid, or resolves to someone
 * else) it falls back to amr:'otp'. The Redis refresh-record format (hash →
 * userId) is unchanged either way.
 *
 * @throws INVALID_REFRESH_TOKEN if the presented token is unknown.
 * @throws USER_NOT_FOUND if the token's user no longer exists.
 * @throws ACCOUNT_LOCKED if the account was de-whitelisted or locked.
 * @throws SESSION_EXPIRED if the idle window has lapsed.
 */
export async function refreshAccessToken(
  refreshToken: string,
  opts?: { certFingerprint?: string | null },
): Promise<{ accessToken: string; refreshToken: string }> {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const record = await getRefreshRecord(hash);
  if (!record) throw new Error('INVALID_REFRESH_TOKEN');
  const { userId, scopeInstanceId } = record;

  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new Error('USER_NOT_FOUND');

  // Lock check on every rotation. The access token is stateless (lives ≤
  // JWT_EXPIRES_IN), but without this a locked or de-whitelisted account could
  // keep minting fresh 7-day refresh tokens forever — revokeAllSessions only
  // clears the tokens that existed at lock time. Re-checking here caps a locked
  // account's residual access at one access-token lifetime.
  const whitelisted = await db('email_whitelist').where({ email: user.email }).first();
  if (!whitelisted || whitelisted.locked_at) {
    await deleteRefreshToken(hash);
    throw new Error('ACCOUNT_LOCKED');
  }

  // Idle timeout check: reject refresh if user has been inactive. A missing
  // activity key means the idle window lapsed. But if Redis itself is
  // unreachable, the read throws — and treating that as "idle" would log out
  // every active user during a transient Redis blip. So distinguish the two:
  // on a Redis error we fail soft (allow the refresh) and log it, instead of
  // mass-revoking sessions.
  let lastActivity: string | null = null;
  let redisReachable = true;
  try {
    lastActivity = await redis.get(`activity:${userId}`);
  } catch (err) {
    redisReachable = false;
    logger.warn(
      { err, userId },
      '[auth] Redis unreachable during idle check — allowing refresh (fail-soft)',
    );
  }
  if (redisReachable && !lastActivity && process.env.NODE_ENV !== 'test') {
    // User has been idle too long — revoke all tokens
    await deleteRefreshToken(hash);
    throw new Error('SESSION_EXPIRED');
  }

  // Re-prove cert possession: only carry amr:'cert' forward when the caller
  // presented a fingerprint on THIS request that still resolves to THIS user.
  // A cert session that refreshes without its cert (or with someone else's)
  // degrades to 'otp' rather than silently keeping the cert claim forever.
  //
  // An org-scoped session (organization login certificate) keeps its scope:
  // it is only renewed when the re-presented certificate still logs in for
  // exactly that instance. It never degrades to an unscoped owner session,
  // and the token is NOT deleted on failure (a stolen cookie cannot burn the
  // real session).
  let authMethod: 'otp' | 'cert' = 'otp';
  const fp = opts?.certFingerprint;
  const resolved = fp && isValidSha512Fingerprint(fp) ? await resolveCertLogin(fp) : null;
  if (scopeInstanceId) {
    if (
      !resolved ||
      resolved.kind !== 'org' ||
      resolved.instanceId !== scopeInstanceId ||
      resolved.user.id !== user.id
    ) {
      throw new Error('CERT_REQUIRED');
    }
    authMethod = 'cert';
  } else if (resolved && resolved.kind === 'admin' && resolved.user.id === user.id) {
    authMethod = 'cert';
  }
  // Certificate-only deployment: a refresh cookie is worthless without the
  // client certificate it was issued for. The token is NOT deleted here, so
  // a thief replaying a stolen cookie cannot burn the real user's session.
  if (isCertAuthMode() && authMethod !== 'cert') {
    throw new Error('CERT_REQUIRED');
  }

  // Rotate: delete old token and issue a new pair. createTokenPair is the
  // single mint path (signs + mints + hashes + stores), so rotation and
  // initial issuance can't drift apart.
  await deleteRefreshToken(hash);
  return createTokenPair({
    id: user.id,
    email: user.email,
    totpEnabled: user.totp_enabled,
    authMethod,
    scopeInstanceId: scopeInstanceId ?? undefined,
  });
}

/**
 * Resolve a caller authenticated via client certificate: match the SHA-512
 * fingerprint against admins first, then organization login certificates.
 *
 * Admin path: the fingerprint is pre-registered in admin_cert_fingerprints
 * (out of band, by an existing admin). Ensures the users row exists for that
 * email, so a first-time admin cert can log in without a prior OTP signup.
 * The email_whitelist row is NOT created: a de-whitelisted admin must not be
 * re-admitted by presenting a certificate (the env bootstrap whitelists the
 * first admins itself).
 * Admin-ness itself comes from admin_grants (seeded separately); this
 * function does not grant it. The session is unscoped.
 *
 * Org path: the fingerprint is listed in org_login_certificates (managed by
 * admins). The result carries the organization's instance; the session minted
 * from it is scoped to exactly that instance and is never admin, whoever owns
 * the instance.
 *
 * @returns null if the fingerprint matches neither an admin nor a login certificate.
 */
export async function resolveCertLogin(fingerprint: string): Promise<{
  kind: 'admin' | 'org';
  user: { id: string; email: string };
  instanceId?: string;
} | null> {
  const adminCert = await findAdminCert(fingerprint);
  if (adminCert === 'expired') return null;
  if (adminCert) {
    const email = String(adminCert.email).toLowerCase().trim();
    // Never (re-)create the whitelist row here: a removed or locked admin
    // stays out; the caller's whitelist check refuses the login.
    await db('users')
      .insert({ id: uuidv4(), email, totp_enabled: true, created_at: new Date() })
      .onConflict('email')
      .ignore();
    const user = await db('users').where({ email }).first();
    if (!user) return null;
    return { kind: 'admin', user: { id: user.id, email: user.email } };
  }
  return resolveOrgLogin(fingerprint);
}

/**
 * The admin certificate row of a fingerprint; 'expired' when its recorded
 * valid_until has passed (NULL = not recorded yet, filled at first login).
 */
async function findAdminCert(
  fingerprint: string,
): Promise<{ email: string } | 'expired' | undefined> {
  const row = await db('admin_cert_fingerprints').where({ fingerprint }).first();
  if (!row) return undefined;
  if (row.valid_until && new Date(row.valid_until).getTime() < Date.now()) return 'expired';
  return row;
}

async function resolveOrgLogin(fingerprint: string): Promise<{
  kind: 'org';
  user: { id: string; email: string };
  instanceId: string;
} | null> {
  const row = await db('org_login_certificates as l')
    .join('organizations as o', 'o.identifier', 'l.organization_id')
    .join('instances as i', 'i.id', 'o.instance_id')
    .join('users as u', 'u.id', 'i.user_id')
    .where('l.fingerprint', fingerprint)
    // A thumbprint blocked by an incident never logs in, whatever re-added it.
    .whereNotExists(
      db('blocked_certificate_thumbprints').whereRaw(
        'blocked_certificate_thumbprints.fingerprint = l.fingerprint',
      ),
    )
    .select('i.id as instance_id', 'u.id as user_id', 'u.email as user_email')
    .first();
  if (!row) return null;
  return {
    kind: 'org',
    user: { id: row.user_id, email: row.user_email },
    instanceId: row.instance_id,
  };
}

/**
 * What a SHA-512 fingerprint is bound to, for per-request session binding:
 * the user plus, for an organization login certificate, the one instance the
 * session may use. Read-only; null when the certificate is not (or no longer)
 * registered.
 */
export async function findCertBinding(
  fingerprint: string,
): Promise<{ userId: string; kind: 'admin' | 'org'; instanceId?: string } | null> {
  const adminCert = await findAdminCert(fingerprint);
  if (adminCert === 'expired') return null;
  if (adminCert) {
    const user = await db('users')
      .where({ email: String(adminCert.email).toLowerCase().trim() })
      .first();
    return user ? { userId: user.id, kind: 'admin' } : null;
  }
  const org = await resolveOrgLogin(fingerprint);
  return org ? { userId: org.user.id, kind: 'org', instanceId: org.instanceId } : null;
}

/** User id a SHA-512 fingerprint maps to, or null (see findCertBinding). */
export async function findCertUserId(fingerprint: string): Promise<string | null> {
  return (await findCertBinding(fingerprint))?.userId ?? null;
}

/**
 * Logout: revoke the refresh token. The LOGOUT audit entry names the token's
 * owner from its Redis record; an unknown or already revoked token writes none
 * (the caller's own claims about who it is are never trusted).
 */
export async function logout(refreshToken: string, ipAddress: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const userId = await getRefreshToken(hash);
  await deleteRefreshToken(hash);
  if (!userId) return;
  const user = await db('users').where({ id: userId }).first('email');
  if (!user) return;
  await writeAuditLog({
    userEmail: user.email,
    resourceType: 'AUTH',
    operation: 'LOGOUT',
    ipAddress,
  });
}

/**
 * Invalidate ALL refresh tokens for a user. Forces re-login on next API call.
 * Called when an admin locks / demotes / removes the user.
 *
 * Storage scheme: keys are `refresh:<tokenHash>`, values are the userId
 * (`<userId>|org:<instanceId>` for org-scoped sessions, see redis.service).
 * There is no per-user index, so we scan `refresh:*` and delete matching keys.
 * Returns the number of tokens revoked (0 if user has no active sessions).
 */
export async function revokeAllSessions(
  emailOrUser: string | { id: string; email?: string },
): Promise<number> {
  let userId: string | undefined;
  if (typeof emailOrUser === 'string') {
    const user = await db('users').where({ email: emailOrUser.toLowerCase() }).first();
    if (!user) return 0;
    userId = user.id as string;
  } else {
    userId = emailOrUser.id;
  }
  if (!userId) return 0;

  // Scan the keyspace in cursor-paged batches instead of redis.keys('refresh:*').
  // KEYS is O(N) over the entire keyspace and blocks Redis while it runs — at
  // 10K+ active sessions that stalls every other command (auth, rate-limit,
  // OTP). SCAN streams matching keys in chunks of `count`, never blocking
  // for more than one chunk at a time.
  //
  // Caveat: SCAN can return duplicates across iterations; the user-id check
  // below still deletes the right keys, but `toDelete.length` may double-count
  // duplicates. The dedup via Set guards against that.
  const matched = new Set<string>();
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'refresh:*', 'COUNT', 500);
    cursor = next;
    for (const key of batch) matched.add(key);
  } while (cursor !== '0');

  if (matched.size === 0) return 0;

  // Check each token's stored userId — only delete tokens belonging to this user.
  const pipeline = redis.pipeline();
  const keyList = [...matched];
  for (const key of keyList) {
    pipeline.get(key);
  }
  const values = await pipeline.exec();
  if (!values) return 0;

  const toDelete: string[] = [];
  for (let i = 0; i < keyList.length; i++) {
    const val = values[i]?.[1];
    if (typeof val === 'string' && parseRefreshValue(val)?.userId === userId) {
      toDelete.push(keyList[i]);
    }
  }
  if (toDelete.length === 0) return 0;

  await redis.del(...toDelete);
  return toDelete.length;
}
