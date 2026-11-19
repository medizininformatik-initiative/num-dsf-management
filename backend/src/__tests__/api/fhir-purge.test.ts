/**
 * fhir-purge.test.ts – GET /fhir/Bundle/:endpoint/purge: a transaction of ONLY conditional
 * DELETEs for everything any stored allow-list version ever published (also an organization a
 * later version withdrew), without the receiver's own Organization and Endpoint, in the builder's
 * URL format. Same mTLS auth and endpoint scoping as the allow list (no certificate 401, unknown
 * certificate 403, another organization's endpoint 404), no version headers, every fetch is
 * audited with the entry count.
 * Dependencies: supertest, app, db, helpers/allowListSites, bundle-versions.service
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { createSnapshot } from '../../services/bundle-versions.service';
import { loadAllowListInput } from '../../services/fhir.service';
import { affiliationUrl, endpointUrl, organizationUrl } from '../../lib/allowListBundle';
import {
  makeCertPem,
  mtlsHeaders,
  removeSites,
  seedSite,
  type Site,
} from '../helpers/allowListSites';

const PARENT = 'purge-parent.example.de';

describe('GET /fhir/Bundle/:endpointId/purge', () => {
  const sites: Site[] = [];
  const snapshots: string[] = [];
  let self: Site;
  let other: Site;
  let gone: Site;

  /** Store the live member of a site as the allowList section of its approved snapshot. */
  async function approveLiveState(site: Site): Promise<void> {
    const member = (await loadAllowListInput()).members.find((m) => m.identifier === site.orgId);
    if (!member) throw new Error('site not published');
    await db('approval_requests')
      .where({ instance_id: site.instanceId, status: 'APPROVED' })
      .update({
        snapshot_json: JSON.stringify({ allowList: { version: 1, active: true, member } }),
      });
  }

  beforeAll(async () => {
    const membership = [{ parent: PARENT, roles: ['DIC'] }];
    self = await seedSite({ label: 'purge-self', memberships: membership });
    other = await seedSite({ label: 'purge-other', memberships: membership });
    gone = await seedSite({ label: 'purge-gone', memberships: membership });
    sites.push(self, other, gone);
    for (const s of sites) await approveLiveState(s);
    // v1 publishes all three sites ...
    snapshots.push(
      (await createSnapshot({ triggeredBy: 'MANUAL', triggeredByEmail: self.email })).id,
    );
    // ... then "gone" is withdrawn (deactivation approved) and v2 deletes it.
    await db('organizations').where({ identifier: gone.orgId }).update({ active: false });
    await db('approval_requests')
      .where({ instance_id: gone.instanceId, status: 'APPROVED' })
      .update({
        snapshot_json: JSON.stringify({
          allowList: {
            version: 1,
            active: false,
            member: {
              identifier: gone.orgId,
              name: gone.name,
              thumbprints: [],
              endpoints: [
                { identifier: gone.endpointIds[0], name: null, address: 'https://x.example.de' },
              ],
              affiliations: [{ parent: PARENT, endpoint: gone.endpointIds[0], roles: ['DIC'] }],
              removedAffiliations: [],
            },
          },
        }),
      });
    snapshots.push(
      (await createSnapshot({ triggeredBy: 'MANUAL', triggeredByEmail: self.email })).id,
    );
  });

  afterAll(async () => {
    await db('bundle_versions').whereIn('id', snapshots).del();
    for (const s of sites) await db('audit_logs').where({ instance_id: s.instanceId }).del();
    await removeSites(sites);
  });

  const purge = (pem: string, endpoint: string) =>
    request(app).get(`/fhir/Bundle/${endpoint}/purge`).set(mtlsHeaders(pem));
  const urls = (body: { entry?: Array<{ request: { url: string } }> }) =>
    (body.entry ?? []).map((e) => e.request.url);

  it('contains only conditional DELETEs, also of an organization a later version withdrew', async () => {
    const res = await purge(self.certPem!, self.endpointIds[0]);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/fhir\+json/);
    expect(res.body.resourceType).toBe('Bundle');
    expect(res.body.type).toBe('transaction');
    const entries = res.body.entry as Array<{ request: { method: string; url: string } }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e).toEqual({ request: { method: 'DELETE', url: e.request.url } });
      expect(e.request.url).toMatch(/^(Organization|Endpoint|OrganizationAffiliation)\?/);
    }
    const list = urls(res.body);
    expect(list).toEqual(
      expect.arrayContaining([
        organizationUrl(other.orgId),
        endpointUrl(other.endpointIds[0]),
        affiliationUrl(PARENT, other.orgId, other.endpointIds[0]),
        organizationUrl(PARENT),
        organizationUrl(gone.orgId),
        endpointUrl(gone.endpointIds[0]),
      ]),
    );
  });

  it("leaves out the receiver's own organization and endpoint but deletes its affiliations", async () => {
    const list = urls((await purge(self.certPem!, self.endpointIds[0])).body);
    expect(list).not.toContain(organizationUrl(self.orgId));
    expect(list).not.toContain(endpointUrl(self.endpointIds[0]));
    expect(list).toContain(affiliationUrl(PARENT, self.orgId, self.endpointIds[0]));
  });

  it('is not a version of the allow list: no version headers, no store', async () => {
    const res = await purge(self.certPem!, self.endpointIds[0]);
    expect(res.headers.etag).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('needs a verified certificate (401) of a registered site (403)', async () => {
    const none = await request(app).get(`/fhir/Bundle/${self.endpointIds[0]}/purge`);
    expect(none.status).toBe(401);
    expect(none.body.resourceType).toBe('OperationOutcome');
    const stranger = await purge(makeCertPem('stranger.example.de'), self.endpointIds[0]);
    expect(stranger.status).toBe(403);
  });

  it("is scoped to the caller's own endpoint: another organization's endpoint is 404", async () => {
    const res = await purge(self.certPem!, other.endpointIds[0]);
    expect(res.status).toBe(404);
    expect(res.body.resourceType).toBe('OperationOutcome');
    const unknown = await purge(self.certPem!, 'does-not-exist.example.de');
    expect(unknown.status).toBe(404);
  });

  it('writes an audit entry with the entry count for every fetch', async () => {
    const before = await db('audit_logs').where({ instance_id: self.instanceId }).count({ n: '*' });
    const res = await purge(self.certPem!, self.endpointIds[0]);
    const rows = await db('audit_logs')
      .where({ instance_id: self.instanceId, operation: 'DOWNLOAD' })
      .select('diff_json', 'resource_id');
    const entry = rows.find((r) => r.diff_json?.action === 'allow_list_purge');
    expect(entry).toBeDefined();
    expect(entry?.resource_id).toBe(self.endpointIds[0]);
    expect(entry?.diff_json).toMatchObject({
      action: 'allow_list_purge',
      endpoint: self.endpointIds[0],
      entries: (res.body.entry as unknown[]).length,
    });
    expect(JSON.stringify(entry?.diff_json)).not.toContain('BEGIN CERTIFICATE');
    const after = await db('audit_logs').where({ instance_id: self.instanceId }).count({ n: '*' });
    expect(Number(after[0].n)).toBeGreaterThan(Number(before[0].n));
  });
});
