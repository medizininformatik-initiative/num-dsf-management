/**
 * admin-approval-risk.routes.test.ts – GET /api/v1/admin/approval/pending attaches a `risk`
 * assessment to every pending request: a first request is flagged as such, a resubmission is
 * compared with the last approved snapshot, and an unreadable snapshot degrades to a result
 * instead of failing the list.
 * Dependencies: supertest, app, db, getTestToken, signGrant, helpers/allowListSites,
 *               approval.service, jest.mock(approval-reminder.service)
 */
jest.mock('../../services/approval-reminder.service', () => ({
  notifyImiOnSubmit: jest.fn().mockResolvedValue(undefined),
  notifySiteOnApproval: jest.fn().mockResolvedValue(undefined),
  notifyImiOnFirstApproval: jest.fn().mockResolvedValue(undefined),
  runApprovalReminders: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';
import { signGrant } from '../../lib/adminGrants';
import { submitApproval } from '../../services/approval.service';
import { removeSites, seedSite, type Site } from '../helpers/allowListSites';

const SUFFIX = uuidv4().slice(0, 8);
const ADMIN_EMAIL = `risk-admin-${SUFFIX}@site-r-${SUFFIX}.example.de`;
const ADMIN_ID = uuidv4();
let site: Site;
const requestIds: string[] = [];

async function pendingRisk(requestId: string) {
  const res = await request(app)
    .get('/api/v1/admin/approval/pending')
    .set('Authorization', `Bearer ${getTestToken(ADMIN_EMAIL, ADMIN_ID)}`);
  expect(res.status).toBe(200);
  const found = res.body.data.find((r: { id: string }) => r.id === requestId);
  expect(found).toBeTruthy();
  return found.risk as {
    level: string;
    firstRequest: boolean;
    score: number;
    findings: Array<{ code: string; severity: string; params: Record<string, unknown> }>;
  };
}

beforeAll(async () => {
  await db('email_whitelist').insert({
    id: uuidv4(),
    email: ADMIN_EMAIL,
    created_by: 'test',
    created_at: new Date(),
  });
  await db('users').insert({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    totp_enabled: true,
    totp_secret: 'placeholder',
    created_at: new Date(),
  });
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: ADMIN_EMAIL,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(ADMIN_EMAIL, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
  site = await seedSite({ label: 'risk', approval: null });
});

afterAll(async () => {
  await db('audit_logs').whereIn('resource_id', requestIds).del();
  await db('approval_requests').whereIn('id', requestIds).del();
  await removeSites([site]);
  await db('admin_grants').where({ email: ADMIN_EMAIL }).del();
  await db('users').where({ id: ADMIN_ID }).del();
  await db('email_whitelist').where({ email: ADMIN_EMAIL }).del();
  await db.destroy();
});

describe('GET /api/v1/admin/approval/pending risk', () => {
  it('flags a first request and still checks the certificate issuer', async () => {
    const req = await submitApproval(site.instanceId, site.email, '203.0.113.7');
    requestIds.push(req.id);
    const risk = await pendingRisk(req.id);
    expect(risk.firstRequest).toBe(true);
    const codes = risk.findings.map((f) => f.code);
    expect(codes).toContain('FIRST_REQUEST');
    // The seeded certificate is self-signed, so its issuer is on no CA list.
    expect(codes).toContain('CERT_CA_NOT_WHITELISTED');
    expect(risk.level).toBe('HIGH');
  });

  it('compares a resubmission with the last approved snapshot', async () => {
    await db('approval_requests')
      .where({ id: requestIds[0] })
      .update({ status: 'APPROVED', resolved_at: new Date() });
    await db('organizations').where({ identifier: site.orgId }).update({ name: 'Renamed Site' });
    const req = await submitApproval(site.instanceId, site.email, '203.0.113.99');
    requestIds.push(req.id);
    const risk = await pendingRisk(req.id);
    expect(risk.firstRequest).toBe(false);
    const rename = risk.findings.find((f) => f.code === 'ORG_NAME_CHANGED');
    expect(rename?.params).toMatchObject({ to: 'Renamed Site' });
    // Submitted from an IP that never appeared before for this instance.
    expect(risk.findings.map((f) => f.code)).toContain('NEW_SUBMIT_IP');
    expect(risk.findings.map((f) => f.code)).not.toContain('CERT_CA_NOT_WHITELISTED');
  });

  it('does not fail the list for a request with an unreadable snapshot', async () => {
    await db('approval_requests')
      .where({ id: requestIds[1] })
      .update({ status: 'REJECTED', resolved_at: new Date() });
    const id = uuidv4();
    await db('approval_requests').insert({
      id,
      instance_id: site.instanceId,
      status: 'PENDING',
      created_at: new Date(),
      submitted_at: new Date(),
      snapshot_json: JSON.stringify({ unexpected: true }),
    });
    requestIds.push(id);
    const risk = await pendingRisk(id);
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(risk.level);
    // One rejection in the last 30 days is part of the context.
    expect(risk.findings.map((f) => f.code)).toContain('RECENT_REJECTIONS');
  });
});
