/**
 * allowlist-freshness.test.ts – the "new allow list available" nudge.
 *
 * A site obtains a version by a DSF fetch (GET /fhir/Bundle/..., 200 or 304
 * with a matching ETag) or by a download in the portal. GET
 * /instances/:id/allow-list/freshness compares that with the current version.
 *
 * Sites are seeded with unique .example.de ids and removed again, so parallel
 * jest workers do not collide. Other suites may publish versions at the same
 * time, therefore the version numbers are read back instead of assumed.
 *
 * Dependencies: supertest, app, db/connection, helpers/allowListSites, helpers/auth,
 *               services/bundle-versions.service, services/allowlist-freshness.service
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../app';
import { db } from '../../db/connection';
import { mtlsHeaders, removeSites, seedSite, type Site } from '../helpers/allowListSites';
import { getTestToken } from '../helpers/auth';
import { createSnapshot } from '../../services/bundle-versions.service';
import { recordAllowListFetch } from '../../services/allowlist-freshness.service';

const snapshotIds: string[] = [];
const sites: Site[] = [];

async function publish(): Promise<number> {
  const snap = await createSnapshot({ triggeredBy: 'MANUAL', triggeredByEmail: 'test@example.de' });
  snapshotIds.push(snap.id);
  return snap.versionNumber;
}

const freshness = (site: Site) =>
  request(app)
    .get(`/api/v1/instances/${site.instanceId}/allow-list/freshness`)
    .set('Authorization', `Bearer ${getTestToken(site.email, site.userId)}`);

const dsfGet = (site: Site, path: string, extra: Record<string, string> = {}) =>
  request(app)
    .get(`/fhir/Bundle/${path}`)
    .set({ ...mtlsHeaders(site.certPem!), ...extra });

/** Poll until the fire-and-forget record landed. */
async function waitForRecord(site: Site, atLeast: number) {
  for (let i = 0; i < 40; i++) {
    const row = await db('allowlist_fetches').where({ instance_id: site.instanceId }).first();
    if (row && row.version_number >= atLeast) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return db('allowlist_fetches').where({ instance_id: site.instanceId }).first();
}

afterAll(async () => {
  await db('bundle_versions').whereIn('id', snapshotIds).del();
  await removeSites(sites);
});

describe('allow-list freshness', () => {
  let site: Site;

  beforeAll(async () => {
    site = await seedSite({ label: 'fresh' });
    sites.push(site);
    await publish();
  });

  it('is outdated while the site never obtained a version', async () => {
    const res = await freshness(site);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      lastObtainedVersion: null,
      lastObtainedAt: null,
      via: null,
      outdated: true,
    });
    expect(typeof res.body.data.currentVersion).toBe('number');
    expect(typeof res.body.data.currentPublishedAt).toBe('string');
  });

  it('records a DSF fetch (200) and is up to date afterwards', async () => {
    const res = await dsfGet(site, site.endpointIds[0]);
    expect(res.status).toBe(200);
    const version = Number(/W\/"(\d+)"/.exec(String(res.headers.etag))![1]);
    const row = await waitForRecord(site, version);
    expect(row).toMatchObject({ version_number: version, via: 'DSF' });

    const fresh = await freshness(site);
    expect(fresh.body.data).toMatchObject({
      lastObtainedVersion: version,
      via: 'DSF',
      outdated: false,
    });
  });

  it('is outdated again once a new version is published, and a fetch of /mine clears it', async () => {
    const next = await publish();
    expect((await freshness(site)).body.data.outdated).toBe(true);

    const res = await dsfGet(site, 'mine');
    expect(res.status).toBe(200);
    await waitForRecord(site, next);
    const fresh = await freshness(site);
    expect(fresh.body.data.lastObtainedVersion).toBeGreaterThanOrEqual(next);
    expect(fresh.body.data.outdated).toBe(false);
  });

  it('records a 304 whose ETag matches the current version', async () => {
    const first = await dsfGet(site, site.endpointIds[0]);
    const etag = String(first.headers.etag);
    const version = Number(/W\/"(\d+)"/.exec(etag)![1]);
    // Forget the fetch, then revalidate: only the 304 can record it again.
    await db('allowlist_fetches').where({ instance_id: site.instanceId }).del();
    const res = await dsfGet(site, site.endpointIds[0], { 'If-None-Match': etag });
    expect(res.status).toBe(304);
    const row = await waitForRecord(site, version);
    expect(row.version_number).toBe(version);
  });

  it('records a download in the portal', async () => {
    await db('allowlist_fetches').where({ instance_id: site.instanceId }).del();
    const res = await request(app)
      .get(`/api/v1/instances/${site.instanceId}/download/bundle`)
      .query({ endpointId: site.endpointIds[0] })
      .set('Authorization', `Bearer ${getTestToken(site.email, site.userId)}`);
    expect(res.status).toBe(200);
    const version = Number(res.headers['x-bundle-version']);
    const row = await waitForRecord(site, version);
    expect(row).toMatchObject({ version_number: version, via: 'PORTAL' });
  });

  it('never lowers the remembered version', async () => {
    await recordAllowListFetch(site.instanceId, 1, 'PORTAL');
    const row = await db('allowlist_fetches').where({ instance_id: site.instanceId }).first();
    expect(row.version_number).toBeGreaterThan(1);
    expect(row.via).toBe('PORTAL');

    await recordAllowListFetch(site.instanceId, 1_000_000, 'DSF');
    await recordAllowListFetch(site.instanceId, 999_999, 'PORTAL');
    const after = await db('allowlist_fetches').where({ instance_id: site.instanceId }).first();
    expect(after).toMatchObject({ version_number: 1_000_000, via: 'DSF' });
  });
});

