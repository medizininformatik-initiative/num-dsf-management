/**
 * admin-totp-reset-cli.test.ts – `admin-cert totp-reset <email> --yes`: the
 * server-side way out when an admin lost both the phone and the TAN list.
 * It needs a verified admin grant and --yes, clears secret, TANs and the
 * enabled flag (the admin enrols again at the next login) and is audited.
 * Dependencies: db, scripts/admin-cert, lib/adminGrants, totp.service
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { signGrant } from '../lib/adminGrants';
import { generateBackupCodes, saveTotpSecret } from '../services/totp.service';
import { runTotpReset } from '../scripts/admin-cert';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `cli-totp-admin-${sfx}@imi-test.example.de`;
const plainEmail = `cli-totp-plain-${sfx}@example.de`;
const adminId = uuidv4();
const plainId = uuidv4();

beforeAll(async () => {
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: adminEmail,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(adminEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
  for (const [id, email] of [
    [adminId, adminEmail],
    [plainId, plainEmail],
  ]) {
    await db('users').insert({ id, email, totp_enabled: true, created_at: new Date() });
    await saveTotpSecret(id, 'JBSWY3DPEHPK3PXP');
    await generateBackupCodes(id);
  }
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
  jest.restoreAllMocks();
  await db('audit_logs')
    .where({ user_email: 'server-cli' })
    .whereRaw('resource_id = ?', [adminEmail])
    .del();
  await db('admin_grants').where({ email: adminEmail }).del();
  await db('users').whereIn('id', [adminId, plainId]).del();
});

const row = (id: string) => db('users').where({ id }).first();

describe('admin-cert totp-reset', () => {
  it('refuses without --yes and changes nothing', async () => {
    expect(await runTotpReset(adminEmail, false)).toBe(2);
    expect(Boolean((await row(adminId)).totp_enabled)).toBe(true);
  });

  it('refuses an e-mail without a verified admin grant', async () => {
    expect(await runTotpReset(plainEmail, true)).toBe(1);
    expect(Boolean((await row(plainId)).totp_enabled)).toBe(true);
  });

  it('refuses an unknown user', async () => {
    expect(await runTotpReset(`nobody-${sfx}@imi-test.example.de`, true)).toBe(1);
  });

  it('clears secret, TANs and the enabled flag, and audits it', async () => {
    expect(await runTotpReset(adminEmail.toUpperCase(), true)).toBe(0);
    const r = await row(adminId);
    expect(Boolean(r.totp_enabled)).toBe(false);
    expect(r.totp_secret).toBeNull();
    expect(r.backup_codes).toBeNull();
    const audit = await db('audit_logs')
      .where({ user_email: 'server-cli', operation: 'TOTP_SETUP' })
      .whereRaw('resource_id = ?', [adminEmail]);
    expect(audit).toHaveLength(1);
  });
});
