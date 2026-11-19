/**
 * incident-blocks.service.ts – What the incident register currently blocks
 * (migration 035), read by the allow-list build, certificate upload and
 * certificate login:
 * - organizations suspended by an incident (incidents.suspended = 1) are
 *   published as withdrawn;
 * - SHA-512 thumbprints in blocked_certificate_thumbprints are never
 *   uploaded again, never published and never log in. A block row stays for good; it is
 *   effective until two admins lifted it for a false alarm (certificate_block_lifts, migration
 *   041, see incident-block-lifts.service). Every consumer goes through effectiveBlocks, so a
 *   lift is respected everywhere at once.
 * Only plain reads and the block insert live here, so the allow-list and
 * certificate services can use it without importing the incident workflow.
 * Dependencies: db/connection
 */
import type { Knex } from 'knex';
import { db } from '../db/connection';

/** Changes to the stored suspensions for a version published before they are committed. */
export interface SuspensionOverrides {
  /** Treat this organization as suspended. */
  suspend?: string;
  /** Leave out the suspension of this incident (it is being lifted). */
  excludeIncidentId?: string;
}

/** Identifiers of the organizations an incident currently suspends. */
export async function suspendedOrganizations(
  overrides: SuspensionOverrides = {},
): Promise<Set<string>> {
  const query = db('incidents').where({ suspended: 1 }).whereNotNull('organization_id');
  if (overrides.excludeIncidentId) query.whereNot('id', overrides.excludeIncidentId);
  const ids: string[] = await query.distinct().pluck('organization_id');
  const set = new Set(ids);
  if (overrides.suspend) set.add(overrides.suspend);
  return set;
}

/**
 * The block rows that are still effective: those without a lift record for their (fingerprint,
 * incident). Rows are aliased `b`; add conditions on b.fingerprint / b.incident_id.
 */
export function effectiveBlocks(conn: Knex | Knex.Transaction = db) {
  return conn('blocked_certificate_thumbprints as b').whereNotExists(
    conn('certificate_block_lifts as l')
      .whereRaw('l.fingerprint = b.fingerprint')
      .whereRaw('l.incident_id = b.incident_id'),
  );
}

/** Every effectively blocked SHA-512 thumbprint (lower-case hex). */
export async function blockedFingerprints(): Promise<Set<string>> {
  // No DISTINCT here: with it MySQL sometimes drops the NOT EXISTS (lift) condition's effect and
  // loses a block; the Set de-duplicates.
  const fps: string[] = await effectiveBlocks().pluck('b.fingerprint');
  return new Set(fps.map((f) => f.toLowerCase()));
}

export async function isFingerprintBlocked(
  fingerprint: string,
  conn: Knex | Knex.Transaction = db,
): Promise<boolean> {
  const row = await effectiveBlocks(conn)
    .where('b.fingerprint', fingerprint.toLowerCase())
    .first('b.fingerprint');
  return !!row;
}

/**
 * Block thumbprints for an incident. Every thumbprint gets its own (fingerprint, incident) row,
 * also when another incident already blocks it: lifting the first incident's false-alarm blocks
 * must not unblock what this incident still blocks. Returns the count of thumbprints that were
 * not effectively blocked before.
 */
export async function blockFingerprints(
  conn: Knex | Knex.Transaction,
  fingerprints: string[],
  incidentId: string,
  actorEmail: string,
): Promise<number> {
  const unique = [...new Set(fingerprints.map((f) => f.toLowerCase()))];
  if (unique.length === 0) return 0;
  const existing = new Set<string>(
    (await effectiveBlocks(conn).whereIn('b.fingerprint', unique).pluck('b.fingerprint')).map(
      (f: string) => f.toLowerCase(),
    ),
  );
  const fresh = unique.filter((f) => !existing.has(f));
  const now = new Date();
  await conn('blocked_certificate_thumbprints')
    .insert(
      unique.map((fingerprint) => ({
        fingerprint,
        incident_id: incidentId,
        created_by: actorEmail,
        created_at: now,
      })),
    )
    .onConflict(['fingerprint', 'incident_id'])
    .ignore();
  return fresh.length;
}
