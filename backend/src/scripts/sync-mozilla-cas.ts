/**
 * sync-mozilla-cas.ts – Pull the curl/Mozilla CA bundle (PEM list) and upsert
 * (fingerprint, subject_dn) into known_cas. Idempotent; safe to run daily.
 *
 * Source: https://curl.se/ca/cacert.pem  (Mozilla-derived, refreshed by the
 *         curl maintainers from CCADB. CDN-cached, signed, well-maintained.)
 *
 * Usage:  npm run sync:cas    (from backend/)
 */
import 'dotenv/config';
import crypto from 'crypto';
import { db } from '../db/connection';
import { logger } from '../lib/logger';

const URL = process.env.MOZILLA_CA_URL || 'https://curl.se/ca/cacert.pem';

export function splitPems(bundle: string): string[] {
  // The Mozilla bundle interleaves PEM blocks with metadata comments
  // ("# Issuer: …", "# Serial: …"). A naive lookahead-split picks up the
  // following comment as a suffix on each PEM, which then fails the
  // endsWith('-----END CERTIFICATE-----') check. Match the PEM body
  // explicitly instead.
  const re = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  return bundle.match(re) ?? [];
}

// node:crypto rather than node-forge: forge reads RSA keys only and skipped
// every EC root as malformed, among them HARICA TLS ECC Root CA 2021 and
// USERTrust ECC, which DSF trusts.
export function fingerprintOf(pem: string): string {
  const cert = new crypto.X509Certificate(pem);
  return crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase();
}

/** Subject DN in certificate order, joined like the certificate service's issuer DN. */
export function subjectDnOf(pem: string): string {
  return new crypto.X509Certificate(pem).subject.split('\n').join(',');
}

export async function syncOnce(text: string): Promise<{ upserted: number; skipped: number }> {
  const pems = splitPems(text);
  let upserted = 0;
  let skipped = 0;
  for (const pem of pems) {
    try {
      const fingerprint = fingerprintOf(pem);
      const subject_dn = subjectDnOf(pem);
      await db('known_cas')
        .insert({ fingerprint, subject_dn, source: 'mozilla', synced_at: new Date() })
        .onConflict('fingerprint')
        .merge({ subject_dn, synced_at: new Date() });
      upserted++;
    } catch (e) {
      skipped++;
      logger.warn({ err: e instanceof Error ? e.message : 'unknown' }, 'skipped malformed CA PEM');
    }
  }
  return { upserted, skipped };
}

async function main() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${URL}`);
  const text = await res.text();
  const stats = await syncOnce(text);
  logger.info(stats, 'known_cas sync complete');
  await db.destroy();
}

// Run when invoked directly, skip when imported (e.g. by tests).
if (require.main === module) {
  main().catch((err) => {
    logger.fatal(
      { err: err instanceof Error ? err.message : 'unknown' },
      'sync-mozilla-cas failed',
    );
    process.exit(1);
  });
}
