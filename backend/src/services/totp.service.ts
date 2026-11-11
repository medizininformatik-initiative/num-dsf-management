/**
 * totp.service.ts – TOTP setup, verification and backup codes
 * Dependencies: speakeasy, qrcode, bcrypt, crypto, db/connection
 *
 * Security:
 * - TOTP secret encrypted with AES-256-GCM in DB
 * - Backup codes bcrypt-hashed (single-use)
 * - Window: 1 step (30s tolerance up and down)
 */
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db/connection';
import { redis } from './redis.service';
import { logger } from '../lib/logger';
import { isDevEnv } from '../lib/isDevEnv';

const ENCRYPTION_KEY = Buffer.from(process.env.TOTP_ENCRYPTION_KEY || '', 'hex');
const BCRYPT_ROUNDS = 12;

// AES-256-GCM encryption for TOTP secrets
function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

const TOTP_ISSUER = 'DSF Management';

// speakeasy.generateSecret ignores `issuer`, so the otpauth URL is built
// explicitly: the authenticator app then shows issuer + account and several
// enrolments can be told apart.
async function buildTotpSetup(
  email: string,
  base32: string,
): Promise<{ qrCodeUrl: string; secret: string }> {
  const url = speakeasy.otpauthURL({
    secret: base32,
    encoding: 'base32',
    label: email,
    issuer: TOTP_ISSUER,
  });
  return { qrCodeUrl: await QRCode.toDataURL(url), secret: base32 };
}

export async function generateTotpSetup(
  email: string,
): Promise<{ qrCodeUrl: string; secret: string }> {
  const secret = speakeasy.generateSecret({ length: 32 });
  return buildTotpSetup(email, secret.base32);
}

export async function saveTotpSecret(userId: string, plainSecret: string): Promise<void> {
  const encrypted = encryptSecret(plainSecret);
  await db('users').where({ id: userId }).update({ totp_secret: encrypted });
}

// Dev shortcut: bypass TOTP entirely. Only honored when DEV_AUTO_LOGIN=true,
// DEV_TOTP_BYPASS=true, and NODE_ENV is on the development/test allowlist
// (isDevEnv) — an unrecognized NODE_ENV like 'staging' must NOT activate it,
// matching the same allowlist the dev-login route enforces.
//
// Exported so other guards on the same step-up path (stepUp.middleware) can
// check it before touching the DB, instead of re-deriving the condition.
export function isDevTotpBypassActive(): boolean {
  return (
    isDevEnv() && process.env.DEV_AUTO_LOGIN === 'true' && process.env.DEV_TOTP_BYPASS === 'true'
  );
}

export async function verifyTotpCode(userId: string, code: string): Promise<boolean> {
  if (isDevTotpBypassActive()) {
    return true;
  }

  const user = await db('users').where({ id: userId }).first();
  if (!user?.totp_secret) return false;

  return checkTotpAgainstSecret(userId, decryptSecret(user.totp_secret), code);
}

// Verifies a code against one base32 secret and claims it against replay.
type TotpCheck = { result: 'ok'; replayKey: string } | { result: 'invalid' | 'replayed' };

// Reports WHY a code failed (wrong vs. already used) and hands back the claim
// key so a caller whose follow-up work fails can release the claim again.
async function checkTotpDetailed(userId: string, secret: string, code: string): Promise<TotpCheck> {
  // Normalize once: speakeasy verifies the whitespace-stripped token, so the
  // anti-replay claim below MUST hash the same normalized value. Hashing the
  // raw input instead would let a captured code replay under different
  // spacing ('123456' vs '123 456') — each variant claims a different key.
  const normalized = code.replace(/\s/g, '');
  const valid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: normalized,
    window: 1,
  });

  if (!valid) return { result: 'invalid' };

  // Anti-replay: atomically claim the code hash; returns null if already claimed.
  // TTL must be ≥ the validity window speakeasy accepts. With window: 1 (a code
  // is valid for the current 30s step plus ±1 step), the worst-case acceptance
  // window is 90 s. A 60 s TTL would let an attacker re-submit a captured code
  // in the last 30 s of its lifetime. 120 s gives a 30 s safety margin.
  const codeHash = crypto.createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
  const replayKey = `totp_used:${codeHash}`;
  const claimed = await redis.set(replayKey, '1', 'EX', 120, 'NX');
  if (claimed === null) return { result: 'replayed' };

  return { result: 'ok', replayKey };
}

async function checkTotpAgainstSecret(
  userId: string,
  secret: string,
  code: string,
): Promise<boolean> {
  return (await checkTotpDetailed(userId, secret, code)).result === 'ok';
}

/**
 * Second factor for an admin step-up: a 6-digit authenticator code or a TAN
 * (one of the 8-character single-use backup codes, any case, optional
 * spaces/dashes). A TAN is consumed on success.
 */
export async function verifySecondFactor(userId: string, code: string): Promise<boolean> {
  const normalized = code.replace(/[\s-]/g, '');
  if (/^\d{6}$/.test(normalized)) return verifyTotpCode(userId, normalized);
  if (/^[0-9a-fA-F]{8}$/.test(normalized)) return verifyBackupCode(userId, normalized);
  return false;
}

const PENDING_TTL_SECONDS = 600;
const pendingKey = (userId: string): string => `totp_pending:${userId}`;

/**
 * Starts the enrolment of a signed-in user. The new secret waits encrypted in
 * Redis until it is confirmed, so an enrolled account keeps its working secret
 * if the user abandons a re-setup half way. While a pending secret is still
 * valid, calling this again returns the SAME secret (a double click, a repeated
 * request or a page reload must not swap the secret under the QR code the user
 * already scanned); only `restart` replaces it.
 */
