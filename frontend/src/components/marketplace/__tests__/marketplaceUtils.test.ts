/**
 * marketplaceUtils.test.ts — publisher/initial helpers, DSF version
 * comparison, trust level, and the browse filter/sort pipeline.
 */
import { describe, it, expect } from 'vitest';
import type { MarketplaceEntry } from '../../../api/marketplace.api';
import {
  DEFAULT_FILTERS,
  compareVersions,
  featuredOf,
  filterAndSort,
  initialOf,
  publisherOf,
  safeHttpUrl,
  trustLevel,
} from '../marketplaceUtils';

function e(over: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'x',
    slug: 'x',
    gitUrl: 'https://github.com/owner/repo',
    name: 'Plugin',
    description: null,
    status: 'APPROVED',
    latestReleaseTag: null,
    lastCommitAt: null,
    stars: 0,
    license: 'MIT',
    topics: [],
    forks: 0,
    openIssues: 0,
    archived: false,
    homepage: null,
    language: null,
    processIdentifiers: [],
    dsfVersionMin: null,
    requiredRoles: [],
    messageNames: [],
    artifactUrl: null,
    metadataSource: 'MANIFEST',
    verified: false,
    advisoryText: null,
    advisorySeverity: null,
    supersededBy: null,
    licenseOk: true,
    stale: false,
    syncAt: null,
    syncError: null,
    ...over,
  };
}

describe('marketplaceUtils', () => {
  it('derives publisher and initial', () => {
    expect(publisherOf('https://github.com/medic-hub/plugin.git')).toBe('medic-hub');
    expect(initialOf({ name: '', gitUrl: 'https://github.com/medic-hub/plugin' })).toBe('M');
    expect(initialOf({ name: 'feasibility', gitUrl: '' })).toBe('F');
  });

  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.10', '1.5')).toBeGreaterThan(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
  });

  it('classifies trust', () => {
    expect(trustLevel(e({ verified: true }))).toBe('verified');
    expect(trustLevel(e())).toBe('community');
    expect(trustLevel(e({ verified: true, stale: true }))).toBe('caution');
    expect(trustLevel(e({ advisorySeverity: 'INFO' }))).toBe('caution');
  });

  it('only allows http(s) links', () => {
    expect(safeHttpUrl('https://a.example.de')).toBe('https://a.example.de');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });

  it('filters by DSF compatibility, topic and trust', () => {
    const list = [
      e({ id: 'a', dsfVersionMin: '1.5', topics: ['fhir'] }),
      e({ id: 'b', dsfVersionMin: '2.0', topics: ['fhir'], verified: true }),
      e({ id: 'c', dsfVersionMin: null, topics: ['cohort'] }),
    ];
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) =>
      filterAndSort(list, { ...DEFAULT_FILTERS, sort: 'popular', ...f }).map((x) => x.id);
    expect(ids({ dsf: '1.5' })).toEqual(['a', 'c']);
    expect(ids({ topic: 'fhir' })).toEqual(['a', 'b']);
    expect(ids({ trust: 'verified' })).toEqual(['b']);
  });

  it('sorts by recency and popularity', () => {
    const list = [
      e({ id: 'old', lastCommitAt: '2025-01-01T00:00:00Z', stars: 90 }),
      e({ id: 'new', lastCommitAt: '2026-01-01T00:00:00Z', stars: 1 }),
    ];
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, sort: 'updated' })[0].id).toBe('new');
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, sort: 'popular' })[0].id).toBe('old');
  });

  it('puts name matches first under relevance and picks featured entries', () => {
    const list = [
      e({ id: 'topic', name: 'Other', topics: ['transfer'], verified: true }),
      e({ id: 'name', name: 'Transfer tool' }),
    ];
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, q: 'transfer' })[0].id).toBe('name');
    expect(featuredOf(list).map((x) => x.id)).toEqual(['topic']);
  });
});
