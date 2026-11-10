/**
 * allowListInput.ts – The network state a bundle version is built from, and
 * the pure views derived from it.
 *
 * A version stores ONE network-wide input (every approved organization with
 * its endpoints, thumbprints and affiliations, the withdrawn organizations
 * and the parent display names). Receiver-specific data is not stored
 * separately: the receiver's own affiliations for its endpoint are part of its
 * own member entry, so any receiver view is derived from the stored members.
 * That keeps the stored JSON independent of who asks later, and the live and
 * the stored path go through the same derivation.
 * Contact data is never part of the input (GDPR, F-BND-04).
 * applyIncidentBlocks applies the suspensions and blocked thumbprints of the
 * incident register on top of the approved state.
 * Dependencies: lib/allowListBundle (types only)
 */
import type {
  AllowListInput,
  AllowListMember,
  AllowListReceiver,
  AllowListRemoval,
} from './allowListBundle';

export interface StoredAllowListInput {
  members: AllowListMember[];
  removed: AllowListRemoval[];
  parentNames: Record<string, string>;
}

export function serializeAllowListInput(input: StoredAllowListInput): string {
  return JSON.stringify(input);
}

/** @throws Error('INPUT_CORRUPT') when the stored JSON is not a usable input. */
export function parseAllowListInput(json: string): StoredAllowListInput {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('INPUT_CORRUPT');
  }
  const v = value as Partial<StoredAllowListInput> | null;
  if (!v || !Array.isArray(v.members) || !Array.isArray(v.removed) || !v.parentNames) {
    throw new Error('INPUT_CORRUPT');
  }
  return v as StoredAllowListInput;
}

/** Builder input for the network-wide bundle. */
export function fullViewInput(stored: StoredAllowListInput): AllowListInput {
  return {
    members: stored.members,
    removed: stored.removed,
    parentNames: new Map(Object.entries(stored.parentNames)),
  };
}

/**
 * Builder input for one endpoint of one organization: every other member plus
 * the receiver's own affiliations for that endpoint (only when the receiver is
 * a member, i.e. approved, in this state).
 */
export function receiverViewInput(
  stored: StoredAllowListInput,
  organization: string,
  endpoint: string,
): AllowListInput {
  const self = stored.members.find((m) => m.identifier === organization);
  const receiver: AllowListReceiver = {
    organization,
    endpoint,
    affiliations: (self?.affiliations ?? [])
      .filter((a) => a.endpoint === endpoint)
      .map((a) => ({ parent: a.parent, roles: a.roles })),
    removedAffiliations: (self?.removedAffiliations ?? [])
      .filter((a) => a.endpoint === endpoint)
      .map((a) => ({ parent: a.parent })),
  };
  return {
    members: stored.members.filter((m) => m.identifier !== organization),
    removed: stored.removed,
    parentNames: new Map(Object.entries(stored.parentNames)),
    receiver,
  };
}

/** A member as a withdrawn organization: DELETE for it, its endpoints and affiliations. */
export function toRemoval(member: AllowListMember): AllowListRemoval {
  return {
    identifier: member.identifier,
    endpoints: member.endpoints.map((e) => e.identifier),
    affiliations: [...member.affiliations, ...member.removedAffiliations].map((a) => ({
      parent: a.parent,
      endpoint: a.endpoint,
    })),
  };
}

/**
 * Incidents override the approved state (migration 035): a suspended
 * organization is published as withdrawn, blocked SHA-512 thumbprints are
 * never published, and a member whose every thumbprint is blocked is
 * withdrawn (it needs a new, approved certificate first).
 */
export function applyIncidentBlocks(
  input: StoredAllowListInput,
  suspended: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): StoredAllowListInput {
  if (suspended.size === 0 && blocked.size === 0) return input;
  const members: AllowListMember[] = [];
  const removed = [...input.removed];
  const alreadyRemoved = new Set(removed.map((r) => r.identifier));
  for (const member of input.members) {
    const thumbprints = member.thumbprints.filter((t) => !blocked.has(t.toLowerCase()));
    const withdraw =
      suspended.has(member.identifier) ||
      (member.thumbprints.length > 0 && thumbprints.length === 0);
    if (!withdraw) {
      members.push(
        thumbprints.length === member.thumbprints.length ? member : { ...member, thumbprints },
      );
    } else if (!alreadyRemoved.has(member.identifier)) {
      removed.push(toRemoval(member));
      alreadyRemoved.add(member.identifier);
    }
  }
  return { ...input, members, removed };
}
