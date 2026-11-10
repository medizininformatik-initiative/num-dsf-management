/**
 * peerEdges.ts – Verbund (parent organization) membership of map
 * organizations, drawn as hub-and-spoke: every member links to one hub per
 * Verbund instead of to every other member, so a Verbund of n sites needs n
 * lines rather than n·(n−1)/2. Also the Verbund labels, colours and counts.
 */
import type { MapOrganization } from '../api/network.api';

export interface VerbundGroup {
  verbund: string; // parent_organization
  members: string[]; // org.identifier, each listed once
}

/** One group per Verbund, members in input order, each org listed once. */
export function deriveVerbunds(orgs: MapOrganization[]): VerbundGroup[] {
  const byVerbund = new Map<string, string[]>();
  for (const o of orgs) {
    // Dedupe parents per org: two memberships under the same parent must not
    // list the org twice.
    const seen = new Set<string>();
    for (const m of o.memberships) {
      if (seen.has(m.parent_organization)) continue;
      seen.add(m.parent_organization);
      const list = byVerbund.get(m.parent_organization) ?? [];
      list.push(o.identifier);
      byVerbund.set(m.parent_organization, list);
    }
  }
  return [...byVerbund].map(([verbund, members]) => ({ verbund, members }));
}

/** Verbunds each organization belongs to (identifier → parents, deduped). */
export function verbundsByOrg(groups: VerbundGroup[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const g of groups)
    for (const id of g.members) {
      const list = out.get(id) ?? [];
      list.push(g.verbund);
      out.set(id, list);
    }
  return out;
}

const KNOWN_VERBUND_LABELS: Record<string, string> = {
  'mii-testverband.example.de': 'MII',
  'num-testverband.example.de': 'NUM',
};

const KNOWN_VERBUND_COLORS: Record<string, string> = {
  'mii-testverband.example.de': '#7c3fb8',
  'num-testverband.example.de': '#4a90d9',
};

export function verbundLabel(parentOrg: string): string {
  if (KNOWN_VERBUND_LABELS[parentOrg]) return KNOWN_VERBUND_LABELS[parentOrg];
  // Fallback: first label of the FQDN, uppercased.
  const first = parentOrg.split('.')[0] ?? parentOrg;
  return first.split('-')[0]?.toUpperCase() ?? parentOrg.toUpperCase();
}

export function verbundColor(parentOrg: string): string {
  return KNOWN_VERBUND_COLORS[parentOrg] ?? '#64748b';
}

export function verbundCounts(orgs: MapOrganization[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of orgs) {
    const seen = new Set<string>();
    for (const m of o.memberships) {
      if (seen.has(m.parent_organization)) continue;
      seen.add(m.parent_organization);
      out.set(m.parent_organization, (out.get(m.parent_organization) ?? 0) + 1);
    }
  }
  return out;
}
