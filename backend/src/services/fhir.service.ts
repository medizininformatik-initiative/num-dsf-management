/**
 * fhir.service.ts – Loads the allow-list data and builds the DSF bundles.
 * - loadAllowListInput: the live network state, the one input every bundle
 *   and every stored bundle version is built from.
 * - renderReceiverBundle / renderFullBundle: pure views of such an input.
 * - generateBundle: receiver-scoped bundle for one endpoint built from the
 *   live state (fallback before the first stored version exists).
 * - generateFullBundle: network-wide bundle from the live state.
 * The bundle shape itself lives in lib/allowListBundle. Contact data,
 * including the organization e-mail, is never loaded here (GDPR, F-BND-04).
 * Dependencies: db/connection, lib/allowListBundle, lib/allowListInput,
 *               lib/certFingerprint, lib/jsonColumn, lib/logger
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
  type AllowListRemoval,
} from '../lib/allowListBundle';
import { fullViewInput, receiverViewInput, type StoredAllowListInput } from '../lib/allowListInput';

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
export async function loadRemovedOrganizations(): Promise<AllowListRemoval[]> {
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
export async function loadMembers(orgs: OrgSummary[]): Promise<AllowListMember[]> {
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

/**
 * The live network state: every approved organization (including the
 * receiver of a later view), the withdrawn organizations and the parent
 * display names. Stored with each bundle version.
 */
export async function loadAllowListInput(): Promise<StoredAllowListInput> {
  const approved = await loadApprovedOrganizations();
  const members = await loadMembers(approved);
  logUnpublishable(members);
  const parentIds = Array.from(
    new Set(members.flatMap((m) => m.affiliations.map((a) => a.parent))),
  ).filter(Boolean);
  const [parentNames, removed] = await Promise.all([
    loadParentNames(parentIds),
    loadRemovedOrganizations(),
  ]);
  return { members, removed, parentNames: Object.fromEntries(parentNames) };
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

/** Receiver view of the live state (fallback before a stored version exists). */
export async function generateBundle(
  instanceId: string,
  endpointId: string,
): Promise<AllowListBundle> {
  const { organization, endpoint } = await resolveReceiver(instanceId, endpointId);
  return renderReceiverBundle(await loadAllowListInput(), organization, endpoint);
}

/** Network-wide allow list of the live state. */
export async function generateFullBundle(): Promise<AllowListBundle> {
  return renderFullBundle(await loadAllowListInput());
}
