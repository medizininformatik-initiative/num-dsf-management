/**
 * allowListHistory.ts – Retire affiliations that earlier versions published
 * and the current state no longer contains.
 *
 * A receiver may have applied any older version, because it can skip
 * versions. DSF refuses to CREATE an OrganizationAffiliation when one with the
 * same (parent, member) and the same endpoint or the same role exists, so a
 * member whose affiliation moved to another endpoint would break the whole
 * transaction of every receiver still holding the old one. The conditional
 * DELETE for each earlier (parent, member, endpoint) that is not a current
 * affiliation of the member is therefore emitted in every later version: after
 * an endpoint or parent changed in place, after the endpoint disappeared, and
 * for a withdrawn member. The old Endpoint resource is deleted as well once no
 * member publishes it any more: DSF also refuses to create an Endpoint whose
 * address already exists, so a replacement endpoint with the same address
 * would otherwise fail the transaction.
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
  let bundle: { entry?: unknown } | null;
  try {
    bundle = JSON.parse(bundleJson);
  } catch {
    return [];
  }
  const triples: AffiliationTriple[] = [];
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  for (const entry of entries as Array<{ request?: { method?: string; url?: string } } | null>) {
    const request = entry?.request;
    if (request?.method !== 'PUT' || typeof request.url !== 'string') continue;
    const triple = parseAffiliationUrl(request.url);
    if (triple) triples.push(triple);
  }
  return triples;
}

/**
 * Retires every affiliation an earlier version published that the current
 * state no longer contains, so a receiver that skipped versions cannot hit
 * DSF's duplicate rule (same parent+member+endpoint or parent+member+role).
 *
 * - Member still published: each earlier (parent, endpoint) that is not one of
 *   its current affiliations is added to removedAffiliations. That covers an
 *   endpoint or a parent changed in place while the member keeps the endpoint.
 *   The Endpoint itself is added to removedEndpoints only when the member no
 *   longer has it and no other member owns it now.
 * - Member withdrawn (in input.removed): its earlier affiliations and
 *   endpoints join the removal, with the same ownership check.
 * - Members absent from both (suspended without removal, unpublishable, not
 *   approved) are left to their own paths.
 * A triple the bundle still publishes is never deleted: the builder drops
 * removedAffiliations that are active and any DELETE of a PUT URL.
 * Returns the input itself when nothing is added.
 */
export function withRetiredAffiliations(
  input: StoredAllowListInput,
  previous: Iterable<AffiliationTriple>,
): StoredAllowListInput {
  const members = new Map(input.members.map((m) => [m.identifier, m]));
  const removals = new Map(input.removed.map((r) => [r.identifier, r]));
  const owner = new Map<string, string>();
  for (const m of input.members) for (const e of m.endpoints) owner.set(e.identifier, m.identifier);
  const key = (t: { parent: string; endpoint: string }) => `${t.parent}|${t.endpoint}`;

  const addedAff = new Map<string, Array<{ parent: string; endpoint: string }>>();
  const addedEp = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const add = <V>(map: Map<string, V[]>, id: string, v: V) =>
    map.set(id, [...(map.get(id) ?? []), v]);

  for (const t of previous) {
    const id = `${t.member}|${key(t)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const member = members.get(t.member);
    const removal = removals.get(t.member);
    const freeEndpoint = !owner.has(t.endpoint) || owner.get(t.endpoint) === t.member;
    if (member) {
      if (member.affiliations.some((a) => key(a) === key(t))) continue;
      if (!member.removedAffiliations.some((a) => key(a) === key(t))) {
        add(addedAff, t.member, { parent: t.parent, endpoint: t.endpoint });
      }
      const stillHas = member.endpoints.some((e) => e.identifier === t.endpoint);
      if (!stillHas && freeEndpoint && !(member.removedEndpoints ?? []).includes(t.endpoint)) {
        addedEp.set(t.member, (addedEp.get(t.member) ?? new Set()).add(t.endpoint));
      }
    } else if (removal) {
      if (!removal.affiliations.some((a) => key(a) === key(t))) {
        add(addedAff, t.member, { parent: t.parent, endpoint: t.endpoint });
      }
      if (!owner.has(t.endpoint) && !removal.endpoints.includes(t.endpoint)) {
        addedEp.set(t.member, (addedEp.get(t.member) ?? new Set()).add(t.endpoint));
      }
    }
  }
  if (addedAff.size === 0 && addedEp.size === 0) return input;
  return {
    ...input,
    members: input.members.map((m) =>
      addedAff.has(m.identifier) || addedEp.has(m.identifier)
        ? {
            ...m,
            removedAffiliations: [...m.removedAffiliations, ...(addedAff.get(m.identifier) ?? [])],
            removedEndpoints: [
              ...new Set([...(m.removedEndpoints ?? []), ...(addedEp.get(m.identifier) ?? [])]),
            ],
          }
        : m,
    ),
    removed: input.removed.map((r) =>
      addedAff.has(r.identifier) || addedEp.has(r.identifier)
        ? {
            ...r,
            endpoints: [...new Set([...r.endpoints, ...(addedEp.get(r.identifier) ?? [])])],
            affiliations: [...r.affiliations, ...(addedAff.get(r.identifier) ?? [])],
          }
        : r,
    ),
  };
}
