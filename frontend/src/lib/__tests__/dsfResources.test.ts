/**
 * dsfResources.test.ts — validates the static DSF Resources catalog (well-formed
 * https URLs, unique ids and URLs, title, known category, descriptions present
 * in both languages, every category populated, a featured row) and the pure
 * helpers hostOf / filterResources. Liveness of the URLs is checked on demand
 * by scripts/check-resource-links.mjs, not here (no network in tests).
 */
import { describe, it, expect } from 'vitest';
import {
  CATEGORY_LABEL_KEY,
  DSF_RESOURCES,
  RESOURCE_CATEGORIES,
  filterResources,
  hostOf,
  type DsfResource,
} from '../dsfResources';
import { en } from '../../i18n/en';
import { de } from '../../i18n/de';

describe('DSF_RESOURCES', () => {
  it('gives every resource a well-formed https URL', () => {
    for (const r of DSF_RESOURCES) {
      expect(r.url, r.id).not.toMatch(/\s/);
      const parsed = new URL(r.url);
      expect(parsed.protocol, r.id).toBe('https:');
      expect(parsed.hostname, r.id).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(parsed.username + parsed.password, r.id).toBe('');
    }
  });

  it('has unique kebab-case ids and no duplicate URLs', () => {
    const ids = DSF_RESOURCES.map((r) => r.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(ids).size).toBe(ids.length);
    const urls = DSF_RESOURCES.map((r) => r.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('gives every resource a title, a known category, an icon and a translated description', () => {
    for (const r of DSF_RESOURCES) {
      expect(r.title.trim().length, r.id).toBeGreaterThan(0);
      expect(RESOURCE_CATEGORIES, r.id).toContain(r.category);
      expect(r.icon, r.id).toMatch(/^[a-z0-9_]+$/);
      expect(en[r.descKey], r.id).toBeTruthy();
      expect(de[r.descKey], r.id).toBeTruthy();
    }
  });

  it('populates every category and labels it in both languages', () => {
    for (const cat of RESOURCE_CATEGORIES) {
      expect(
        DSF_RESOURCES.some((r) => r.category === cat),
        cat,
      ).toBe(true);
      expect(en[CATEGORY_LABEL_KEY[cat]]).toBeTruthy();
      expect(de[CATEGORY_LABEL_KEY[cat]]).toBeTruthy();
    }
  });

  it('features a small "Start here" set', () => {
    const featured = DSF_RESOURCES.filter((r) => r.featured);
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.length).toBeLessThanOrEqual(4);
  });
});

describe('hostOf', () => {
  it('returns the hostname without a leading www.', () => {
    expect(hostOf('https://www.omg.org/spec/BPMN/2.0/')).toBe('omg.org');
    expect(hostOf('https://hub.dsf.dev/')).toBe('hub.dsf.dev');
  });
});

describe('filterResources', () => {
  const describeEn = (r: DsfResource) => en[r.descKey];

  it('returns everything for "all" and an empty query', () => {
    expect(filterResources(DSF_RESOURCES, 'all', '  ', describeEn)).toHaveLength(
      DSF_RESOURCES.length,
    );
  });

  it('restricts to one category', () => {
    const out = filterResources(DSF_RESOURCES, 'networks', '', describeEn);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.category === 'networks')).toBe(true);
  });

  it('matches title, description and host case-insensitively, all words required', () => {
    expect(filterResources(DSF_RESOURCES, 'all', 'LINTER', describeEn).map((r) => r.id)).toEqual([
      'linter',
    ]);
    expect(filterResources(DSF_RESOURCES, 'all', 'omg.org', describeEn).map((r) => r.id)).toEqual([
      'bpmn',
    ]);
    expect(filterResources(DSF_RESOURCES, 'all', 'zulip', describeEn).map((r) => r.id)).toEqual([
      'communication',
    ]);
    expect(filterResources(DSF_RESOURCES, 'all', 'linter zulip', describeEn)).toHaveLength(0);
  });
});
