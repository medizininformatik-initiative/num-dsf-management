/**
 * request-risk.service.test.ts – assessPendingRequests runs a fixed number of queries however
 * many requests are assessed, and reads the CA blacklist for the issuers of the new certificates.
 * Dependencies: db/connection, request-risk.service, approval.service, helpers/allowListSites,
 *               jest.mock(approval-reminder.service)
 */
jest.mock('../services/approval-reminder.service', () => ({
  notifyImiOnSubmit: jest.fn().mockResolvedValue(undefined),
  notifySiteOnApproval: jest.fn().mockResolvedValue(undefined),
  notifyImiOnFirstApproval: jest.fn().mockResolvedValue(undefined),
  runApprovalReminders: jest.fn().mockResolvedValue(undefined),
}));

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { submitApproval } from '../services/approval.service';
import { assessPendingRequests, type PendingRequestRow } from '../services/request-risk.service';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';

const sites: Site[] = [];
const requests: PendingRequestRow[] = [];
const blacklistIds: string[] = [];

beforeAll(async () => {
  for (const label of ['risk-q1', 'risk-q2', 'risk-q3']) {
    const site = await seedSite({ label, approval: null });
    sites.push(site);
    const req = await submitApproval(site.instanceId, site.email, '203.0.113.5');
    requests.push(req as PendingRequestRow);
  }
});

afterAll(async () => {
  await db('ca_blacklist').whereIn('id', blacklistIds).del();
  await db('audit_logs')
    .whereIn(
      'resource_id',
      requests.map((r) => r.id),
    )
    .del();
  await db('approval_requests')
    .whereIn(
      'id',
      requests.map((r) => r.id),
    )
    .del();
  await removeSites(sites);
  await db.destroy();
});

async function countQueries(batch: PendingRequestRow[]): Promise<number> {
  let n = 0;
  const onQuery = () => {
    n++;
  };
  db.on('query', onQuery);
  try {
    await assessPendingRequests(batch);
  } finally {
    db.removeListener('query', onQuery);
  }
  return n;
}

describe('assessPendingRequests', () => {
  it('uses the same number of queries for one request as for three', async () => {
    const one = await countQueries(requests.slice(0, 1));
    const three = await countQueries(requests);
    expect(three).toBe(one);
  });

  it('returns an assessment for every request', async () => {
    const result = await assessPendingRequests(requests);
    expect([...result.keys()].sort()).toEqual(requests.map((r) => r.id).sort());
    for (const risk of result.values()) expect(risk.firstRequest).toBe(true);
  });

  it('marks a blacklisted issuer', async () => {
    const id = uuidv4();
    // The seeded certificates are self-signed: the issuer DN is CN=<certificate CN>.
    await db('ca_blacklist').insert({
      id,
      subject_dn: `CN=dsf-client.${sites[0].orgId}`,
      added_by: 'test',
      added_at: new Date(),
    });
    blacklistIds.push(id);
    const result = await assessPendingRequests(requests.slice(0, 1));
    const codes = [...result.values()][0].findings.map((f) => f.code);
    expect(codes).toContain('CERT_CA_BLACKLISTED');
  });
});
