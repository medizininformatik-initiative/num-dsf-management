/**
 * instances-lifecycle.route.test.ts – archive, unarchive and delete routes of an
 * instance: owner only, delete behind step-up, 409 INSTANCE_HAS_HISTORY for an
 * approved instance, and the includeArchived list switch.
 * Step-up itself is covered elsewhere; here it is replaced by a pass-through
 * that still demands a totpCode so the missing-code path is exercised.
 * Dependencies: supertest, app, db/connection, helpers/auth
 */
import { v4 as uuidv4 } from 'uuid';
import request from 'supertest';

jest.mock('../middleware/stepUp.middleware', () => ({
  requireStepUp: (
    req: { body?: { totpCode?: string } },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.body?.totpCode) {
      res.status(400).json({ error: { code: 'TOTP_REQUIRED' } });
      return;
    }
    next();
  },
  checkStepUp: async () => ({ ok: true }),
  requireUploadStepUp: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { app } from '../app';
import { db } from '../db/connection';
import { getTestToken } from './helpers/auth';

describe('instance lifecycle routes', () => {
  const ownerId = uuidv4();
  const otherId = uuidv4();
  const ownerEmail = `lr-${uuidv4().slice(0, 8)}@example.de`;
  const otherEmail = `lr-o-${uuidv4().slice(0, 8)}@example.de`;
  const ids: string[] = [];
  let ownerToken: string;
  let otherToken: string;

  async function newInstance(): Promise<string> {
    const id = uuidv4();
    await db('instances').insert({ id, user_id: ownerId, label: id, created_at: new Date() });
    ids.push(id);
    return id;
  }

  beforeAll(async () => {
    await db('users').insert([
      { id: ownerId, email: ownerEmail, created_at: new Date() },
      { id: otherId, email: otherEmail, created_at: new Date() },
    ]);
    ownerToken = getTestToken(ownerEmail, ownerId);
    otherToken = getTestToken(otherEmail, otherId);
  });

  afterAll(async () => {
    try {
      await db('instances').whereIn('id', ids).del();
    } finally {
      await db('users').whereIn('id', [ownerId, otherId]).del();
    }
  });

  it('archive: 403 for a non-owner, 200 for the owner, list hides it unless asked', async () => {
    const id = await newInstance();
    const denied = await request(app)
      .put(`/api/v1/instances/${id}/archive`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .put(`/api/v1/instances/${id}/archive`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.archived_at).toBeTruthy();

    const hidden = await request(app)
      .get('/api/v1/instances')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(hidden.body.data.some((i: { id: string }) => i.id === id)).toBe(false);
    const shown = await request(app)
      .get('/api/v1/instances?includeArchived=true')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(shown.body.data.some((i: { id: string }) => i.id === id)).toBe(true);

    const back = await request(app)
      .put(`/api/v1/instances/${id}/unarchive`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(back.status).toBe(200);
    expect(back.body.data.archived_at).toBeNull();
  });

  it('delete: needs the step-up code, owner only, removes a never-approved instance', async () => {
    const id = await newInstance();
    const noCode = await request(app)
      .delete(`/api/v1/instances/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(noCode.status).toBe(400);

    const other = await request(app)
      .delete(`/api/v1/instances/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ totpCode: '123456' });
    expect(other.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/v1/instances/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ totpCode: '123456' });
    expect(ok.status).toBe(200);
    expect(await db('instances').where({ id }).first()).toBeUndefined();
  });

  it('delete: 409 INSTANCE_HAS_HISTORY after an approval', async () => {
    const id = await newInstance();
    await db('approval_requests').insert({ id: uuidv4(), instance_id: id, status: 'APPROVED' });
    const res = await request(app)
      .delete(`/api/v1/instances/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ totpCode: '123456' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSTANCE_HAS_HISTORY');
    expect(await db('instances').where({ id }).first()).toBeTruthy();
  });
});