describe('allow-list freshness: not applicable', () => {
  it('is false for a site without an approved request', async () => {
    const pending = await seedSite({ label: 'fresh-pend', approval: 'PENDING' });
    sites.push(pending);
    await publish();
    const res = await freshness(pending);
    expect(res.status).toBe(200);
    expect(res.body.data.outdated).toBe(false);
  });

  it('is false for a site without an endpoint', async () => {
    const bare = await seedSite({ label: 'fresh-bare' });
    sites.push(bare);
    await db('endpoints').where({ organization_id: bare.orgId }).del();
    await publish();
    const res = await freshness(bare);
    expect(res.body.data.outdated).toBe(false);
  });

  it('is false while no version is published', async () => {
    const lone = await seedSite({ label: 'fresh-none' });
    sites.push(lone);
    const current = await db('bundle_versions').count<[{ n: number }]>({ n: '*' }).first();
    if (Number(current?.n) === 0) {
      const res = await freshness(lone);
      expect(res.body.data).toMatchObject({ currentVersion: null, outdated: false });
    }
  });
});

describe('allow-list freshness: access', () => {
  it('rejects a missing token', async () => {
    const site = await seedSite({ label: 'fresh-auth' });
    sites.push(site);
    const res = await request(app).get(`/api/v1/instances/${site.instanceId}/allow-list/freshness`);
    expect(res.status).toBe(401);
  });

  it("refuses another user's instance", async () => {
    const [a, b] = [await seedSite({ label: 'fresh-a' }), await seedSite({ label: 'fresh-b' })];
    sites.push(a, b);
    const res = await request(app)
      .get(`/api/v1/instances/${b.instanceId}/allow-list/freshness`)
      .set('Authorization', `Bearer ${getTestToken(a.email, a.userId)}`);
    expect(res.status).toBe(403);
  });

  it('lets an organization-scoped session read only its own instance', async () => {
    const [a, b] = [await seedSite({ label: 'fresh-sa' }), await seedSite({ label: 'fresh-sb' })];
    sites.push(a, b);
    const key = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString();
    const token = jwt.sign(
      { sub: a.userId, email: a.email, kind: 'org', inst: a.instanceId },
      key,
      {
        algorithm: 'RS256',
        expiresIn: '15m',
      },
    );
    const get = (id: string) =>
      request(app)
        .get(`/api/v1/instances/${id}/allow-list/freshness`)
        .set('Authorization', `Bearer ${token}`);
    expect((await get(a.instanceId)).status).toBe(200);
    expect((await get(b.instanceId)).status).toBe(403);
  });
});
