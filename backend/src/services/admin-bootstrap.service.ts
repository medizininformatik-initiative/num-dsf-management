/**
 * admin-bootstrap.service.ts – On backend startup: if admin_grants is empty,
 * create signed grants from IMI_ADMIN_EMAILS env var. Idempotent.
 * After first successful run, the env var is ignored at runtime.
 * Also seeds admin_cert_fingerprints from IMI_ADMIN_CERT_FINGERPRINTS on every
 * run (not gated on existing rows, so new pairs can be added later).
 * Dependencies: db/connection, lib/adminGrants, lib/certFingerprint, uuid
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { signGrant } from '../lib/adminGrants';
import { normalizeFingerprint, isValidSha512Fingerprint } from '../lib/certFingerprint';
import { logger } from '../lib/logger';

export async function bootstrapAdminGrants(): Promise<void> {
  await bootstrapAdminCertFingerprints();

  try {
    const existing = await db('admin_grants').count('email as n').first();
    const n = Number((existing as { n: number | string } | undefined)?.n ?? 0);
    if (n > 0) return;

    const raw = process.env.IMI_ADMIN_EMAILS || '';
    const emails = raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (emails.length === 0) {
      logger.warn(
        '[admin-bootstrap] admin_grants empty AND IMI_ADMIN_EMAILS not set — no admins exist',
      );
      return;
    }

    // MySQL TIMESTAMP truncates to whole seconds; the signature must be over
    // the SAME timestamp value that's stored, otherwise verifyGrant fails on
    // round-trip. Round to seconds before signing AND inserting.
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    for (const email of emails) {
      const sig = signGrant(email, now, 'SYSTEM:bootstrap', 'SYSTEM:bootstrap');
      await db('admin_grants')
        .insert({
          email,
          granted_at: now,
          granted_by_a: 'SYSTEM:bootstrap',
          granted_by_b: 'SYSTEM:bootstrap',
          signature_hex: sig,
        })
        .onConflict('email')
        .ignore();
    }
    logger.info(
      `[admin-bootstrap] Created ${emails.length} signed admin_grants from IMI_ADMIN_EMAILS. Future runs will ignore the env var.`,
    );
  } catch (err) {
    logger.error({ err }, '[admin-bootstrap] failed');
  }
}

/**
 * Seed admin_cert_fingerprints from IMI_ADMIN_CERT_FINGERPRINTS (comma-
 * separated `email=fingerprint` pairs). Each pair is validated independently;
 * an invalid entry is skipped with a warning rather than aborting the batch.
 * Idempotent via onConflict('fingerprint').ignore() — safe to run every boot.
 */
export async function bootstrapAdminCertFingerprints(): Promise<void> {
  try {
    const raw = process.env.IMI_ADMIN_CERT_FINGERPRINTS || '';
    const pairs = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (pairs.length === 0) return;

    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      const email = (eqIdx === -1 ? '' : pair.slice(0, eqIdx)).trim().toLowerCase();
      const fingerprint = normalizeFingerprint(eqIdx === -1 ? '' : pair.slice(eqIdx + 1));
      if (!email || !isValidSha512Fingerprint(fingerprint)) {
        logger.warn(
          `[admin-bootstrap] skipping invalid IMI_ADMIN_CERT_FINGERPRINTS entry: "${pair}"`,
        );
        continue;
      }
      await db('admin_cert_fingerprints')
        .insert({
          id: uuidv4(),
          email,
          fingerprint,
          created_by: 'bootstrap',
          created_at: new Date(),
        })
        .onConflict('fingerprint')
        .ignore();
    }
  } catch (err) {
    logger.error({ err }, '[admin-bootstrap] cert fingerprint bootstrap failed');
  }
}
