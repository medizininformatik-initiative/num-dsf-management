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
 * later version. A DELETE without a match is harmless in DSF.
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
 * Adds every previously published affiliation that is not active now to the
 * member's removedAffiliations, or to the withdrawal of a withdrawn member.
 * Triples of organizations that are neither a member nor withdrawn are skipped
 * (nothing is published for them). Returns the input itself when nothing is added.
 */
export function withRetiredAffiliations(
  input: StoredAllowListInput,
  previous: Iterable<AffiliationTriple>,
): StoredAllowListInput {
  const members = new Map(input.members.map((m) => [m.identifier, m]));
  const removals = new Map(input.removed.map((r) => [r.identifier, r]));
  const key = (t: { parent: string; endpoint: string }) => `${t.parent}|${t.endpoint}`;
  const addedToMember = new Map<string, Array<{ parent: string; endpoint: string }>>();
  const addedToRemoval = new Map<string, Array<{ parent: string; endpoint: string }>>();
  const seen = new Set<string>();

  for (const t of previous) {
    const id = `${t.member}|${key(t)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const member = members.get(t.member);
    const removal = removals.get(t.member);
    if (member) {
      const known = new Set(
        [...member.affiliations, ...member.removedAffiliations].map((a) => key(a)),
      );
      if (known.has(key(t))) continue;
      addedToMember.set(t.member, [
        ...(addedToMember.get(t.member) ?? []),
        { parent: t.parent, endpoint: t.endpoint },
      ]);
    } else if (removal) {
      if (removal.affiliations.some((a) => key(a) === key(t))) continue;
      addedToRemoval.set(t.member, [
        ...(addedToRemoval.get(t.member) ?? []),
        { parent: t.parent, endpoint: t.endpoint },
      ]);
    }
  }
  if (addedToMember.size === 0 && addedToRemoval.size === 0) return input;
  return {
    ...input,
    members: input.members.map((m) =>
      addedToMember.has(m.identifier)
        ? {
            ...m,
            removedAffiliations: [...m.removedAffiliations, ...addedToMember.get(m.identifier)!],
          }
        : m,
    ),
    removed: input.removed.map((r) =>
      addedToRemoval.has(r.identifier)
        ? { ...r, affiliations: [...r.affiliations, ...addedToRemoval.get(r.identifier)!] }
        : r,
    ),
  };
}
