/**
 * approval-status.service.test.ts – getApprovalStatus reports the four-eyes
 * progress of the latest request: approval count, the silent-consent date
 * after the first approval, and nothing about who signed.
 * Dependencies: db/connection, approval.service
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { getApprovalStatus } from '../services/approval.service';

describe('approval.service – getApprovalStatus', () => {
  const instanceId = uuidv4();
  const userId = uuidv4();
  const requestId = uuidv4();
  const signedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 86400_000);

  beforeAll(async () => {
    await db('users').insert({
      id: userId,
      email: `${userId}@example.de`,
      totp_enabled: false,
      created_at: new Date(),
    });
    await db('instances').insert({
      id: instanceId,
      user_id: userId,
      label: 'status',
      created_at: new Date(),
    });
    await db('approval_requests').insert({
      id: requestId,
      instance_id: instanceId,
      status: 'PENDING',
      created_at: new Date(),
      submitted_at: new Date(),
      snapshot_json: JSON.stringify({}),
    });
  });

  afterAll(async () => {
    await db('approval_signatures').where({ approval_request_id: requestId }).del();
    await db('approval_requests').where({ instance_id: instanceId }).del();
    await db('instances').where({ id: instanceId }).del();
    await db('users').where({ id: userId }).del();
  });

  it('reports no approvals and no silent-consent date for a fresh request', async () => {
    const status = await getApprovalStatus(instanceId);
    expect(status?.fourEyes).toEqual({ approvals: 0, required: 2, silentConsentAt: null });
  });

  it('counts the first approval and dates silent consent from it', async () => {
    await db('approval_signatures').insert({
      id: uuidv4(),
      approval_request_id: requestId,
      admin_email: 'admin@site-one.example.de',
      admin_site: 'site-one.example.de',
      decision: 'APPROVE',
      signed_at: signedAt,
    });
    const status = await getApprovalStatus(instanceId);
    const days = parseInt(process.env.APPROVAL_SILENT_CONSENT_DAYS || '7', 10) || 7;
    expect(status?.fourEyes.approvals).toBe(1);
    expect(status?.fourEyes.silentConsentAt).toBe(
      new Date(signedAt.getTime() + days * 86400_000).toISOString(),
    );
    expect(JSON.stringify(status?.fourEyes)).not.toContain('site-one');
  });

  it('returns null for an instance without requests', async () => {
    expect(await getApprovalStatus(uuidv4())).toBeNull();
  });
});
