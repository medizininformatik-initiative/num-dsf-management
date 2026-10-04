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
