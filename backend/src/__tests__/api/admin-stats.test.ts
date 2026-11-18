/**
 * admin-stats.test.ts – GET /api/v1/admin/stats summary numbers.
 *
 * The test DB is shared with other suites, so absolute totals are unknown:
 * the stats are read once before seeding and once after, and the deltas are
 * compared. Sites are unique .example.de fixtures, removed again afterwards.
 *
 * Dependencies: supertest, app, db/connection, helpers/allowListSites,
 *               helpers/auth, helpers/seed (seedAdminUser, seedTestUser)
 */
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { removeSites, seedSite, type Site } from '../helpers/allowListSites';
import { getTestToken } from '../helpers/auth';
import { seedAdminUser, seedTestUser } from '../helpers/seed';
import type { AdminStats } from '../../services/admin-stats.service';

const sites: Site[] = [];
const incidentIds: string[] = [];

const getStats = (token?: string) => {
  const req = request(app).get('/api/v1/admin/stats');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

async function readStats(token: string): Promise<AdminStats> {
  const res = await getStats(token);
  expect(res.status).toBe(200);
  return res.body.data as AdminStats;
}

async function login(instanceId: string, at: Date): Promise<void> {
  await db('audit_logs').insert({
    id: uuidv4(),
    timestamp: at,
    user_email: 'x@example.de',
    instance_id: instanceId,
    resource_type: 'AUTH',
    resource_id: null,
    operation: 'LOGIN',
  });
}

afterAll(async () => {
  if (incidentIds.length) await db('incidents').whereIn('id', incidentIds).del();
  await removeSites(sites);
});

describe('GET /api/v1/admin/stats', () => {
  it('returns 401 without a token', async () => {
    expect((await getStats()).status).toBe(401);
  });

  it('returns 403 for a non-admin', async () => {
    const { userId, email } = await seedTestUser();
    expect((await getStats(getTestToken(email, userId))).status).toBe(403);
  });

  it('counts sites, requests, logins and incidents', async () => {
    const admin = await seedAdminUser();
    const token = getTestToken(admin.email, admin.userId);
    const before = await readStats(token);

    const published = await seedSite({ label: 'stats-pub', loginCert: true });
    const pending = await seedSite({ label: 'stats-pen', approval: 'PENDING', active: false });
    const rejected = await seedSite({ label: 'stats-rej', approval: 'REJECTED' });
    sites.push(published, pending, rejected);

    await login(published.instanceId, new Date());
    await login(rejected.instanceId, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    await db('allowlist_fetches').insert({
      instance_id: published.instanceId,
      version_number: 2147483647,
      via: 'DSF',
      fetched_at: new Date(),
    });
    const incidentId = uuidv4();
    incidentIds.push(incidentId);
    await db('incidents').insert({
      id: incidentId,
      organization_id: published.orgId,
      title: 'Stats test incident',
      description: 'Stats test',
      status: 'REPORTED',
      reported_by: 'x@example.de',
      reported_at: new Date(),
      detected_at: new Date(),
    });

    const after = await readStats(token);
    expect(after.sites.total - before.sites.total).toBe(3);
    expect(after.sites.active - before.sites.active).toBe(2);
    expect(after.sites.withLoginCertificate - before.sites.withLoginCertificate).toBe(1);
    expect(after.sites.everLoggedIn - before.sites.everLoggedIn).toBe(2);
    expect(after.sites.loggedInLast24h - before.sites.loggedInLast24h).toBe(1);
    expect(after.sites.published - before.sites.published).toBe(1);
    expect(after.requests.pending - before.requests.pending).toBe(1);
    expect(after.requests.approved - before.requests.approved).toBe(1);
    expect(after.requests.rejected - before.requests.rejected).toBe(1);
    expect(after.requests.approvedLast24h - before.requests.approvedLast24h).toBe(1);
    expect(after.incidents.open - before.incidents.open).toBe(1);
    // Two of the three new sites never fetched; the third holds a version above any real one.
    expect(after.allowList.sitesNeverFetched - before.allowList.sitesNeverFetched).toBe(2);
    if (before.allowList.currentVersion !== null) {
      expect(after.allowList.sitesUpToDate - before.allowList.sitesUpToDate).toBe(1);
    }
  });
});
