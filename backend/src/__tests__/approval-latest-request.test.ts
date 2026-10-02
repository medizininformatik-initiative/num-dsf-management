/**
 * approval-latest-request.test.ts – Two requests of one instance created in
 * the same second: the newer one is the latest for the approval status and
 * for the allow list (migration 023 keeps created_at in milliseconds; before,
 * both rounded to the same second and the UUID tie-break picked at random).
 * The UUIDs are chosen so that the old tie-break would pick the older request.
 * Dependencies: db/connection, approval.service, fhir.service, helpers/allowListSites
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { getApprovalStatus } from '../services/approval.service';
import { generateFullBundle } from '../services/fhir.service';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';

describe('latest approval request within one second', () => {
  const approvedId = `ffffffff-${uuidv4().slice(9)}`;
  const pendingId = `00000000-${uuidv4().slice(9)}`;
  let site: Site;

  beforeAll(async () => {
    // A publishable site (certificate + endpoint) without a request yet.
    site = await seedSite({ label: 'same-second', approval: null });
    const second = Math.floor(Date.now() / 1000) * 1000;
    await db('approval_requests').insert([
      {
        id: approvedId,
        instance_id: site.instanceId,
        status: 'APPROVED',
        created_at: new Date(second + 100),
        resolved_at: new Date(second + 200),
        snapshot_json: JSON.stringify({}),
      },
      {
        id: pendingId,
        instance_id: site.instanceId,
        status: 'PENDING',
        created_at: new Date(second + 400),
        submitted_at: new Date(second + 400),
        snapshot_json: JSON.stringify({}),
      },
    ]);
  });

  afterAll(async () => {
    await removeSites([site]);
  });

  it('reports the newer request as the approval status', async () => {
    expect((await getApprovalStatus(site.instanceId))?.id).toBe(pendingId);
  });

  it('keeps the organization out of the allow list while its newer request is pending', async () => {
    const bundle = (await generateFullBundle()) as unknown as {
      entry?: Array<{ request: { url: string } }>;
    };
    expect((bundle.entry ?? []).some((e) => e.request.url.includes(site.orgId))).toBe(false);
  });
});
