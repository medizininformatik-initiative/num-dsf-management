/**
 * allowListBundle.ts – Pure builder for the DSF allow-list transaction bundle.
 *
 * The bundle is consumed by the DSF allow-list process plugin
 * (dsf-process-allow-list: DownloadAllowList → CheckAllowList →
 * InsertAllowList), which posts it unchanged as a transaction to the
 * receiving site's DSF FHIR server. The shape mirrors the bundles of the
 * legacy allow-list portal and satisfies the DSF 2.x server rules:
 * - No resource.id. DSF parses with setOverrideResourceIdWithBundleEntryFullUrl
 *   (false) and its UpdateCommand rejects a conditional PUT whose resource id
 *   is not the entry's urn:uuid fullUrl (400 bundleEntryBadResourceId).
 * - Every OrganizationAffiliation carries active=true (DSF profile, min 1).
 * - Members without a certificate thumbprint or without an endpoint are left
 *   out: the DSF organization profile requires both (min 1).
 * - One OrganizationAffiliation per (parent, member, endpoint) with the roles
 *   merged into separate code entries. Two PUTs with the same conditional URL
 *   would create duplicates, and every later download would then fail with
 *   412 (multiple matches).
 * - A receiver-scoped bundle leaves out the receiver's own Organization and
 *   Endpoint (its DSF server already holds them) and references both
 *   conditionally from the receiver's affiliations.
 * Ordering follows the legacy portal: parent organizations, the receiver's
 * affiliations, then every member sorted by identifier with its endpoints,
 * affiliations and affiliation deletions.
 * Dependencies: crypto (randomUUID)
 */
import { randomUUID } from 'crypto';

export const ORG_ID_SYSTEM = 'http://dsf.dev/sid/organization-identifier';
export const EP_ID_SYSTEM = 'http://dsf.dev/sid/endpoint-identifier';
export const ORG_ROLE_SYSTEM = 'http://dsf.dev/fhir/CodeSystem/organization-role';
export const READ_ACCESS_TAG_SYSTEM = 'http://dsf.dev/fhir/CodeSystem/read-access-tag';
export const CERT_THUMBPRINT_EXTENSION_URL =
  'http://dsf.dev/fhir/StructureDefinition/extension-certificate-thumbprint';

export const PROFILE_ORG = 'http://dsf.dev/fhir/StructureDefinition/organization';
export const PROFILE_ORG_PARENT = 'http://dsf.dev/fhir/StructureDefinition/organization-parent';
export const PROFILE_ENDPOINT = 'http://dsf.dev/fhir/StructureDefinition/endpoint';
export const PROFILE_AFFILIATION =
  'http://dsf.dev/fhir/StructureDefinition/organization-affiliation';

// Used when a stored membership carries no role at all, so the affiliation
// still satisfies the profile's code min 1.
const FALLBACK_ROLE = 'DIC';

export interface AllowListEndpoint {
  identifier: string;
  name: string | null;
  address: string;
}

export interface AllowListMember {
  identifier: string;
  name: string;
  /** SHA-512 DSF thumbprints (128 lower-case hex) of the member's certificates. */
  thumbprints: string[];
  endpoints: AllowListEndpoint[];
  affiliations: Array<{ parent: string; endpoint: string; roles: string[] }>;
  /** Soft-deleted memberships; emitted as DELETE unless the triple is active again. */
  removedAffiliations: Array<{ parent: string; endpoint: string }>;
}

export interface AllowListReceiver {
  organization: string;
  endpoint: string;
  affiliations: Array<{ parent: string; roles: string[] }>;
  removedAffiliations: Array<{ parent: string }>;
}

export interface AllowListInput {
  members: AllowListMember[];
  /** Display names of parent organizations; the identifier is the fallback. */
  parentNames: ReadonlyMap<string, string>;
  receiver?: AllowListReceiver;
}

export interface FhirReference {
  reference: string;
  type: 'Organization' | 'Endpoint';
}

export interface AllowListEntry {
  fullUrl?: string;
  resource?: { resourceType: string } & Record<string, unknown>;
  request: { method: 'PUT' | 'DELETE'; url: string };
}

// No Bundle.identifier: the legacy portal omits it and strict HAPI
// validators flagged the allow-list value; DSF ignores it in transactions.
export interface AllowListBundle {
  resourceType: 'Bundle';
  meta: { tag: Array<{ system: string; code: string; display: string }> };
  type: 'transaction';
  /** Absent when there is nothing to publish (FHIR JSON forbids empty arrays). */
  entry?: AllowListEntry[];
}

