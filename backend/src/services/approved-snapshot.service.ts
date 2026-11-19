/**
 * approved-snapshot.service.ts – Which data a site publishes: the snapshot of
 * its LATEST APPROVED approval request, never live edits and never a newer
 * request that is still pending, rejected or withdrawn.
 * - loadLatestApprovedSites: one query, the newest APPROVED request per
 *   instance joined with its organization.
 * - Snapshot readers (allowListSection, snapshotEndpoints, ...) tolerate the
 *   legacy snapshot shape (before the allowList section existed) and return
 *   null/undefined for snapshots that carry nothing usable (NULL, `{}`), so
 *   callers can fall back to live data for that one organization.
 * Certificate PEMs are never part of a snapshot (thumbprints only).
 * Dependencies: db/connection, lib/allowListBundle (types), lib/logger
 */
import { db } from '../db/connection';
import type { AllowListMember } from '../lib/allowListBundle';
import { logger } from '../lib/logger';

/** The allow-list part of snapshot_json, computed at submit time. */
export interface AllowListSection {
  version: 1;
  active: boolean;
  member: AllowListMember;
}

type Json = Record<string, unknown>;

export interface ApprovedSite {
  requestId: string;
  instanceId: string;
  /** Live organization row: identifier is immutable, the rest is the fallback. */
  orgIdentifier: string;
  orgName: string;
  orgActive: boolean;
  /** The instance was removed by two admins (migration 039): withdrawn whatever the snapshot says. */
  removed: boolean;
  /** Parsed snapshot_json, or null when NULL/unparseable. */
  snapshot: Json | null;
}

interface ApprovedRow {
  id: string;
  instance_id: string;
  snapshot_json: unknown;
  identifier: string;
  name: string;
  active: unknown;
  removed_at: unknown;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSnapshot(raw: unknown): Json | null {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isObject(value) ? value : null;
}

/**
 * The newest APPROVED request of every instance (created_at, id DESC breaks
 * timestamp ties), joined with the instance's organization. Instances
 * without an approved request are not in the result.
 */
export async function loadLatestApprovedSites(): Promise<ApprovedSite[]> {
  const result = (await db.raw(
    `SELECT r.id, r.instance_id, r.snapshot_json, o.identifier, o.name, o.active, i.removed_at
       FROM (
         SELECT id, instance_id, snapshot_json,
                ROW_NUMBER() OVER (
                  PARTITION BY instance_id ORDER BY created_at DESC, id DESC
                ) AS rn
           FROM approval_requests
          WHERE status = 'APPROVED'
       ) r
       JOIN organizations o ON o.instance_id = r.instance_id
       JOIN instances i ON i.id = r.instance_id
      WHERE r.rn = 1
      ORDER BY o.identifier`,
  )) as [ApprovedRow[], unknown];
  return result[0].map((row) => ({
    requestId: row.id,
    instanceId: row.instance_id,
    orgIdentifier: row.identifier,
    orgName: row.name,
    orgActive: Boolean(row.active),
    removed: row.removed_at !== null && row.removed_at !== undefined,
    snapshot: parseSnapshot(row.snapshot_json),
  }));
}

/** The allowList section of a snapshot, when present and well-formed. */
export function allowListSection(snapshot: Json | null): AllowListSection | null {
  const section = snapshot?.allowList;
  if (!isObject(section) || section.version !== 1 || typeof section.active !== 'boolean') {
    return null;
  }
  const member = section.member;
  if (
    !isObject(member) ||
    typeof member.identifier !== 'string' ||
    !Array.isArray(member.thumbprints) ||
    !Array.isArray(member.endpoints) ||
    !Array.isArray(member.affiliations)
  ) {
    return null;
  }
  return section as unknown as AllowListSection;
}

/** Legacy snapshots: organization object plus endpoint and membership arrays. */
export function isUsableLegacySnapshot(snapshot: Json | null): snapshot is Json {
  return (
    snapshot !== null &&
    isObject(snapshot.organization) &&
    Array.isArray(snapshot.endpoints) &&
    Array.isArray(snapshot.memberships)
  );
}

/** True when the snapshot says nothing usable about the site's published data. */
export function isSnapshotUnusable(snapshot: Json | null): boolean {
  return allowListSection(snapshot) === null && !isUsableLegacySnapshot(snapshot);
}

export function warnUnusableSnapshot(site: ApprovedSite): void {
  logger.warn(
    { organization: site.orgIdentifier, requestId: site.requestId },
    'approved request has no usable snapshot, publishing the live data of this organization',
  );
}

/** Whether the approved state of the site is active (live value as fallback); a removed site never is. */
export function approvedActive(site: ApprovedSite): boolean {
  if (site.removed) return false;
  const section = allowListSection(site.snapshot);
  if (section) return section.active;
  const org = site.snapshot?.organization;
  if (isObject(org) && org.active !== undefined && org.active !== null) {
    return Boolean(org.active);
  }
  return site.orgActive;
}

export interface SnapshotEndpoint {
  identifier: string;
  name: string | null;
  address: string;
  ips: Array<{ ip: string; is_fhir: boolean; is_bpe: boolean }>;
}

/** Endpoints with IPs as approved; null when the snapshot has none to give. */
export function snapshotEndpoints(snapshot: Json | null): SnapshotEndpoint[] | null {
  if (!snapshot || !Array.isArray(snapshot.endpoints)) return null;
  return (snapshot.endpoints as unknown[]).filter(isObject).map((ep) => {
    const ips = Array.isArray(ep.ipAddresses)
      ? ep.ipAddresses
      : Array.isArray(ep.ips)
        ? ep.ips
        : [];
    return {
      identifier: String(ep.identifier),
      name: typeof ep.name === 'string' ? ep.name : null,
      address: String(ep.address ?? ''),
      ips: (ips as unknown[]).filter(isObject).map((ip) => ({
        ip: String(ip.ip),
        is_fhir: Boolean(ip.is_fhir),
        is_bpe: Boolean(ip.is_bpe),
      })),
    };
  });
}

export interface SnapshotMembership {
  parent_organization: string;
  endpoint_id: string;
  roles: unknown;
}

/** Active memberships as approved; null when the snapshot has none to give. */
export function snapshotMemberships(snapshot: Json | null): SnapshotMembership[] | null {
  if (!snapshot || !Array.isArray(snapshot.memberships)) return null;
  return (snapshot.memberships as unknown[])
    .filter(isObject)
    .filter((m) => !m.deleted_at)
    .map((m) => ({
      parent_organization: String(m.parent_organization),
      endpoint_id: String(m.endpoint_id),
      roles: m.roles,
    }));
}

/** Ids of the certificates that were part of the approved state; null when unknown. */
export function snapshotCertificateIds(snapshot: Json | null): string[] | null {
  if (!snapshot || !Array.isArray(snapshot.certificates)) return null;
  return (snapshot.certificates as unknown[])
    .filter(isObject)
    .map((c) => c.id)
    .filter((id): id is string => typeof id === 'string');
}

/** A string field of the snapshot's organization object, when present. */
export function snapshotOrgField(snapshot: Json | null, key: string): string | null {
  const org = snapshot?.organization;
  if (!isObject(org)) return null;
  const value = org[key];
  return typeof value === 'string' ? value : null;
}
