/**
 * approval-removed-instance.test.ts – A request of a removed site (instances.removed_at) can
 * never be approved: approveRequest refuses it with INSTANCE_REMOVED and the silent-consent sweep
 * leaves it alone, also when the removal did not get to withdraw the request.
 * Dependencies: db/connection, approval.service, approval-silent-consent.service,
 *               helpers/allowListSites, lib/adminGrants
 */
import { v4 as uuidv4 } from 'uuid';

jest.mock('../services/approval-reminder.service', () => ({
  ...jest.requireActual('../services/approval-reminder.service'),
  notifySiteOnApproval: jest.fn().mockResolvedValue(undefined),
  notifyImiOnFirstApproval: jest.fn().mockResolvedValue(undefined),
}));

import { db } from '../db/connection';
import { signGrant } from '../lib/adminGrants';
import { approveRequest } from '../services/approval.service';
import { runSilentConsentSweep } from '../services/approval-silent-consent.service';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';

const admin = `rm-approver-${Date.now().toString(36)}@site-one.example.de`;
const sites: Site[] = [];

beforeAll(async () => {
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: admin,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(admin, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
});

afterAll(async () => {
  for (const s of sites) {
    await db('approval_signatures')
      .whereIn(
        'approval_request_id',
        db('approval_requests').where({ instance_id: s.instanceId }).select('id'),
      )
      .del();
    await db('audit_logs').where({ instance_id: s.instanceId }).del();
  }
  await db('audit_logs').where({ user_email: admin }).del();
  await db('admin_grants').where({ email: admin }).del();
  await removeSites(sites);
});

async function removedSiteWithPendingRequest(label: string): Promise<{ site: Site; rid: string }> {
  const site = await seedSite({ label, approval: 'PENDING' });
  sites.push(site);
  const request = await db('approval_requests')
    .where({ instance_id: site.instanceId, status: 'PENDING' })
    .first('id');
  // Removed, but the request is still PENDING (e.g. withdrawn by nobody).
  await db('instances')
    .where({ id: site.instanceId })
    .update({ removed_at: new Date(), removed_by: 'x@site-two.example.de' });
  return { site, rid: request.id as string };
}

describe('a removed site', () => {
  it('cannot have its pending request approved', async () => {
    const { rid } = await removedSiteWithPendingRequest('rm-approve');
    await expect(approveRequest(rid, admin, '127.0.0.1')).rejects.toThrow('INSTANCE_REMOVED');
    expect(await db('approval_signatures').where({ approval_request_id: rid })).toHaveLength(0);
    expect((await db('approval_requests').where({ id: rid }).first()).status).toBe('PENDING');
  });

  it('is not promoted by the silent-consent sweep', async () => {
    const { rid } = await removedSiteWithPendingRequest('rm-silent');
    await db('approval_signatures').insert({
      id: uuidv4(),
      approval_request_id: rid,
      admin_email: admin,
      admin_site: 'site-one.example.de',
      decision: 'APPROVE',
      signed_at: new Date(Date.now() - 30 * 86400_000),
    });
    await runSilentConsentSweep();
    expect((await db('approval_requests').where({ id: rid }).first()).status).toBe('PENDING');
  });
});
