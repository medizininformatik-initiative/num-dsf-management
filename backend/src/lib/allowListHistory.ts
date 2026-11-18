/**
 * allowListHistory.ts – Retire affiliations that earlier versions published
 * and the current state no longer contains.
 *
 * A receiver may have applied any older version, because it can skip
 * versions. DSF refuses to CREATE an OrganizationAffiliation when one with the
 * same (parent, member) and the same endpoint or the same role exists, so a
 * member whose affiliation moved to another endpoint would break the whole
 * transaction of every receiver still holding the old one. The conditional
 * DELETE for each (parent, member, old endpoint) is therefore emitted in every
 * later version, but only for a member that is still published and whose old
 * endpoint is gone. The old Endpoint resource is deleted as well: DSF also
 * refuses to create an Endpoint whose address already exists, so a replacement
 * endpoint with the same address would otherwise fail the transaction.
 * A DELETE without a match is harmless in DSF.
 * Pure: the caller supplies the earlier versions' bundles.
 * Dependencies: lib/allowListBundle, lib/allowListInput (types only)
 */
import { parseAffiliationUrl } from './allowListBundle';
import type { StoredAllowListInput } from './allowListInput';

export interface AffiliationTriple {
  parent: string;
  member: string;
  endpoint: string;
}

/** Affiliations a stored bundle publishes (its PUT entries); unreadable JSON yields none. */
export function publishedAffiliations(bundleJson: string): AffiliationTriple[] {
  let bundle: { entry?: Array<{ request?: { method?: string; url?: string } }> };
  try {
    bundle = JSON.parse(bundleJson);
  } catch {
    return [];
  }
  const triples: AffiliationTriple[] = [];
  for (const entry of bundle?.entry ?? []) {
    if (entry.request?.method !== 'PUT' || typeof entry.request.url !== 'string') continue;
    const triple = parseAffiliationUrl(entry.request.url);
    if (triple) triples.push(triple);
  }
  return triples;
}

/**
 * Adds a previously published affiliation to the member's removedAffiliations,
 * and its endpoint to the member's removedEndpoints, when that endpoint is no
 * longer one of the member's current endpoints (the endpoint was changed or
 * removed). Everything else is left alone: members
 * absent from the input (withdrawn, suspended, unpublishable, not approved)
 * stay with the removal path, and an affiliation dropped while its endpoint
 * still exists stays with the soft-delete path. Returns the input itself when
 * nothing is added.
 */
export function withRetiredAffiliations(
  input: StoredAllowListInput,
  previous: Iterable<AffiliationTriple>,
): StoredAllowListInput {
  const members = new Map(input.members.map((m) => [m.identifier, m]));
  const key = (t: { parent: string; endpoint: string }) => `${t.parent}|${t.endpoint}`;
  const added = new Map<string, Array<{ parent: string; endpoint: string }>>();
  const goneEndpoints = new Map<string, Set<string>>();
  const seen = new Set<string>();

  for (const t of previous) {
    const id = `${t.member}|${key(t)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const member = members.get(t.member);
    if (!member || member.endpoints.some((e) => e.identifier === t.endpoint)) continue;
    goneEndpoints.set(t.member, (goneEndpoints.get(t.member) ?? new Set()).add(t.endpoint));
    if (member.removedAffiliations.some((a) => key(a) === key(t))) continue;
    added.set(t.member, [
      ...(added.get(t.member) ?? []),
      { parent: t.parent, endpoint: t.endpoint },
    ]);
  }
  if (goneEndpoints.size === 0) return input;
  return {
    ...input,
    members: input.members.map((m) =>
      goneEndpoints.has(m.identifier)
        ? {
            ...m,
            removedAffiliations: [...m.removedAffiliations, ...(added.get(m.identifier) ?? [])],
            removedEndpoints: [
              ...new Set([...(m.removedEndpoints ?? []), ...goneEndpoints.get(m.identifier)!]),
            ],
          }
        : m,
    ),
  };
}
