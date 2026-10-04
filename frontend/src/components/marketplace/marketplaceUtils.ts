/**
 * marketplaceUtils.ts – pure helpers for the marketplace: publisher and
 * initial-tile derivation, trust level, DSF version comparison, and the
 * filter/sort pipeline of the browse page (kept out of the components so it is
 * unit-testable). Dependencies: marketplace.api (types only).
 */
import type { MarketplaceEntry } from '../../api/marketplace.api';
import type { StatusTone } from '../../lib/statusColors';
import type { TranslationKey } from '../../i18n/en';

export type StatusFilter = 'ALL' | MarketplaceEntry['status'];
export type TrustLevel = 'verified' | 'community' | 'caution';
export type TrustFilter = 'ALL' | TrustLevel;
export type SortKey = 'relevance' | 'updated' | 'popular';

export interface BrowseFilters {
  q: string;
  status: StatusFilter;
  topic: string;
  dsf: string;
  trust: TrustFilter;
  sort: SortKey;
}

export const DEFAULT_FILTERS: BrowseFilters = {
  q: '',
  status: 'ALL',
  topic: '',
  dsf: '',
  trust: 'ALL',
  sort: 'relevance',
};

export const STATUS_TONE: Record<MarketplaceEntry['status'], StatusTone> = {
  APPROVED: 'success',
  EXPERIMENTAL: 'warning',
  DEPRECATED: 'neutral',
};

/** GitHub owner of the repository, used as the publisher name. */
export function publisherOf(gitUrl: string): string {
  const m = /^https?:\/\/github\.com\/([^/]+)\//i.exec(gitUrl);
  return m ? m[1] : '';
}

export function displayName(entry: Pick<MarketplaceEntry, 'name' | 'gitUrl'>): string {
  return entry.name || entry.gitUrl;
}

/** First letter of the name, upper-cased, for the icon tile. */
export function initialOf(entry: Pick<MarketplaceEntry, 'name' | 'gitUrl'>): string {
  const ch = displayName(entry)
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

/** Stable hue (0-359) per name so each tile keeps its colour. */
export function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function trustLevel(e: MarketplaceEntry): TrustLevel {
  if (e.archived || e.stale || !e.licenseOk || e.advisorySeverity || e.status === 'DEPRECATED') {
    return 'caution';
  }
  return e.verified ? 'verified' : 'community';
}

export const TRUST_TONE: Record<TrustLevel, StatusTone> = {
  verified: 'success',
  community: 'info',
  caution: 'warning',
};

/** http(s) only, so a stored value can never become a javascript: link. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** Compare dotted versions numerically ("1.10" > "1.5"); non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function distinctTopics(entries: MarketplaceEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => e.topics))].sort((a, b) => a.localeCompare(b));
}

export function distinctDsfVersions(entries: MarketplaceEntry[]): string[] {
  return [...new Set(entries.map((e) => e.dsfVersionMin).filter((v): v is string => !!v))].sort(
    compareVersions,
  );
}

function matchesQuery(entry: MarketplaceEntry, q: string): boolean {
  return [
    entry.name,
    entry.description ?? '',
    publisherOf(entry.gitUrl),
    ...entry.topics,
    ...entry.requiredRoles,
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

const STATUS_RANK: Record<MarketplaceEntry['status'], number> = {
  APPROVED: 0,
  EXPERIMENTAL: 1,
  DEPRECATED: 2,
};

function time(iso: string | null): number {
  const n = iso ? new Date(iso).getTime() : 0;
  return Number.isNaN(n) ? 0 : n;
}

function relevanceScore(e: MarketplaceEntry, q: string): number {
  let s = 0;
  if (q && displayName(e).toLowerCase().includes(q)) s += 100;
  if (e.verified) s += 20;
  s += (2 - STATUS_RANK[e.status]) * 10;
  if (e.advisorySeverity || e.stale || e.archived) s -= 15;
  return s;
}

/** Apply every browse filter, then sort. Does not mutate the input. */
export function filterAndSort(entries: MarketplaceEntry[], f: BrowseFilters): MarketplaceEntry[] {
  const q = f.q.trim().toLowerCase();
  const out = entries.filter((e) => {
    if (f.status !== 'ALL' && e.status !== f.status) return false;
    if (f.topic && !e.topics.includes(f.topic)) return false;
    // "Works with DSF x": the plugin's minimum version must not exceed x.
    if (f.dsf && e.dsfVersionMin && compareVersions(e.dsfVersionMin, f.dsf) > 0) return false;
    if (f.trust !== 'ALL' && trustLevel(e) !== f.trust) return false;
    if (q && !matchesQuery(e, q)) return false;
    return true;
  });
  const cmp: Record<SortKey, (a: MarketplaceEntry, b: MarketplaceEntry) => number> = {
    relevance: (a, b) => relevanceScore(b, q) - relevanceScore(a, q) || b.stars - a.stars,
    updated: (a, b) => time(b.lastCommitAt) - time(a.lastCommitAt),
    popular: (a, b) => b.stars - a.stars,
  };
  return [...out].sort(cmp[f.sort]);
}

/** Verified, approved and healthy entries, most starred first. */
export function featuredOf(entries: MarketplaceEntry[], max = 3): MarketplaceEntry[] {
  return entries
    .filter((e) => e.verified && e.status === 'APPROVED' && trustLevel(e) === 'verified')
    .sort((a, b) => b.stars - a.stars)
    .slice(0, max);
}

export function statusLabelKey(status: MarketplaceEntry['status']): TranslationKey {
  return status === 'APPROVED'
    ? 'marketplaceStatusApproved'
    : status === 'EXPERIMENTAL'
      ? 'marketplaceStatusExperimental'
      : 'marketplaceStatusDeprecated';
}
