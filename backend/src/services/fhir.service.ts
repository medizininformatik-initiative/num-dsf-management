/**
 * fhir.service.ts – Loads the allow-list data and builds the DSF bundles.
 * - generateBundle: receiver-scoped bundle for one endpoint, i.e. what the
 *   DSF allow-list process of that site downloads from /fhir/Bundle/{endpoint}.
 * - generateFullBundle: network-wide bundle (GUI download, version snapshots).
 * The bundle shape itself lives in lib/allowListBundle. Contact data,
 * including the organization e-mail, is never loaded here (GDPR, F-BND-04).
 * Dependencies: db/connection, lib/allowListBundle, lib/certFingerprint,
 *               lib/jsonColumn, lib/logger
 */
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
  type AllowListReceiver,
  type AllowListRemoval,
} from '../lib/allowListBundle';

// Display names of the parent organizations offered in the membership form,
// as the legacy allow-list portal publishes them. A parent that is registered
// as an organization in this tool uses its stored name instead.
const KNOWN_PARENT_NAMES: Readonly<Record<string, string>> = {
  'medizininformatik-initiative.de': 'Medizininformatik-Initiative',
  'netzwerk-universitaetsmedizin.de': 'Netzwerk Universitätsmedizin',
  'eyematics.org': 'Eyematics',
};

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

// The organization's LATEST approval request (by created_at) is APPROVED, so a
// newer REJECTED/PENDING request supersedes an older approval. created_at,
// id DESC breaks timestamp ties deterministically.
const LATEST_REQUEST_APPROVED = `(
      SELECT status FROM approval_requests
      WHERE instance_id = organizations.instance_id
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) = 'APPROVED'`;

/** Organizations in the allow list: active, latest request approved. */
async function loadApprovedOrganizations(): Promise<OrgSummary[]> {
  return db('organizations')
    .where({ active: true })
    .whereRaw(LATEST_REQUEST_APPROVED)
    .select('identifier', 'name');
}

/**
 * Organizations withdrawn from the allow list: deactivated, and that
 * deactivation approved. Every site deletes them with their endpoints and
 * affiliations; a pending deactivation changes nothing yet.
 */
async function loadRemovedOrganizations(): Promise<AllowListRemoval[]> {
  const orgs: OrgSummary[] = await db('organizations')
    .where({ active: false })
    .whereRaw(LATEST_REQUEST_APPROVED)
    .select('identifier', 'name');
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.identifier);
  const [endpoints, memberships] = await Promise.all([
    db('endpoints').whereIn('organization_id', ids).select('identifier', 'organization_id'),
    db('memberships')
      .whereIn('organization_id', ids)
      .select('organization_id', 'parent_organization', 'endpoint_id'),
  ]);
  const endpointsByOrg = groupBy(
    endpoints as Array<{ identifier: string; organization_id: string }>,
    (e) => e.organization_id,
  );
  const membershipsByOrg = groupBy(
    memberships as Array<Omit<MembershipWithDeletion, 'roles' | 'deleted_at'>>,
    (m) => m.organization_id,
  );
  return orgs.map((org) => ({
    identifier: org.identifier,
    endpoints: (endpointsByOrg.get(org.identifier) ?? []).map((e) => e.identifier),
    affiliations: (membershipsByOrg.get(org.identifier) ?? []).map((m) => ({
      parent: m.parent_organization,
      endpoint: m.endpoint_id,
    })),
  }));
}

/** Batch-load endpoints, certificates and memberships of the given organizations. */
async function loadMembers(orgs: OrgSummary[]): Promise<AllowListMember[]> {
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.identifier);
  const [endpoints, certs, memberships] = await Promise.all([
    db('endpoints')
      .whereIn('organization_id', ids)
      .select('identifier', 'organization_id', 'name', 'address'),
    db('certificates')
      .whereIn('organization_id', ids)
      .select('id', 'organization_id', 'pem')
      .orderBy([{ column: 'created_at' }, { column: 'id' }]),
    db('memberships')
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
async function loadParentNames(parentIds: string[]): Promise<Map<string, string>> {
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

async function build(members: AllowListMember[], receiver?: AllowListReceiver) {
  logUnpublishable(members);
  const parentIds = Array.from(
    new Set([
      ...members.flatMap((m) => m.affiliations.map((a) => a.parent)),
      ...(receiver?.affiliations.map((a) => a.parent) ?? []),
    ]),
  ).filter(Boolean);
  const [parentNames, removed] = await Promise.all([
    loadParentNames(parentIds),
    loadRemovedOrganizations(),
  ]);
  return buildAllowListBundle({ members, removed, parentNames, receiver });
}

/**
 * Receiver-scoped allow list for one endpoint of an instance's organization:
 * every other approved organization with endpoints, thumbprints and
 * affiliations, plus the receiver's own affiliations for this endpoint
 * (only once the receiver itself is approved). The receiver's own
 * Organization and Endpoint are left out; its DSF server already holds them.
 * @throws ORGANIZATION_NOT_FOUND / ENDPOINT_NOT_FOUND
 */
export async function generateBundle(
  instanceId: string,
  endpointId: string,
): Promise<AllowListBundle> {
  const org = await db('organizations').where({ instance_id: instanceId }).first();
  if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
  const endpoint = await db('endpoints')
    .where({ identifier: endpointId, organization_id: org.identifier })
    .first();
  if (!endpoint) throw new Error('ENDPOINT_NOT_FOUND');

  const approved = await loadApprovedOrganizations();
  const members = await loadMembers(approved.filter((o) => o.identifier !== org.identifier));

  const receiver: AllowListReceiver = {
    organization: org.identifier,
    endpoint: endpoint.identifier,
    affiliations: [],
    removedAffiliations: [],
  };
  if (approved.some((o) => o.identifier === org.identifier)) {
    const rows: MembershipWithDeletion[] = await db('memberships')
      .where({ organization_id: org.identifier, endpoint_id: endpoint.identifier })
      .select('organization_id', 'parent_organization', 'endpoint_id', 'roles', 'deleted_at');
    receiver.affiliations = rows
      .filter((m) => !m.deleted_at)
      .map((m) => ({ parent: m.parent_organization, roles: readRoles(m.roles) }));
    receiver.removedAffiliations = rows
      .filter((m) => m.deleted_at)
      .map((m) => ({ parent: m.parent_organization }));
  }

  return build(members, receiver);
}

/**
 * Network-wide allow list: every approved organization with its endpoints,
 * SHA-512 thumbprints and affiliations, the parent organizations they point
 * at, DELETE entries for soft-deleted memberships, and DELETE entries for
 * organizations withdrawn from the allow list (with their endpoints and
 * affiliations), as the legacy portal publishes them.
 */
export async function generateFullBundle(): Promise<AllowListBundle> {
  const approved = await loadApprovedOrganizations();
  return build(await loadMembers(approved));
}
