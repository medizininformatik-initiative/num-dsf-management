/**
 * admin-cert-reseed.test.ts – Removing a compromised admin certificate must
 * stick. IMI_ADMIN_CERT_FINGERPRINTS only seeds the first admin certificates
 * (while admin_cert_fingerprints is empty, like IMI_ADMIN_EMAILS for
 * admin_grants), so a restart never brings a removed fingerprint back; and a
 * certificate login never re-creates a removed whitelist row.
 * Dependencies: db/connection, admin-bootstrap.service, auth.service, crypto
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { bootstrapAdminCertFingerprints } from '../services/admin-bootstrap.service';
import { resolveCertLogin } from '../services/auth.service';

const sfx = `${Date.now().toString(36)}-${uuidv4().slice(0, 6)}`;
const fp = (s: string) => crypto.createHash('sha512').update(s).digest('hex');

class Rollback extends Error {}

describe('IMI_ADMIN_CERT_FINGERPRINTS seeds only an empty table', () => {
  const keptEmail = `reseed-kept-${sfx}@imi-test.example.de`;
  const removedEmail = `reseed-removed-${sfx}@imi-test.example.de`;
  const removedFp = fp(removedEmail);

  beforeAll(async () => {
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email: keptEmail,
      fingerprint: fp(keptEmail),
      created_by: 'test',
      created_at: new Date(),
    });
  });

  afterEach(() => {
    delete process.env.IMI_ADMIN_CERT_FINGERPRINTS;
  });

  afterAll(async () => {
    await db('admin_cert_fingerprints').whereIn('email', [keptEmail, removedEmail]).del();
    await db('email_whitelist').whereIn('email', [keptEmail, removedEmail]).del();
  });

  it('does not re-insert a removed fingerprint once admin certificates exist', async () => {
    process.env.IMI_ADMIN_CERT_FINGERPRINTS = `${removedEmail}=${removedFp}`;
    await bootstrapAdminCertFingerprints();
    expect(await db('admin_cert_fingerprints').where({ fingerprint: removedFp }).first()).toBe(
      undefined,
    );
  });

  it('seeds an empty table and whitelists the seeded e-mail', async () => {
    process.env.IMI_ADMIN_CERT_FINGERPRINTS = `${removedEmail}=${removedFp}`;
    await expect(
      db.transaction(async (trx) => {
        await trx('admin_cert_fingerprints').del();
        await bootstrapAdminCertFingerprints(trx);
        const row = await trx('admin_cert_fingerprints').where({ fingerprint: removedFp }).first();
        expect(row?.email).toBe(removedEmail);
        expect(await trx('email_whitelist').where({ email: removedEmail }).first()).toBeDefined();
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

describe('resolveCertLogin does not whitelist', () => {
  const email = `no-autowl-${sfx}@imi-test.example.de`;
  const fingerprint = fp(email);

  beforeAll(async () => {
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email,
      fingerprint,
      created_by: 'test',
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    await db('admin_cert_fingerprints').where({ email }).del();
    await db('email_whitelist').where({ email }).del();
    await db('users').where({ email }).del();
  });

  it('leaves a removed whitelist row removed', async () => {
    await resolveCertLogin(fingerprint);
    expect(await db('email_whitelist').where({ email }).first()).toBeUndefined();
  });
});
