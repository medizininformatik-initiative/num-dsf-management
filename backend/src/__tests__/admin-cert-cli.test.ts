/**
 * admin-cert-cli.test.ts – The server CLI functions behind scripts/admin-cert.sh:
 * add refuses an e-mail without verified admin grant, a private key and an
 * expired certificate; add stores fingerprint + expiry with created_by
 * 'server-cli' and writes an audit entry; list shows it; remove needs --yes
 * and a unique prefix. Dependencies: db, scripts/admin-cert, helpers/allowListSites
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db } from '../db/connection';
import { signGrant } from '../lib/adminGrants';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { makeCertPem } from './helpers/allowListSites';
import { runAdd, runList, runRemove, parseArgs } from '../scripts/admin-cert';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `cli-admin-${sfx}@imi-test.example.de`;
const plainEmail = `cli-plain-${sfx}@example.de`;
const PEM = makeCertPem(`cli.${sfx}`);
const FP = sha512FingerprintFromPem(PEM);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-cert-cli-'));
const file = (name: string, content: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};

beforeAll(async () => {
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: adminEmail,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(adminEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
  jest.restoreAllMocks();
  await db('audit_logs')
    .where({ user_email: 'server-cli' })
    .whereRaw('resource_id = ?', [adminEmail])
    .del();
  await db('admin_cert_fingerprints').where({ email: adminEmail }).del();
  await db('admin_grants').where({ email: adminEmail }).del();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('admin-cert CLI', () => {
  it('parses --label and --yes', () => {
    expect(parseArgs(['a@b.de', 'x.pem', '--label', 'Laptop', '--yes'])).toEqual({
      positional: ['a@b.de', 'x.pem'],
      label: 'Laptop',
      yes: true,
    });
  });

  it('add refuses an e-mail without an admin grant and stores nothing', async () => {
    expect(await runAdd(plainEmail, file('plain.pem', PEM), null)).toBe(1);
    expect(await db('admin_cert_fingerprints').where({ fingerprint: FP }).first()).toBeUndefined();
  });

  it('add refuses a private key, garbage and an unreadable file', async () => {
    const withKey = `${PEM}\n-----BEGIN PRIVATE${' '}KEY-----\nAAAA\n-----END PRIVATE KEY-----`;
    expect(await runAdd(adminEmail, file('key.pem', withKey), null)).toBe(1);
    expect(await runAdd(adminEmail, file('bad.pem', 'nope'), null)).toBe(1);
    expect(await runAdd(adminEmail, path.join(dir, 'missing.pem'), null)).toBe(1);
    expect(await db('admin_cert_fingerprints').where({ email: adminEmail })).toHaveLength(0);
  });

  it('add stores the certificate for an existing admin and audits it', async () => {
    expect(await runAdd(adminEmail, file('ok.pem', PEM), 'Notfall')).toBe(0);
    const row = await db('admin_cert_fingerprints').where({ fingerprint: FP }).first();
    expect(row).toMatchObject({ email: adminEmail, created_by: 'server-cli', label: 'Notfall' });
    expect(new Date(row.valid_until).getUTCFullYear()).toBe(2035);
    const audit = await db('audit_logs')
      .where({ user_email: 'server-cli', resource_id: adminEmail })
      .first();
    expect(audit).toBeTruthy();
    // Registering the same certificate twice is refused.
    expect(await runAdd(adminEmail, file('ok2.pem', PEM), null)).toBe(1);
  });

  it('list prints the certificate', async () => {
    const log = console.log as jest.Mock;
    log.mockClear();
    expect(await runList(adminEmail)).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain(FP.slice(0, 16));
  });

  it('remove needs --yes and a unique, valid prefix', async () => {
    expect(await runRemove('zz', true)).toBe(1);
    expect(await runRemove(FP.slice(0, 16), false)).toBe(2);
    expect(await db('admin_cert_fingerprints').where({ fingerprint: FP }).first()).toBeTruthy();
    expect(await runRemove(FP.slice(0, 16), true)).toBe(0);
    expect(await db('admin_cert_fingerprints').where({ fingerprint: FP }).first()).toBeUndefined();
    expect(await runRemove(FP.slice(0, 16), true)).toBe(1);
  });
});
