/**
 * membership-endpoint-ownership.test.ts – A membership may only point at an
 * endpoint of its own organization. createMembership checks that; an update
 * that moves the membership to another organization's endpoint must be
 * refused the same way (ENDPOINT_NOT_FOUND) and change nothing.
 * Dependencies: db, memberships.service, helpers/allowListSites
 */
import { db } from '../db/connection';
import { updateMembership } from '../services/memberships.service';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';

describe('updateMembership endpoint ownership', () => {
  let own: Site;
  let other: Site;

  beforeAll(async () => {
    own = await seedSite({
      label: 'mship-own',
      approval: null,
      memberships: [{ parent: 'medizininformatik-initiative.de', roles: ['DIC'] }],
    });
    other = await seedSite({ label: 'mship-other', approval: null });
  });

  afterAll(async () => {
    for (const s of [own, other]) {
      await db('audit_logs').where({ instance_id: s.instanceId }).del();
    }
    await removeSites([own, other]);
  });

  it("refuses another organization's endpoint", async () => {
    const m = await db('memberships').where({ organization_id: own.orgId }).first();
    await expect(
      updateMembership(
        own.instanceId,
        m.id,
        { endpointId: other.endpointIds[0] },
        own.email,
        '127.0.0.1',
      ),
    ).rejects.toThrow('ENDPOINT_NOT_FOUND');
    const after = await db('memberships').where({ id: m.id }).first();
    expect(after.endpoint_id).toBe(own.endpointIds[0]);
  });
});
