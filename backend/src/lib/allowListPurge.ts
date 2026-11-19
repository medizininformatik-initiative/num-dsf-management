/**
 * allowListPurge.ts – The "purge" bundle: a FHIR transaction that deletes the whole allow list
 * from one site's own DSF FHIR server.
 *
 * It contains ONLY conditional DELETE entries (DSF's CheckAllowList accepts nothing but PUT and
 * DELETE on Organization, Endpoint and OrganizationAffiliation), in exactly the URL format the
 * allow-list builder emits for withdrawn organizations. The set is everything any stored
 * allow-list version ever mentioned (its PUT and DELETE entries), so also what an earlier version
 * published and a later one deleted. Left out are the receiver's own Organization and own
 * Endpoints: its DSF server holds them for itself and they must stay. The receiver's own
 * affiliations are deleted like everybody else's; it becomes a member again with the next normal
 * allow list.
 * Order: affiliations, endpoints, organizations (nothing is deleted while something still
 * references it), each sorted and without duplicates, so the output is stable.
 * Pure: the caller supplies the stored bundles.
 * Dependencies: lib/allowListBundle
 */
import {
  EP_ID_SYSTEM,
  ORG_ID_SYSTEM,
  READ_ACCESS_TAG_SYSTEM,
  parseAffiliationUrl,
  type AllowListBundle,
  type AllowListEntry,
} from './allowListBundle';

const ORG_PREFIX = `Organization?identifier=${ORG_ID_SYSTEM}|`;
const EP_PREFIX = `Endpoint?identifier=${EP_ID_SYSTEM}|`;

/** The receiver: what a purge must leave alone. */
export interface PurgeReceiver {
  organization: string;
  endpoints: Iterable<string>;
}

/** Identifier of an `Organization?identifier=…|<id>` URL; null for any other URL. */
export function parseOrganizationUrl(url: string): string | null {
  return url.startsWith(ORG_PREFIX) && url.length > ORG_PREFIX.length
    ? url.slice(ORG_PREFIX.length)
    : null;
}

/** Identifier of an `Endpoint?identifier=…|<id>` URL; null for any other URL. */
export function parseEndpointUrl(url: string): string | null {
  return url.startsWith(EP_PREFIX) && url.length > EP_PREFIX.length
    ? url.slice(EP_PREFIX.length)
    : null;
}

/** Conditional-DELETE URLs of an allow-list bundle (its PUT and DELETE entries); unreadable JSON yields none. */
function entryUrls(bundleJson: string): string[] {
  let bundle: { entry?: unknown } | null;
  try {
    bundle = JSON.parse(bundleJson);
  } catch {
    return [];
  }
  const urls: string[] = [];
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  for (const entry of entries as Array<{ request?: { method?: string; url?: string } } | null>) {
    const request = entry?.request;
    if ((request?.method === 'PUT' || request?.method === 'DELETE') && request.url) {
      urls.push(request.url);
    }
  }
  return urls;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Collects the URLs of the stored bundles one at a time: the caller can drop each bundle's JSON
 * after add(), so the memory use is the set of distinct URLs, not every stored bundle.
 */
export function createPurgeCollector(receiver: PurgeReceiver) {
  const ownOrg = receiver.organization.toLowerCase();
  const ownEndpoints = new Set([...receiver.endpoints].map((e) => e.toLowerCase()));
  const affiliations = new Set<string>();
  const endpoints = new Set<string>();
  const organizations = new Set<string>();
  return {
    add(bundleJson: string): void {
      for (const url of entryUrls(bundleJson)) {
        const org = parseOrganizationUrl(url);
        const endpoint = parseEndpointUrl(url);
        if (org !== null) {
          if (org.toLowerCase() !== ownOrg) organizations.add(url);
        } else if (endpoint !== null) {
          if (!ownEndpoints.has(endpoint.toLowerCase())) endpoints.add(url);
        } else if (parseAffiliationUrl(url)) {
          affiliations.add(url);
        }
      }
    },
    entries(): AllowListEntry[] {
      return [affiliations, endpoints, organizations].flatMap((set) =>
        [...set].sort(byText).map((url) => ({ request: { method: 'DELETE' as const, url } })),
      );
    },
  };
}

/** The DELETE entries that remove everything the given stored bundles ever mentioned. */
export function purgeEntries(
  bundleJsons: Iterable<string>,
  receiver: PurgeReceiver,
): AllowListEntry[] {
  const collector = createPurgeCollector(receiver);
  for (const json of bundleJsons) collector.add(json);
  return collector.entries();
}

/** The purge bundle for DELETE entries (no entry at all when there are none). */
export function purgeBundleFromEntries(entry: AllowListEntry[]): AllowListBundle {
  return {
    resourceType: 'Bundle',
    meta: {
      tag: [{ system: READ_ACCESS_TAG_SYSTEM, code: 'ALL', display: 'everybody' }],
    },
    type: 'transaction',
    // FHIR JSON forbids an empty array: no entry at all when there is nothing to delete.
    ...(entry.length > 0 ? { entry } : {}),
  };
}

export function buildPurgeBundle(
  bundleJsons: Iterable<string>,
  receiver: PurgeReceiver,
): AllowListBundle {
  return purgeBundleFromEntries(purgeEntries(bundleJsons, receiver));
}
