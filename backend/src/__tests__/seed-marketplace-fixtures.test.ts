/**
 * seed-marketplace-fixtures.test.ts – the dev seed fixtures are fully populated
 * and consistent with the service's slug/URL rules (pure, no DB).
 */
import { buildMarketplaceFixtures } from '../db/seed-marketplace-fixtures';
import {
  normalizeGithubUrl,
  patchMarketplaceMetaSchema,
  slugify,
} from '../schemas/marketplace.schema';

describe('marketplace seed fixtures', () => {
  const fixtures = buildMarketplaceFixtures();

  it('lists the real DSF processes', () => {
    expect(fixtures.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'dsf-process-allow-list',
        'mii-process-feasibility',
        'dsf-process-tutorial',
      ]),
    );
  });

  it('points the feasibility entry at the real MII repository, not a dsf-owned one', () => {
    const f = fixtures.find((x) => x.name === 'mii-process-feasibility');
    expect(f?.url).toBe('https://github.com/medizininformatik-initiative/mii-process-feasibility');
    expect(f?.slug).toBe('medizininformatik-initiative-mii-process-feasibility');
    expect(f?.homepage).toContain('medizininformatik-initiative/mii-process-feasibility');
    expect(f?.artifactUrl).toContain('medizininformatik-initiative/mii-process-feasibility');
    expect(fixtures.some((x) => x.url.includes('dsf-process-feasibility'))).toBe(false);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    '%s is fully populated with a slug matching the service rule',
    (_name, f) => {
      const { canonical, owner, repo } = normalizeGithubUrl(f.url);
      expect(canonical).toBe(f.url);
      expect(f.slug).toBe(slugify(owner, repo));
      expect(f.description.length).toBeGreaterThan(20);
      expect(f.topics.length).toBeGreaterThan(0);
      expect(f.releases.length).toBeGreaterThan(0);
      expect(f.requiredRoles.length).toBeGreaterThan(0);
      const parsed = patchMarketplaceMetaSchema.safeParse({
        processIdentifiers: f.processIdentifiers,
        dsfVersionMin: f.dsfVersionMin,
        requiredRoles: f.requiredRoles,
        messageNames: f.messageNames,
        artifactUrl: f.artifactUrl,
      });
      expect(parsed.success).toBe(true);
      for (const r of f.releases) {
        expect(Number.isNaN(new Date(r.publishedAt).getTime())).toBe(false);
      }
    },
  );
});
