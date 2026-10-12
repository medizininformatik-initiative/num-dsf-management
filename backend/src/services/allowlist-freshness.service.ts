/**
 * allowlist-freshness.service.ts – which allow-list version a site (instance)
 * has obtained, and whether a newer one is waiting.
 *
 * recordAllowListFetch keeps one row per instance (allowlist_fetches, migration
 * 032) holding the newest version the site obtained through its DSF (mTLS
 * fetch) or a portal download; the version number never decreases.
 * getAllowListFreshness compares it with the current published version.
 * Dependencies: db/connection, bundle-versions.service
 */
import { db } from '../db/connection';
import { currentVersionNumber } from './bundle-versions.service';

export type FetchChannel = 'DSF' | 'PORTAL';

export interface AllowListFreshness {
  currentVersion: number | null;
  currentPublishedAt: string | null;
  lastObtainedVersion: number | null;
  lastObtainedAt: string | null;
  via: FetchChannel | null;
  outdated: boolean;
}

/**
 * Remember that `instanceId` obtained `versionNumber`. An older version never
 * replaces a newer one; fetching the same version again refreshes the time.
 * MySQL evaluates the assignments left to right, so version_number is last.
 */
export async function recordAllowListFetch(
  instanceId: string,
  versionNumber: number,
  via: FetchChannel,
): Promise<void> {
  await db.raw(
    `INSERT INTO allowlist_fetches (instance_id, version_number, via, fetched_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       via = IF(VALUES(version_number) >= version_number, VALUES(via), via),
       fetched_at = IF(VALUES(version_number) >= version_number, VALUES(fetched_at), fetched_at),
       version_number = GREATEST(version_number, VALUES(version_number))`,
    [instanceId, versionNumber, via, new Date()],
  );
}

/**
 * A failed record must never break a download: the returned promise never
 * rejects. Callers that do not need to wait simply ignore it.
 */
export function recordAllowListFetchSafe(
  instanceId: string,
  versionNumber: number | null | undefined,
  via: FetchChannel,
): Promise<void> {
  if (!versionNumber) return Promise.resolve();
  return recordAllowListFetch(instanceId, versionNumber, via).catch(() => {});
}

export async function getAllowListFreshness(instanceId: string): Promise<AllowListFreshness> {
  const current = await currentVersionNumber();
  const [version, fetched, approved, endpoint] = await Promise.all([
    current === null
      ? null
      : db('bundle_versions').where({ version_number: current }).select('created_at').first(),
    db('allowlist_fetches').where({ instance_id: instanceId }).first(),
    db('approval_requests').where({ instance_id: instanceId, status: 'APPROVED' }).first('id'),
    db('endpoints as e')
      .join('organizations as o', 'o.identifier', 'e.organization_id')
      .where('o.instance_id', instanceId)
      .first('e.identifier'),
  ]);
  const lastObtainedVersion: number | null = fetched ? Number(fetched.version_number) : null;
  const outdated =
    current !== null &&
    Boolean(approved) &&
    Boolean(endpoint) &&
    (lastObtainedVersion === null || lastObtainedVersion < current);
  return {
    currentVersion: current,
    currentPublishedAt: version ? new Date(version.created_at).toISOString() : null,
    lastObtainedVersion,
    lastObtainedAt: fetched ? new Date(fetched.fetched_at).toISOString() : null,
    via: fetched ? (fetched.via as FetchChannel) : null,
    outdated,
  };
}
