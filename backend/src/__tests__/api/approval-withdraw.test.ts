/**
 * approval-withdraw.test.ts — POST /instances/:id/approval/withdraw.
 * Covers: happy path (status WITHDRAWN + audit WITHDRAW + resubmit possible),
 * 409 NOT_PENDING without a pending request, foreign instance refused,
 * the race with an admin approval (exactly one wins), the admin pending list
 * excluding withdrawn requests, and a partial four-eyes approval on a
 * withdrawn request never counting later.
 *
 * Dependencies: supertest, app, db, seed helpers, auth helper,
 *               approval.service, jest.mock(approval-reminder.service)
 */

jest.mock('../../services/approval-reminder.service', () => ({
  notifyImiOnSubmit: jest.fn().mockResolvedValue(undefined),
  notifySiteOnApproval: jest.fn().mockResolvedValue(undefined),
  notifyImiOnFirstApproval: jest.fn().mockResolvedValue(undefined),
  runApprovalReminders: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { approveRequest } from '../../services/approval.service';
import {
  cleanTestData,
  seedTestUser,
  seedAdminUser,
  seedOrganization,
  TEST_INSTANCE_ID,
  TEST_ADMIN_EMAIL,
  TEST_EMAIL,
} from '../helpers/seed';
import { getTestToken } from '../helpers/auth';
import { v4 as uuidv4 } from 'uuid';

const withdrawUrl = `/api/v1/instances/${TEST_INSTANCE_ID}/approval/withdraw`;
const submitUrl = `/api/v1/instances/${TEST_INSTANCE_ID}/approval/submit`;

describe('Approval withdraw', () => {
  let userToken: string;
  let adminToken: string;

  async function submit(): Promise<string> {
    const res = await request(app).post(submitUrl).set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  beforeEach(async () => {
    await cleanTestData();
    const { email } = await seedTestUser();
    await seedAdminUser();
    await seedOrganization();
    userToken = getTestToken(email);
    adminToken = getTestToken(TEST_ADMIN_EMAIL, '00000000-0000-0000-0000-000000000002');
  });

  afterAll(async () => {
    await cleanTestData();
  });

  it('withdraws a pending request, audits it and allows a new submit', async () => {
    const id = await submit();
    const running = await request(app)
      .get(`/api/v1/instances/${TEST_INSTANCE_ID}/approval/status`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(running.body.data.submitted_by).toBe(TEST_EMAIL);
    const res = await request(app).post(withdrawUrl).set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.status).toBe('WITHDRAWN');
    expect(res.body.data.resolved_at).toBeTruthy();

    const audit = await db('audit_logs').where({ resource_id: id, operation: 'WITHDRAW' });
    expect(audit).toHaveLength(1);

    const status = await request(app)
      .get(`/api/v1/instances/${TEST_INSTANCE_ID}/approval/status`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(status.body.data.status).toBe('WITHDRAWN');

    const history = await request(app)
      .get(`/api/v1/instances/${TEST_INSTANCE_ID}/approval/history`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(history.body.data[0].status).toBe('WITHDRAWN');

    await submit();
  });

  it('answers 409 NOT_PENDING when nothing is pending', async () => {
    const none = await request(app).post(withdrawUrl).set('Authorization', `Bearer ${userToken}`);
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('NOT_PENDING');

    await submit();
    await request(app).post(withdrawUrl).set('Authorization', `Bearer ${userToken}`);
    const twice = await request(app).post(withdrawUrl).set('Authorization', `Bearer ${userToken}`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('NOT_PENDING');
  });

  it('refuses a foreign instance and requires authentication', async () => {
    await submit();
    const otherEmail = 'other@other-hospital.example.de';
    const otherId = uuidv4();
    await db('email_whitelist').insert({
      id: uuidv4(),
      email: otherEmail,
      created_by: 'test',
      created_at: new Date(),
    });
    await db('users').insert({
      id: otherId,
      email: otherEmail,
      totp_enabled: false,
      created_at: new Date(),
    });
    const foreign = await request(app)
      .post(withdrawUrl)
      .set('Authorization', `Bearer ${getTestToken(otherEmail, otherId)}`);
    expect([403, 404]).toContain(foreign.status);
    const anon = await request(app).post(withdrawUrl);
    expect(anon.status).toBe(401);

    const row = await db('approval_requests').where({ instance_id: TEST_INSTANCE_ID }).first();
    expect(row.status).toBe('PENDING');
  });

  it('lets exactly one of a concurrent withdraw and approval win', async () => {
    const id = await submit();
    const [w, a] = await Promise.allSettled([
      request(app).post(withdrawUrl).set('Authorization', `Bearer ${userToken}`),
      approveRequest(id, 'admin-a@imi-test.example.de'),
    ]);
    const withdrawn = w.status === 'fulfilled' && w.value.status === 200;
    const row = await db('approval_requests').where({ id }).first();
    if (withdrawn) {
      expect(row.status).toBe('WITHDRAWN');
      // The approval lost: either it ran first as a partial first approval or
      // it saw the finalized request.
      if (a.status === 'rejected') expect(String(a.reason.message)).toBe('REQUEST_FINALIZED');
    } else {
      expect(w.status === 'fulfilled' && w.value.status).toBe(409);
      expect(['PENDING', 'APPROVED']).toContain(row.status);
    }
  });

  it('keeps withdrawn requests out of the admin pending list', async () => {
    await submit();
    await request(app).post(withdrawUrl).set('Authorization', `Bearer ${userToken}`);
    const res = await request(app)
      .get('/api/v1/admin/approval/pending')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('never counts a partial approval of a withdrawn request', async () => {
    const id = await submit();
    await approveRequest(id, 'admin-a@imi-test.example.de');
    await request(app).post(withdrawUrl).set('Authorization', `Bearer ${userToken}`);

    await expect(approveRequest(id, 'admin-c@charite-test.example.de')).rejects.toThrow(
      'REQUEST_FINALIZED',
    );
    const row = await db('approval_requests').where({ id }).first();
    expect(row.status).toBe('WITHDRAWN');
  });
});
