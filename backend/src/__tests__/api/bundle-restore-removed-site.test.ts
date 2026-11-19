/**
 * bundle-restore-removed-site.test.ts – Restoring a version that was published before a site was
 * removed does not publish the site again: it stays a DELETE in the restored list.
 * Dependencies: db, helpers/allowListSites, bundle-versions.service
 */
import { db } from '../../db/connection';
import { removeSites, seedSite, type Site } from '../helpers/allowListSites';
import { createSnapshot, restoreVersion } from '../../services/bundle-versions.service';

const ADMIN = 'restore-removed@imi-test.example.de';
const sites: Site[] = [];

afterAll(async () => {
  await db('bundle_versions').where({ triggered_by_email: ADMIN }).del();
  await db('audit_logs').where({ user_email: ADMIN }).del();
  for (const s of sites) await db('audit_logs').where({ instance_id: s.instanceId }).del();
  await removeSites(sites);
});

describe('restoreVersion', () => {
  it('keeps a removed site withdrawn when the source predates its removal', async () => {
    const site = await seedSite({ label: 'restore-removed' });
    sites.push(site);
    const before = await createSnapshot({ triggeredBy: 'MANUAL', triggeredByEmail: ADMIN });
    await db('instances')
      .where({ id: site.instanceId })
      .update({ removed_at: new Date(), removed_by: ADMIN });

    const restored = await restoreVersion(before.id, 'test', ADMIN);
    const row = await db('bundle_versions').where({ id: restored.id }).first();
    const bundle = JSON.parse(row.bundle_json) as {
      entry?: Array<{ request?: { method: string; url: string } }>;
    };
    const own = (bundle.entry ?? []).filter((e) => (e.request?.url ?? '').includes(site.orgId));
    expect(own.length).toBeGreaterThan(0);
    expect(own.map((e) => e.request?.method)).not.toContain('PUT');
    expect(own.map((e) => e.request?.method)).toContain('DELETE');
    const input = JSON.parse(row.input_json) as {
      members: Array<{ identifier: string }>;
      removed: Array<{ identifier: string }>;
    };
    expect(input.members.some((m) => m.identifier === site.orgId)).toBe(false);
    expect(input.removed.some((r) => r.identifier === site.orgId)).toBe(true);
  });
});
