/**
 * admin-bootstrap.service.test.ts – Verifies the idempotent early-return of
 * bootstrapAdminGrants(): when admin_grants already has at least one row, the
 * call must resolve without throwing AND must NOT change the row count (it
 * returns before touching IMI_ADMIN_EMAILS). The test seeds its own grant so
 * the precondition holds regardless of whether the DB was data-seeded.
 *
 * Also covers bootstrapAdminCertFingerprints(): valid `email=fingerprint`
 * pairs from IMI_ADMIN_CERT_FINGERPRINTS are inserted into
 * admin_cert_fingerprints, invalid entries are skipped, and re-running does
 * not duplicate rows (onConflict('fingerprint').ignore()).
 *
 * Dependencies: db/connection, admin-bootstrap.service, lib/adminGrants, crypto
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { signGrant } from '../lib/adminGrants';
import {
  bootstrapAdminGrants,
  bootstrapAdminCertFingerprints,
} from '../services/admin-bootstrap.service';

describe('admin-bootstrap.service – bootstrapAdminGrants idempotent no-op', () => {
  const seededEmail = `bootstrap-test-${Date.now()}@example.de`;

  async function grantCount(): Promise<number> {
    const row = await db('admin_grants').count('email as n').first();
    return Number((row as { n: number | string } | undefined)?.n ?? 0);
  }

  beforeAll(async () => {
    const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const sig = signGrant(seededEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test');
    await db('admin_grants')
      .insert({
        email: seededEmail,
        granted_at: grantedAt,
        granted_by_a: 'SYSTEM:test',
        granted_by_b: 'SYSTEM:test',
        signature_hex: sig,
      })
      .onConflict('email')
      .ignore();
  });

  afterAll(async () => {
    await db('admin_grants').where({ email: seededEmail }).del();
  });

  it('is a no-op when admin_grants already has rows (count unchanged, no throw)', async () => {
    const before = await grantCount();
    expect(before).toBeGreaterThan(0);

    await expect(bootstrapAdminGrants()).resolves.toBeUndefined();

    const after = await grantCount();
    expect(after).toBe(before);
  });
});

describe('admin-bootstrap.service – bootstrapAdminCertFingerprints', () => {
  const validEmail = `cert-bootstrap-test-${Date.now()}@example.de`;
  const invalidEmail = `cert-bootstrap-bad-${Date.now()}@example.de`;
  const validFingerprint = crypto.createHash('sha512').update(validEmail).digest('hex');

  beforeAll(() => {
    process.env.IMI_ADMIN_CERT_FINGERPRINTS = `${validEmail}=${validFingerprint},${invalidEmail}=nothex`;
  });

  afterAll(async () => {
    delete process.env.IMI_ADMIN_CERT_FINGERPRINTS;
    await db('admin_cert_fingerprints').where({ email: validEmail }).del();
  });

  it('seeds the valid fingerprint and skips the invalid one', async () => {
    await bootstrapAdminCertFingerprints();

    const validRow = await db('admin_cert_fingerprints').where({ email: validEmail }).first();
    expect(validRow).toBeDefined();
    expect(validRow.fingerprint).toBe(validFingerprint);

    const invalidRow = await db('admin_cert_fingerprints').where({ email: invalidEmail }).first();
    expect(invalidRow).toBeUndefined();
  });

  it('running the bootstrap again does not duplicate the row', async () => {
    await bootstrapAdminCertFingerprints();

    const rows = await db('admin_cert_fingerprints').where({ email: validEmail });
    expect(rows).toHaveLength(1);
  });
});
