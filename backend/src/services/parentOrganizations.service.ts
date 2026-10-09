/**
 * parentOrganizations.service.ts — parent organizations selectable in the membership form:
 * the known Verbünde plus every parent currently used by a live membership.
 * Dependencies: db, lib/knownParents.
 */
import { db } from '../db/connection';
import { KNOWN_PARENT_NAMES } from '../lib/knownParents';

export interface ParentOrganizationOption {
  identifier: string;
  name: string;
  known: boolean;
  usedBy: number;
}

export async function listParentOrganizations(): Promise<ParentOrganizationOption[]> {
  const used: { parent_organization: string; used_by: number | string }[] = await db('memberships')
    .whereNull('deleted_at')
    .groupBy('parent_organization')
    .select('parent_organization')
    .count({ used_by: '*' });
  const usedBy = new Map(used.map((r) => [r.parent_organization, Number(r.used_by)]));

  const identifiers = [...new Set([...Object.keys(KNOWN_PARENT_NAMES), ...usedBy.keys()])];
  const orgs: { identifier: string; name: string }[] = await db('organizations')
    .whereIn('identifier', identifiers)
    .select('identifier', 'name');
  const storedNames = new Map(orgs.map((o) => [o.identifier, o.name]));

  return identifiers
    .map((identifier) => ({
      identifier,
      name: KNOWN_PARENT_NAMES[identifier] ?? storedNames.get(identifier) ?? identifier,
      known: identifier in KNOWN_PARENT_NAMES,
      usedBy: usedBy.get(identifier) ?? 0,
    }))
    .sort((a, b) => Number(b.known) - Number(a.known) || a.name.localeCompare(b.name, 'de'));
}
