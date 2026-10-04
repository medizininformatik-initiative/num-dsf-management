/**
 * diffModel.ts – pure mapping from the raw bundle-version diff (added / removed
 * / changed FHIR transaction entries) to a view model grouped by organization:
 * organization added / removed / withdrawn / changed, endpoints, certificate
 * thumbprints, memberships. Entries carry volatile urn:uuid references, so
 * identities are read from the stable request URLs and identifiers; endpoints
 * are assigned to their organization through whatever link the diff itself
 * contains and land in an "unassigned" group otherwise.
 * Dependencies: none (types only from bundleVersions.api).
 */
import type { BundleVersionDiff } from '../../../api/bundleVersions.api';
import type { TranslationKey } from '../../../i18n/en';

export type OrgStatus = 'added' | 'removed' | 'withdrawn' | 'changed';

export type Change =
  | { kind: 'org-name'; before: string; after: string }
  | { kind: 'withdrawal-lifted' }
  | { kind: 'thumbprint-added' | 'thumbprint-removed'; value: string }
  | { kind: 'endpoint-added' | 'endpoint-removed'; id: string; address: string }
  | { kind: 'endpoint-address'; id: string; before: string; after: string }
  | { kind: 'endpoint-name'; id: string; before: string; after: string }
  | {
      kind: 'membership-added' | 'membership-removed';
      parent: string;
      endpoint: string;
      roles: string[];
    }
  | {
      kind: 'membership-roles';
      parent: string;
      endpoint: string;
      roles: string[];
      rolesAdded: string[];
      rolesRemoved: string[];
    };

export interface OrgDiff {
  /** Organization identifier (FQDN); null for the "unassigned" group. */
  id: string | null;
  name: string;
  status: OrgStatus;
  /** A parent organization that is only referenced, not a member itself. */
  isParent: boolean;
  changes: Change[];
}

export interface DiffSummary {
  orgsAdded: number;
  orgsRemoved: number;
  orgsWithdrawn: number;
  orgsChanged: number;
  endpointsChanged: number;
  certificatesChanged: number;
  membershipsChanged: number;
}

export interface DiffViewModel {
  summary: DiffSummary;
  organizations: OrgDiff[];
  isEmpty: boolean;
}

interface Entry {
  fullUrl?: string;
  resource?: Record<string, unknown> & { resourceType?: string };
  request?: { method?: string; url?: string };
}

type Side = 'added' | 'removed';

const THUMBPRINT_URL = 'http://dsf.dev/fhir/StructureDefinition/extension-certificate-thumbprint';
const PARENT_PROFILE = 'http://dsf.dev/fhir/StructureDefinition/organization-parent';

