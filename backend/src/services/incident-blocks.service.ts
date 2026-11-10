/**
 * incident-blocks.service.ts – What the incident register currently blocks
 * (migration 035), read by the allow-list build, certificate upload and
 * certificate login:
 * - organizations suspended by an incident (incidents.suspended = 1) are
 *   published as withdrawn;
 * - SHA-512 thumbprints in blocked_certificate_thumbprints are never
 *   uploaded again, never published and never log in. Blocks are permanent.
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

/** Every blocked SHA-512 thumbprint (lower-case hex). */
export async function blockedFingerprints(): Promise<Set<string>> {
  const fps: string[] = await db('blocked_certificate_thumbprints').pluck('fingerprint');
  return new Set(fps.map((f) => f.toLowerCase()));
}

export async function isFingerprintBlocked(
  fingerprint: string,
  conn: Knex | Knex.Transaction = db,
): Promise<boolean> {
  const row = await conn('blocked_certificate_thumbprints')
    .where({ fingerprint: fingerprint.toLowerCase() })
    .first('fingerprint');
  return !!row;
}

/** Block thumbprints for an incident; already blocked ones stay as they are. Returns the newly blocked count. */
export async function blockFingerprints(
  conn: Knex | Knex.Transaction,
  fingerprints: string[],
  incidentId: string,
  actorEmail: string,
): Promise<number> {
  const unique = [...new Set(fingerprints.map((f) => f.toLowerCase()))];
  if (unique.length === 0) return 0;
  const existing = new Set<string>(
    await conn('blocked_certificate_thumbprints')
      .whereIn('fingerprint', unique)
      .pluck('fingerprint'),
  );
  const fresh = unique.filter((f) => !existing.has(f));
  if (fresh.length === 0) return 0;
  const now = new Date();
  await conn('blocked_certificate_thumbprints')
    .insert(
      fresh.map((fingerprint) => ({
        fingerprint,
        incident_id: incidentId,
        created_by: actorEmail,
        created_at: now,
      })),
    )
    .onConflict('fingerprint')
    .ignore();
  return fresh.length;
}
