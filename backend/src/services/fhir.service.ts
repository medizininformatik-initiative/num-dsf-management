/**
 * fhir.service.ts – Loads the allow-list data and builds the DSF bundles.
 * - loadAllowListInput: the approved network state (per site the data of its
 *   latest APPROVED request), the one input every bundle and every stored
 *   bundle version is built from.
 * - renderReceiverBundle / renderFullBundle: pure views of such an input.
 * - generateBundle: receiver-scoped bundle for one endpoint built from the
 *   approved state (fallback before the first stored version exists).
 * - generateFullBundle: network-wide bundle from the approved state.
 * The bundle shape itself lives in lib/allowListBundle. Contact data,
 * including the organization e-mail, is never loaded here (GDPR, F-BND-04).
 * Incident suspensions and blocked thumbprints override the approved state.
 * Dependencies: db/connection, approved-snapshot.service, lib/allowListBundle, lib/allowListInput,
 *               lib/certFingerprint, lib/jsonColumn, lib/logger, incident-blocks.service
 */
import type { Knex } from 'knex';
import { db } from '../db/connection';
import type { CertRow } from '../types/rows';
import { parseJsonStringArray as readRoles } from '../lib/jsonColumn';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import { logger } from '../lib/logger';
import {
  buildAllowListBundle,
  isPublishable,
  type AllowListBundle,
  type AllowListMember,
  type AllowListRemoval,
} from '../lib/allowListBundle';
import {
  allowListSection,
  approvedActive,
  isSnapshotUnusable,
  isUsableLegacySnapshot,
  loadLatestApprovedSites,
  snapshotCertificateIds,
  snapshotEndpoints,
  snapshotMemberships,
  snapshotOrgField,
  warnUnusableSnapshot,
  type ApprovedSite,
} from './approved-snapshot.service';
import { KNOWN_PARENT_NAMES } from '../lib/knownParents';
import {
  applyIncidentBlocks,
  fullViewInput,
  receiverViewInput,
  toRemoval,
  type StoredAllowListInput,
} from '../lib/allowListInput';
import { blockedFingerprints, suspendedOrganizations } from './incident-blocks.service';

interface OrgSummary {
  identifier: string;
  name: string;
}

interface MembershipWithDeletion {
  organization_id: string;
  parent_organization: string;
  endpoint_id: string;
  roles: unknown;
  deleted_at: Date | string | null;
}

/**
 * SHA-512 DSF thumbprint of a stored certificate (128 lower-case hex, DSF
 * constraint hex-128-length). certificates.thumbprint is SHA-256 and stays
 * internal. A PEM that fails to parse is corrupted at-rest data: surface it,
 * naming the certificate id, instead of silently dropping the thumbprint.
 */
export function dsfThumbprint(cert: Pick<CertRow, 'id' | 'pem'>): string {
  try {
    return sha512FingerprintFromPem(cert.pem);
  } catch {
    throw new Error(`CERTIFICATE_PEM_INVALID:${cert.id}`);
  }
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

/** Batch-load endpoints, certificates and memberships of the given organizations. */
export async function loadMembers(
  orgs: OrgSummary[],
  conn: Knex | Knex.Transaction = db,
): Promise<AllowListMember[]> {
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.identifier);
  const [endpoints, certs, memberships] = await Promise.all([
    conn('endpoints')
      .whereIn('organization_id', ids)
      .select('identifier', 'organization_id', 'name', 'address'),
    conn('certificates')
      .whereIn('organization_id', ids)
      .select('id', 'organization_id', 'pem')
      .orderBy([{ column: 'created_at' }, { column: 'id' }]),
    conn('memberships')
      .whereIn('organization_id', ids)
      .select('organization_id', 'parent_organization', 'endpoint_id', 'roles', 'deleted_at'),
  ]);
  const endpointsByOrg = groupBy(
    endpoints as Array<{
      identifier: string;
      organization_id: string;
      name: string | null;
      address: string;
    }>,
    (e) => e.organization_id,
  );
  const certsByOrg = groupBy(
    certs as Array<Pick<CertRow, 'id' | 'organization_id' | 'pem'>>,
    (c) => c.organization_id,
  );
  const membershipsByOrg = groupBy(
    memberships as MembershipWithDeletion[],
    (m) => m.organization_id,
  );

  return orgs.map((org) => {
    const rows = membershipsByOrg.get(org.identifier) ?? [];
    return {
      identifier: org.identifier,
      name: org.name,
      thumbprints: (certsByOrg.get(org.identifier) ?? []).map(dsfThumbprint),
      endpoints: (endpointsByOrg.get(org.identifier) ?? []).map((e) => ({
        identifier: e.identifier,
        name: e.name,
        address: e.address,
      })),
      affiliations: rows
        .filter((m) => !m.deleted_at)
        .map((m) => ({
          parent: m.parent_organization,
          endpoint: m.endpoint_id,
          roles: readRoles(m.roles),
        })),
      removedAffiliations: rows
        .filter((m) => m.deleted_at)
        .map((m) => ({ parent: m.parent_organization, endpoint: m.endpoint_id })),
    };
  });
}