function asEntry(raw: unknown): Entry {
  return raw && typeof raw === 'object' ? (raw as Entry) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function identifierOf(entry: Entry): string {
  const ids = arr(entry.resource?.identifier) as Array<{ value?: unknown }>;
  return str(ids[0]?.value);
}

/** Value after the last '|' of the first `<param>=<system>|<value>` match. */
function urlParam(url: string, param: string): string {
  const match = new RegExp(`${param}=[^&|]*\\|([^&]*)`).exec(url);
  return match ? decodeURIComponent(match[1]) : '';
}

function resourceType(entry: Entry): string {
  return str(entry.resource?.resourceType) || str(entry.request?.url).split('?')[0];
}

function isDelete(entry: Entry): boolean {
  return entry.request?.method === 'DELETE';
}

function thumbprintsOf(entry: Entry): string[] {
  return (arr(entry.resource?.extension) as Array<{ url?: string; valueString?: string }>)
    .filter((e) => e.url === THUMBPRINT_URL && e.valueString)
    .map((e) => e.valueString as string);
}

function rolesOf(entry: Entry): string[] {
  const codes = arr(entry.resource?.code) as Array<{ coding?: Array<{ code?: string }> }>;
  return codes.flatMap((c) => (c.coding ?? []).map((x) => str(x.code))).filter(Boolean);
}

function isParentOrg(entry: Entry): boolean {
  const profiles = arr((entry.resource?.meta as { profile?: unknown } | undefined)?.profile);
  return profiles.includes(PARENT_PROFILE);
}

interface AffiliationKey {
  parent: string;
  member: string;
  endpoint: string;
}

function affiliationKey(entry: Entry): AffiliationKey {
  const url = str(entry.request?.url);
  return {
    parent: urlParam(url, 'primary-organization:identifier'),
    member: urlParam(url, 'participating-organization:identifier'),
    endpoint: urlParam(url, 'endpoint:identifier'),
  };
}

export function mapBundleDiff(diff: BundleVersionDiff): DiffViewModel {
  const sides: Array<{ side: Side; entry: Entry }> = [
    ...diff.added.map((e) => ({ side: 'added' as const, entry: asEntry(e) })),
    ...diff.removed.map((e) => ({ side: 'removed' as const, entry: asEntry(e) })),
  ];
  const changed = diff.changed.map((c) => ({ before: asEntry(c.before), after: asEntry(c.after) }));

  // Lookup tables to place endpoints without a stable org link.
  const orgByFullUrl = new Map<string, string>();
  const orgNames = new Map<string, string>();
  const registerOrg = (e: Entry) => {
    if (resourceType(e) !== 'Organization' || isDelete(e)) return;
    const id = identifierOf(e);
    if (!id) return;
    if (e.fullUrl) orgByFullUrl.set(e.fullUrl, id);
    const name = str(e.resource?.name);
    if (name && !orgNames.has(id)) orgNames.set(id, name);
  };
  sides.forEach((s) => registerOrg(s.entry));
  changed.forEach((c) => {
    registerOrg(c.before);
    registerOrg(c.after);
  });
  const orgByEndpointId = new Map<string, string>();
  const registerAff = (e: Entry) => {
    if (resourceType(e) !== 'OrganizationAffiliation') return;
    const k = affiliationKey(e);
    if (k.endpoint && k.member) orgByEndpointId.set(k.endpoint, k.member);
  };
  sides.forEach((s) => registerAff(s.entry));
  changed.forEach((c) => registerAff(c.after));
  // Organizations list their endpoints by fullUrl reference.
  const endpointFullUrlToOrg = new Map<string, string>();
  const registerOrgEndpoints = (e: Entry) => {
    if (resourceType(e) !== 'Organization' || isDelete(e)) return;
    const id = identifierOf(e);
    for (const ref of arr(e.resource?.endpoint) as Array<{ reference?: string }>) {
      if (ref.reference && id) endpointFullUrlToOrg.set(ref.reference, id);
    }
  };
  sides.forEach((s) => registerOrgEndpoints(s.entry));
  changed.forEach((c) => registerOrgEndpoints(c.after));

  const groups = new Map<string, OrgDiff>();
  const dedupe = new Set<string>();
  const group = (id: string | null): OrgDiff => {
    const key = id ?? '';
    let g = groups.get(key);
    if (!g) {
      g = {
        id,
        name: id ? (orgNames.get(id) ?? id) : '',
        status: 'changed',
        isParent: false,
        changes: [],
      };
      groups.set(key, g);
    }
    return g;
  };
  const push = (g: OrgDiff, key: string, change: Change) => {
    const full = `${g.id}|${key}`;
    if (dedupe.has(full)) return;
    dedupe.add(full);
    g.changes.push(change);
  };

  const endpointOrg = (e: Entry): string | null => {
    const mo = e.resource?.managingOrganization as { reference?: string } | undefined;
    const ref = str(mo?.reference);
    if (ref && orgByFullUrl.has(ref)) return orgByFullUrl.get(ref) as string;
    if (ref.startsWith('Organization?')) return urlParam(ref, 'identifier') || null;
    if (e.fullUrl && endpointFullUrlToOrg.has(e.fullUrl)) {
      return endpointFullUrlToOrg.get(e.fullUrl) as string;
    }
    const epId = identifierOf(e) || urlParam(str(e.request?.url), 'identifier');
    return orgByEndpointId.get(epId) ?? null;
  };

  // Withdrawn organizations first so a removed PUT of the same org is folded in.
  for (const { side, entry } of sides) {
    if (!isDelete(entry) || resourceType(entry) !== 'Organization') continue;
    const id = urlParam(str(entry.request?.url), 'identifier');
    if (!id) continue;
    const g = group(id);
    if (side === 'added') g.status = 'withdrawn';
    else push(g, 'withdrawal-lifted', { kind: 'withdrawal-lifted' });
  }

  for (const { side, entry } of sides) {
    const type = resourceType(entry);
    if (type === 'Organization' && !isDelete(entry)) {
      const id = identifierOf(entry);
      if (!id) continue;
      const g = group(id);
      g.isParent = isParentOrg(entry);
      if (g.status !== 'withdrawn') g.status = side;
      for (const value of thumbprintsOf(entry)) {
        push(g, `tp:${value}`, {
          kind: side === 'added' ? 'thumbprint-added' : 'thumbprint-removed',
          value,
        });
      }
    } else if (type === 'Endpoint') {
      const del = isDelete(entry);
      const id = del ? urlParam(str(entry.request?.url), 'identifier') : identifierOf(entry);
      if (!id) continue;
      const removedNow = del ? side === 'added' : side === 'removed';
      if (del && side === 'removed') continue;
      const g = group(del ? (orgByEndpointId.get(id) ?? null) : endpointOrg(entry));
      push(g, `ep:${id}:${removedNow ? 'r' : 'a'}`, {
        kind: removedNow ? 'endpoint-removed' : 'endpoint-added',
        id,
        address: str(entry.resource?.address),
      });
    } else if (type === 'OrganizationAffiliation') {
      const k = affiliationKey(entry);
      if (!k.member) continue;
      const del = isDelete(entry);
      if (del && side === 'removed') continue;
      const removedNow = del ? side === 'added' : side === 'removed';
      const g = group(k.member);
      push(g, `aff:${k.parent}|${k.endpoint}:${removedNow ? 'r' : 'a'}`, {
        kind: removedNow ? 'membership-removed' : 'membership-added',
        parent: k.parent,
        endpoint: k.endpoint,
        roles: rolesOf(entry),
      });
    }
  }

  for (const { before, after } of changed) {
    const type = resourceType(after);
    if (type === 'Organization') {
      const id = identifierOf(after);
      if (!id) continue;
      const g = group(id);
      g.isParent = isParentOrg(after);
      const nb = str(before.resource?.name);
      const na = str(after.resource?.name);
      if (nb !== na) push(g, 'name', { kind: 'org-name', before: nb, after: na });
      const tb = new Set(thumbprintsOf(before));
      const ta = new Set(thumbprintsOf(after));
      for (const value of ta) {
        if (!tb.has(value)) push(g, `tp:${value}`, { kind: 'thumbprint-added', value });
      }
      for (const value of tb) {
        if (!ta.has(value)) push(g, `tp:${value}`, { kind: 'thumbprint-removed', value });
      }
    } else if (type === 'Endpoint') {
      const id = identifierOf(after);
      const g = group(endpointOrg(after));
      const ab = str(before.resource?.address);
      const aa = str(after.resource?.address);
      if (ab !== aa)
        push(g, `ep:${id}:addr`, { kind: 'endpoint-address', id, before: ab, after: aa });
      const nb = str(before.resource?.name);
      const na = str(after.resource?.name);
      if (nb !== na) push(g, `ep:${id}:name`, { kind: 'endpoint-name', id, before: nb, after: na });
    } else if (type === 'OrganizationAffiliation') {
      const k = affiliationKey(after);
      if (!k.member) continue;
      const rb = rolesOf(before);
      const ra = rolesOf(after);
      const rolesAdded = ra.filter((r) => !rb.includes(r));
      const rolesRemoved = rb.filter((r) => !ra.includes(r));
      if (rolesAdded.length === 0 && rolesRemoved.length === 0) continue;
      push(group(k.member), `aff:${k.parent}|${k.endpoint}:roles`, {
        kind: 'membership-roles',
        parent: k.parent,
        endpoint: k.endpoint,
        roles: ra,
        rolesAdded,
        rolesRemoved,
      });
    }
  }

  const organizations = Array.from(groups.values())
    .filter((g) => g.status !== 'changed' || g.changes.length > 0)
    .sort((a, b) => {
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const summary: DiffSummary = {
    orgsAdded: 0,
    orgsRemoved: 0,
    orgsWithdrawn: 0,
    orgsChanged: 0,
    endpointsChanged: 0,
    certificatesChanged: 0,
    membershipsChanged: 0,
  };
  for (const g of organizations) {
    if (g.id !== null) {
      if (g.status === 'added') summary.orgsAdded++;
      else if (g.status === 'removed') summary.orgsRemoved++;
      else if (g.status === 'withdrawn') summary.orgsWithdrawn++;
      else summary.orgsChanged++;
    }
    for (const c of g.changes) {
      if (c.kind.startsWith('endpoint')) summary.endpointsChanged++;
      else if (c.kind.startsWith('thumbprint')) summary.certificatesChanged++;
      else if (c.kind.startsWith('membership')) summary.membershipsChanged++;
    }
  }

  return { summary, organizations, isEmpty: organizations.length === 0 };
}

const SUMMARY_PARTS: Array<[keyof DiffSummary, TranslationKey, TranslationKey]> = [
  ['orgsAdded', 'historySummaryOrgAddedOne', 'historySummaryOrgAddedMany'],
  ['orgsRemoved', 'historySummaryOrgRemovedOne', 'historySummaryOrgRemovedMany'],
  ['orgsWithdrawn', 'historySummaryOrgWithdrawnOne', 'historySummaryOrgWithdrawnMany'],
  ['endpointsChanged', 'historySummaryEndpointOne', 'historySummaryEndpointMany'],
  ['certificatesChanged', 'historySummaryCertOne', 'historySummaryCertMany'],
  ['membershipsChanged', 'historySummaryMembershipOne', 'historySummaryMembershipMany'],
];

/** "2 organizations added, 3 endpoints changed"; '' when nothing changed. */
export function summarySentence(
  summary: DiffSummary,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  return SUMMARY_PARTS.filter(([k]) => summary[k] > 0)
    .map(([k, one, many]) => t(summary[k] === 1 ? one : many, { n: summary[k] }))
    .join(', ');
}