export async function startTotpEnrolment(
  userId: string,
  email: string,
  restart = false,
): Promise<{ qrCodeUrl: string; secret: string; resumed: boolean }> {
  if (!restart) {
    const pending = await redis.get(pendingKey(userId));
    if (pending) {
      try {
        const setup = await buildTotpSetup(email, decryptSecret(pending));
        await redis.expire(pendingKey(userId), PENDING_TTL_SECONDS);
        return { ...setup, resumed: true };
      } catch (err) {
        logger.warn({ userId, err }, 'Pending TOTP secret unreadable, starting a new one');
      }
    }
  }
  const setup = await generateTotpSetup(email);
  await redis.set(pendingKey(userId), encryptSecret(setup.secret), 'EX', PENDING_TTL_SECONDS);
  return { ...setup, resumed: false };
}

export type TotpConfirmFailure = 'NO_PENDING' | 'INVALID_CODE' | 'CODE_REUSED';
export type TotpConfirmResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; reason: TotpConfirmFailure };

/**
 * Confirms the pending secret with a code from the authenticator app. On
 * success the secret becomes the account's, TOTP is enabled and a fresh TAN
 * list replaces any old one (returned once, in plaintext). On failure the
 * reason is reported (nothing pending / wrong code / code already used) and
 * logged with the user id only, never the code or the secret. The replay claim
 * is released again when the database write fails, so a retry with the same
 * code is not refused as "used".
 */
export async function confirmTotpEnrolment(
  userId: string,
  code: string,
): Promise<TotpConfirmResult> {
  const pending = await redis.get(pendingKey(userId));
  if (!pending) {
    logger.info({ userId, reason: 'NO_PENDING' }, 'TOTP enrolment confirm refused');
    return { ok: false, reason: 'NO_PENDING' };
  }
  const check = await checkTotpDetailed(userId, decryptSecret(pending), code);
  if (check.result !== 'ok') {
    const reason = check.result === 'replayed' ? 'CODE_REUSED' : 'INVALID_CODE';
    logger.warn({ userId, reason }, 'TOTP enrolment confirm refused');
    return { ok: false, reason };
  }

  try {
    const { codes, hashed } = await createBackupCodeSet();
    await db('users')
      .where({ id: userId })
      .update({ totp_secret: pending, totp_enabled: true, backup_codes: JSON.stringify(hashed) });
    await redis.del(pendingKey(userId));
    logger.info({ userId }, 'TOTP enrolment confirmed');
    return { ok: true, backupCodes: codes };
  } catch (err) {
    await redis.del(check.replayKey).catch(() => {});
    throw err;
  }
}

/** Number of unused TANs left. */
export async function countBackupCodes(userId: string): Promise<number> {
  const user = await db('users').where({ id: userId }).first();
  const raw = user?.backup_codes;
  if (!raw) return 0;
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

/** Removes secret, TANs and the enabled flag; the user enrols again at the next login. */
export async function resetTotp(userId: string): Promise<void> {
  await redis.del(pendingKey(userId));
  await db('users')
    .where({ id: userId })
    .update({ totp_secret: null, totp_enabled: false, backup_codes: null });
}

// 10 single-use codes: plaintext (shown once) and their bcrypt hashes.
async function createBackupCodeSet(): Promise<{ codes: string[]; hashed: string[] }> {
  const codes = Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  );
  const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)));
  return { codes, hashed };
}

// Generate 10 backup codes
export async function generateBackupCodes(userId: string): Promise<string[]> {
  const { codes, hashed } = await createBackupCodeSet();
  await db('users')
    .where({ id: userId })
    .update({ backup_codes: JSON.stringify(hashed) });
  return codes; // returned in plaintext once – never accessible again
}

export async function verifyBackupCode(userId: string, code: string): Promise<boolean> {
  // The bcrypt comparisons (up to 10 × ~250 ms) run on an UNLOCKED read so they
  // never hold a SELECT ... FOR UPDATE row lock for seconds. Only the atomic
  // single-use claim runs under the lock, and it does string ops only.
  const user = await db('users').where({ id: userId }).first();
  if (!user?.backup_codes) return false;

  let hashed: string[];
  try {
    // MySQL JSON columns return parsed objects; plain strings need parsing
    hashed =
      typeof user.backup_codes === 'string' ? JSON.parse(user.backup_codes) : user.backup_codes;
  } catch {
    logger.error({ userId }, 'Corrupt backup_codes JSON in database');
    return false;
  }
  if (!Array.isArray(hashed)) {
    logger.error({ userId }, 'Corrupt backup_codes JSON in database');
    return false;
  }

  const candidate = code.trim().toUpperCase();
  let matchedHash: string | null = null;
  for (const h of hashed) {
    if (await bcrypt.compare(candidate, h)) {
      matchedHash = h;
      break;
    }
  }
  if (!matchedHash) return false;

  // Atomic single-use claim under the row lock — string ops only, no bcrypt.
  // The matched hash can be spliced exactly once; a concurrent caller that
  // already consumed it finds idx === -1 here and the splice/write never runs,
  // so the same backup code can never authenticate twice.
  return db.transaction(async (trx) => {
    const locked = await trx('users').where({ id: userId }).forUpdate().first();
    let current: string[];
    try {
      current =
        typeof locked.backup_codes === 'string'
          ? JSON.parse(locked.backup_codes)
          : locked.backup_codes;
    } catch {
      return false;
    }
    if (!Array.isArray(current)) return false;
    const idx = current.indexOf(matchedHash);
    if (idx === -1) return false; // already consumed by a concurrent call
    current.splice(idx, 1);
    await trx('users')
      .where({ id: userId })
      .update({ backup_codes: JSON.stringify(current) });
    return true;
  });
}