/** Display names for parents: stored organization name, known name, else the identifier. */
export async function loadParentNames(parentIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of parentIds) {
    if (KNOWN_PARENT_NAMES[id]) names.set(id, KNOWN_PARENT_NAMES[id]);
  }
  if (parentIds.length > 0) {
    const rows: OrgSummary[] = await db('organizations')
      .whereIn('identifier', parentIds)
      .select('identifier', 'name');
    for (const row of rows) names.set(row.identifier, row.name);
  }
  return names;
}

function logUnpublishable(members: AllowListMember[]): void {
  const skipped = members.filter((m) => !isPublishable(m)).map((m) => m.identifier);
  if (skipped.length > 0) {
    logger.warn(
      { organizations: skipped },
      'allow-list bundle: approved organizations without certificate or endpoint left out',
    );
  }
}

type CertPem = Pick<CertRow, 'id' | 'pem'>;

/**
 * Member of a legacy snapshot (submitted before the allowList section
 * existed). Certificate rows are only ever added or removed, never edited, so
 * the live PEM of an id listed in the snapshot is the approved one. When none
 * of the listed certificates exists any more (renewed after the approval,
 * before snapshots carried thumbprints), the site's live certificates are
 * used instead of publishing it without a thumbprint.
 */
function legacyMember(
  site: ApprovedSite,
  certsById: Map<string, CertPem>,
  liveCertsByOrg: Map<string, CertPem[]>,
): AllowListMember {
  const snapshot = site.snapshot;
  let certs = (snapshotCertificateIds(snapshot) ?? [])
    .map((id) => certsById.get(id))
    .filter((c): c is CertPem => c !== undefined);
  if (certs.length === 0) {
    certs = liveCertsByOrg.get(site.orgIdentifier) ?? [];
    if (certs.length > 0) {
      logger.warn(
        { organization: site.orgIdentifier, requestId: site.requestId },
        'approved legacy snapshot lists no existing certificate, publishing the live certificates',
      );
    }
  }
  const thumbprints = certs.map(dsfThumbprint);
  return {
    identifier: site.orgIdentifier,
    name: snapshotOrgField(snapshot, 'name') ?? site.orgName,
    thumbprints,
    endpoints: (snapshotEndpoints(snapshot) ?? []).map((e) => ({
      identifier: e.identifier,
      name: e.name,
      address: e.address,
    })),
    affiliations: (snapshotMemberships(snapshot) ?? []).map((m) => ({
      parent: m.parent_organization,
      endpoint: m.endpoint_id,
      roles: readRoles(m.roles),
    })),
    removedAffiliations: [],
  };
}

/**
 * Every site contributes the data of its LATEST APPROVED request: members of
 * active sites, removals of sites whose deactivation was approved. A newer
 * pending, rejected or withdrawn request and any unsubmitted live edit change
 * nothing. A site whose approved request carries no usable snapshot falls back
 * to its live data (and a warning).
 */
async function loadApprovedState(): Promise<{
  members: AllowListMember[];
  removed: AllowListRemoval[];
}> {
  const sites = await loadLatestApprovedSites();
  const legacy = sites.filter(
    (s) => allowListSection(s.snapshot) === null && isUsableLegacySnapshot(s.snapshot),
  );
  const unusable = sites.filter((s) => isSnapshotUnusable(s.snapshot));
  const certIds = legacy.flatMap((s) => snapshotCertificateIds(s.snapshot) ?? []);
  const [certs, liveMembers] = await Promise.all([
    certIds.length > 0
      ? (db('certificates').whereIn('id', certIds).select('id', 'pem') as Promise<CertPem[]>)
      : Promise.resolve([] as CertPem[]),
    loadMembers(unusable.map((s) => ({ identifier: s.orgIdentifier, name: s.orgName }))),
  ]);
  const certsById = new Map(certs.map((c) => [c.id, c]));
  // Legacy sites none of whose approved certificates still exists (see legacyMember).
  const orphaned = legacy
    .filter((s) => !(snapshotCertificateIds(s.snapshot) ?? []).some((id) => certsById.has(id)))
    .map((s) => s.orgIdentifier);
  const liveCerts: Array<CertPem & { organization_id: string }> =
    orphaned.length > 0
      ? await db('certificates')
          .whereIn('organization_id', orphaned)
          .select('id', 'organization_id', 'pem')
          .orderBy([{ column: 'created_at' }, { column: 'id' }])
      : [];
  const liveCertsByOrg = groupBy(liveCerts, (c) => c.organization_id);
  const liveByOrg = new Map(liveMembers.map((m) => [m.identifier, m]));

  const members: AllowListMember[] = [];
  const removed: AllowListRemoval[] = [];
  for (const site of sites) {
    const section = allowListSection(site.snapshot);
    let active: boolean;
    let member: AllowListMember;
    if (section) {
      active = section.active;
      member = section.member;
    } else if (isUsableLegacySnapshot(site.snapshot)) {
      active = approvedActive(site);
      member = legacyMember(site, certsById, liveCertsByOrg);
    } else {
      warnUnusableSnapshot(site);
      active = site.orgActive;
      member = liveByOrg.get(site.orgIdentifier) as AllowListMember;
    }
    if (active) members.push(member);
    else removed.push(toRemoval(member));
  }
  return { members, removed };
}