export function organizationUrl(identifier: string): string {
  return `Organization?identifier=${ORG_ID_SYSTEM}|${identifier}`;
}

export function endpointUrl(identifier: string): string {
  return `Endpoint?identifier=${EP_ID_SYSTEM}|${identifier}`;
}

export function affiliationUrl(parent: string, member: string, endpoint: string): string {
  return (
    `OrganizationAffiliation?primary-organization:identifier=${ORG_ID_SYSTEM}|${parent}` +
    `&participating-organization:identifier=${ORG_ID_SYSTEM}|${member}` +
    `&endpoint:identifier=${EP_ID_SYSTEM}|${endpoint}`
  );
}

/** A member is publishable when the DSF organization profile can be met. */
export function isPublishable(member: AllowListMember): boolean {
  return member.thumbprints.length > 0 && member.endpoints.length > 0;
}

function resourceMeta(profile: string) {
  return {
    profile: [profile],
    tag: [{ system: READ_ACCESS_TAG_SYSTEM, code: 'ALL' }],
  };
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** Merge rows sharing the same key into one entry with the union of their roles. */
function mergeRoles<T extends { roles: string[] }>(rows: T[], keyOf: (row: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = merged.get(key);
    if (existing) existing.roles = unique([...existing.roles, ...row.roles]);
    else merged.set(key, { ...row, roles: unique(row.roles) });
  }
  return Array.from(merged.values());
}

function codeBlocks(roles: string[]) {
  return (roles.length > 0 ? roles : [FALLBACK_ROLE]).map((role) => ({
    coding: [{ system: ORG_ROLE_SYSTEM, code: role }],
  }));
}

function affiliationEntry(
  fullUrl: string,
  urls: { parent: string; member: string; endpoint: string },
  refs: { parent: FhirReference; member: FhirReference; endpoint: FhirReference },
  roles: string[],
): AllowListEntry {
  return {
    fullUrl,
    resource: {
      resourceType: 'OrganizationAffiliation',
      meta: resourceMeta(PROFILE_AFFILIATION),
      active: true,
      organization: refs.parent,
      participatingOrganization: refs.member,
      code: codeBlocks(roles),
      endpoint: [refs.endpoint],
    },
    request: { method: 'PUT', url: affiliationUrl(urls.parent, urls.member, urls.endpoint) },
  };
}

function deleteEntry(url: string): AllowListEntry {
  return { request: { method: 'DELETE', url } };
}

export function buildAllowListBundle(
  input: AllowListInput,
  newId: () => string = randomUUID,
): AllowListBundle {
  const urn = () => `urn:uuid:${newId()}`;
  const receiver = input.receiver;

  const members = input.members
    .filter((m) => m.identifier !== receiver?.organization && isPublishable(m))
    .sort((a, b) => byText(a.identifier, b.identifier));
  const memberFullUrls = new Map(members.map((m) => [m.identifier, urn()]));

  const blocks = members.map((member) => {
    const endpoints = [...member.endpoints].sort((a, b) => byText(a.identifier, b.identifier));
    const endpointFullUrls = new Map(endpoints.map((e) => [e.identifier, urn()]));
    // An affiliation may only point at one of the member's own endpoints;
    // anything else would leave a dangling urn:uuid reference.
    const affiliations = mergeRoles(
      member.affiliations.filter((a) => a.parent && endpointFullUrls.has(a.endpoint)),
      (a) => `${a.parent}|${a.endpoint}`,
    ).sort((a, b) => byText(a.parent, b.parent) || byText(a.endpoint, b.endpoint));
    const active = new Set(affiliations.map((a) => `${a.parent}|${a.endpoint}`));
    const removed = unique(
      member.removedAffiliations
        .filter((r) => r.parent && !active.has(`${r.parent}|${r.endpoint}`))
        .map((r) => affiliationUrl(r.parent, member.identifier, r.endpoint)),
    ).sort(byText);
    return { member, endpoints, endpointFullUrls, affiliations, removed };
  });

  const receiverAffiliations = receiver
    ? mergeRoles(
        receiver.affiliations.filter((a) => a.parent),
        (a) => a.parent,
      ).sort((a, b) => byText(a.parent, b.parent))
    : [];
  const receiverRemoved = receiver
    ? unique(
        receiver.removedAffiliations
          .filter((r) => r.parent && !receiverAffiliations.some((a) => a.parent === r.parent))
          .map((r) => affiliationUrl(r.parent, receiver.organization, receiver.endpoint)),
      ).sort(byText)
    : [];

  // Parents referenced by an emitted affiliation get their own entry unless
  // they are a member themselves or the receiver (then referenced directly).
  const parentIds = unique([
    ...blocks.flatMap((b) => b.affiliations.map((a) => a.parent)),
    ...receiverAffiliations.map((a) => a.parent),
  ])
    .filter((p) => !memberFullUrls.has(p) && p !== receiver?.organization)
    .sort(byText);
  const parentFullUrls = new Map(parentIds.map((p) => [p, urn()]));

  const organizationRef = (identifier: string): FhirReference => ({
    reference:
      memberFullUrls.get(identifier) ??
      parentFullUrls.get(identifier) ??
      organizationUrl(identifier),
    type: 'Organization',
  });

  const entries: AllowListEntry[] = [];

  for (const parent of parentIds) {
    entries.push({
      fullUrl: parentFullUrls.get(parent),
      resource: {
        resourceType: 'Organization',
        meta: resourceMeta(PROFILE_ORG_PARENT),
        identifier: [{ system: ORG_ID_SYSTEM, value: parent }],
        active: true,
        name: input.parentNames.get(parent) || parent,
      },
      request: { method: 'PUT', url: organizationUrl(parent) },
    });
  }

  if (receiver) {
    const memberRef: FhirReference = {
      reference: organizationUrl(receiver.organization),
      type: 'Organization',
    };
    const endpointRef: FhirReference = {
      reference: endpointUrl(receiver.endpoint),
      type: 'Endpoint',
    };
    for (const a of receiverAffiliations) {
      entries.push(
        affiliationEntry(
          urn(),
          { parent: a.parent, member: receiver.organization, endpoint: receiver.endpoint },
          { parent: organizationRef(a.parent), member: memberRef, endpoint: endpointRef },
          a.roles,
        ),
      );
    }
    receiverRemoved.forEach((url) => entries.push(deleteEntry(url)));
  }

  for (const { member, endpoints, endpointFullUrls, affiliations, removed } of blocks) {
    const memberFullUrl = memberFullUrls.get(member.identifier)!;
    entries.push({
      fullUrl: memberFullUrl,
      resource: {
        resourceType: 'Organization',
        meta: resourceMeta(PROFILE_ORG),
        extension: unique(member.thumbprints).map((valueString) => ({
          url: CERT_THUMBPRINT_EXTENSION_URL,
          valueString,
        })),
        identifier: [{ system: ORG_ID_SYSTEM, value: member.identifier }],
        active: true,
        name: member.name,
        endpoint: endpoints.map((e) => ({
          reference: endpointFullUrls.get(e.identifier)!,
          type: 'Endpoint',
        })),
      },
      request: { method: 'PUT', url: organizationUrl(member.identifier) },
    });

    for (const endpoint of endpoints) {
      entries.push({
        fullUrl: endpointFullUrls.get(endpoint.identifier),
        resource: {
          resourceType: 'Endpoint',
          meta: resourceMeta(PROFILE_ENDPOINT),
          identifier: [{ system: EP_ID_SYSTEM, value: endpoint.identifier }],
          status: 'active',
          connectionType: {
            system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
            code: 'hl7-fhir-rest',
          },
          name: endpoint.name || `DSF Endpoint for ${endpoint.identifier}`,
          managingOrganization: { reference: memberFullUrl, type: 'Organization' },
          payloadType: [
            { coding: [{ system: 'http://hl7.org/fhir/resource-types', code: 'Task' }] },
          ],
          payloadMimeType: ['application/fhir+json', 'application/fhir+xml'],
          address: endpoint.address,
        },
        request: { method: 'PUT', url: endpointUrl(endpoint.identifier) },
      });
    }

    for (const a of affiliations) {
      entries.push(
        affiliationEntry(
          urn(),
          { parent: a.parent, member: member.identifier, endpoint: a.endpoint },
          {
            parent: organizationRef(a.parent),
            member: { reference: memberFullUrl, type: 'Organization' },
            endpoint: { reference: endpointFullUrls.get(a.endpoint)!, type: 'Endpoint' },
          },
          a.roles,
        ),
      );
    }
    removed.forEach((url) => entries.push(deleteEntry(url)));
  }

  return {
    resourceType: 'Bundle',
    meta: {
      tag: [{ system: READ_ACCESS_TAG_SYSTEM, code: 'ALL', display: 'everybody' }],
    },
    type: 'transaction',
    ...(entries.length > 0 ? { entry: entries } : {}),
  };
}
