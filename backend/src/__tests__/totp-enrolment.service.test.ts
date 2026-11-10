/**
 * totp-enrolment.service.test.ts – TOTP enrolment for an already signed-in
 * user (pending secret, confirmation, TAN list) and the combined second factor
 * (6-digit TOTP code or single-use TAN). DB + Redis backed, real crypto.
 *
 * Dependencies: uuid, speakeasy, db/connection, redis.service, totp.service
 */
import { v4 as uuidv4 } from 'uuid';
import speakeasy from 'speakeasy';
import { db } from '../db/connection';
import { redis } from '../services/redis.service';
import {
  startTotpEnrolment,
  confirmTotpEnrolment,
  verifySecondFactor,
  countBackupCodes,
  generateBackupCodes,
  resetTotp,
} from '../services/totp.service';

describe('totp enrolment service', () => {
  const userId = uuidv4();
  const email = `totp-enrol-${Date.now()}@example.de`;
  let savedAutoLogin: string | undefined;
  let savedBypass: string | undefined;

  beforeAll(async () => {
    savedAutoLogin = process.env.DEV_AUTO_LOGIN;
    savedBypass = process.env.DEV_TOTP_BYPASS;
    delete process.env.DEV_AUTO_LOGIN;
    delete process.env.DEV_TOTP_BYPASS;
    await db('users').insert({ id: userId, email, totp_enabled: false, created_at: new Date() });
  });

  afterAll(async () => {
    if (savedAutoLogin === undefined) delete process.env.DEV_AUTO_LOGIN;
    else process.env.DEV_AUTO_LOGIN = savedAutoLogin;
    if (savedBypass === undefined) delete process.env.DEV_TOTP_BYPASS;
    else process.env.DEV_TOTP_BYPASS = savedBypass;
    await redis.del(`totp_pending:${userId}`);
    await db('users').where({ id: userId }).del();
  });

  let secret = '';
  let tans: string[] = [];

  it('starts an enrolment without touching the stored secret', async () => {
    const setup = await startTotpEnrolment(userId, email);
    secret = setup.secret;
    expect(setup.qrCodeUrl).toMatch(/^data:image\/png/);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const row = await db('users').where({ id: userId }).first();
    expect(row.totp_secret).toBeNull();
    expect(Boolean(row.totp_enabled)).toBe(false);
  });

  it('refuses a wrong confirmation code and keeps the enrolment pending', async () => {
    expect(await confirmTotpEnrolment(userId, '000000')).toBeNull();
    const row = await db('users').where({ id: userId }).first();
    expect(Boolean(row.totp_enabled)).toBe(false);
  });

  it('confirms with a valid code: enables TOTP and returns 10 TANs', async () => {
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    const result = await confirmTotpEnrolment(userId, code);
    expect(result).not.toBeNull();
    tans = result!;
    expect(tans).toHaveLength(10);
    tans.forEach((t) => expect(t).toMatch(/^[0-9A-F]{8}$/));
    const row = await db('users').where({ id: userId }).first();
    expect(Boolean(row.totp_enabled)).toBe(true);
    expect(row.totp_secret).toBeTruthy();
    expect(await countBackupCodes(userId)).toBe(10);
  });

  it('returns null when no enrolment is pending any more', async () => {
    const code = speakeasy.totp({ secret, encoding: 'base32', time: Date.now() / 1000 + 30 });
    expect(await confirmTotpEnrolment(userId, code)).toBeNull();
  });

  it('accepts a TOTP code as second factor and refuses its replay', async () => {
    const code = speakeasy.totp({ secret, encoding: 'base32', time: Date.now() / 1000 + 30 });
    expect(await verifySecondFactor(userId, code)).toBe(true);
    expect(await verifySecondFactor(userId, code)).toBe(false);
  });

  it('accepts a TAN once, in any spacing and case, and consumes it', async () => {
    const tan = tans[0];
    const spaced = `${tan.slice(0, 4)}-${tan.slice(4).toLowerCase()}`;
    expect(await verifySecondFactor(userId, spaced)).toBe(true);
    expect(await verifySecondFactor(userId, tan)).toBe(false);
    expect(await countBackupCodes(userId)).toBe(9);
  });

  it('refuses malformed codes', async () => {
    expect(await verifySecondFactor(userId, '')).toBe(false);
    expect(await verifySecondFactor(userId, '12345')).toBe(false);
    expect(await verifySecondFactor(userId, 'ZZZZZZZZ')).toBe(false);
  });

  it('regenerating the TAN list invalidates the old one', async () => {
    const fresh = await generateBackupCodes(userId);
    expect(fresh).toHaveLength(10);
    expect(await verifySecondFactor(userId, tans[1])).toBe(false);
    expect(await countBackupCodes(userId)).toBe(10);
  });

  it('resetTotp clears secret, TANs and the enabled flag', async () => {
    await resetTotp(userId);
    const row = await db('users').where({ id: userId }).first();
    expect(Boolean(row.totp_enabled)).toBe(false);
    expect(row.totp_secret).toBeNull();
    expect(await countBackupCodes(userId)).toBe(0);
  });
});