/**
 * The state to publish: the approved data of every site, the withdrawn
 * organizations and the parent display names, with the incident register's
 * suspensions and blocked thumbprints applied. Stored with each bundle version.
 */
export async function loadAllowListInput(): Promise<StoredAllowListInput> {
  const approved = await loadApprovedState();
  const { members, removed } = await withIncidentBlocks({ ...approved, parentNames: {} });
  logUnpublishable(members);
  const parentIds = Array.from(
    new Set(members.flatMap((m) => m.affiliations.map((a) => a.parent))),
  ).filter(Boolean);
  const parentNames = await loadParentNames(parentIds);
  return { members, removed, parentNames: Object.fromEntries(parentNames) };
}

/** An input with the current incident suspensions and thumbprint blocks applied. */
export async function withIncidentBlocks(
  input: StoredAllowListInput,
): Promise<StoredAllowListInput> {
  const [suspended, blocked] = await Promise.all([suspendedOrganizations(), blockedFingerprints()]);
  return applyIncidentBlocks(input, suspended, blocked);
}

/** Network-wide allow list rendered from a stored or live input. */
export function renderFullBundle(input: StoredAllowListInput): AllowListBundle {
  return buildAllowListBundle(fullViewInput(input));
}

export interface BundleVersionMeta {
  number: number;
  createdAt: Date;
}

/**
 * Receiver view of an input: every other approved organization with
 * endpoints, thumbprints and affiliations, plus the receiver's own
 * affiliations for this endpoint (only once the receiver itself is approved).
 * The receiver's own Organization and Endpoint are left out; its DSF server
 * already holds them. With `version`, Bundle.meta carries versionId and
 * lastUpdated so the DSF client can tell versions apart.
 */
export function renderReceiverBundle(
  input: StoredAllowListInput,
  organization: string,
  endpoint: string,
  version?: BundleVersionMeta,
): AllowListBundle {
  const bundle = buildAllowListBundle(receiverViewInput(input, organization, endpoint));
  if (!version) return bundle;
  return {
    ...bundle,
    meta: {
      versionId: String(version.number),
      lastUpdated: version.createdAt.toISOString(),
      tag: bundle.meta.tag,
    },
  };
}

/**
 * Resolve the endpoint among the endpoints of an instance's organization.
 * Ownership rule shared by every receiver read: an endpoint of another
 * organization is not found.
 * @throws ORGANIZATION_NOT_FOUND / ENDPOINT_NOT_FOUND
 */
export async function resolveReceiver(
  instanceId: string,
  endpointId: string,
): Promise<{ organization: string; endpoint: string }> {
  const org = await db('organizations').where({ instance_id: instanceId }).first();
  if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
  const endpoint = await db('endpoints')
    .where({ identifier: endpointId, organization_id: org.identifier })
    .first();
  if (!endpoint) throw new Error('ENDPOINT_NOT_FOUND');
  return { organization: org.identifier, endpoint: endpoint.identifier };
}

/** Receiver view of the approved state (fallback before a stored version exists). */
export async function generateBundle(
  instanceId: string,
  endpointId: string,
): Promise<AllowListBundle> {
  const { organization, endpoint } = await resolveReceiver(instanceId, endpointId);
  return renderReceiverBundle(await loadAllowListInput(), organization, endpoint);
}

/** Network-wide allow list of the approved state. */
export async function generateFullBundle(): Promise<AllowListBundle> {
  return renderFullBundle(await loadAllowListInput());
}
