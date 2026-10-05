/**
 * bundle-restore-requests.test.ts – restoring an old allow-list version is a
 * four-eyes decision: request (one pending at a time), approve by a second
 * admin of ANOTHER site (executes the restore, new version becomes current),
 * reject with comment, cancel by the requester; self-approval and same-site
 * approval are 403, non-admins 403, a missing step-up 401, versions without a
 * stored input stay VERSION_NOT_RESTORABLE at request and approval time.
 * Dependencies: supertest, app, db/connection, bundle-versions.service,
 *               helpers/allowListSites, helpers/hackathon, helpers/auth
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { createSnapshot } from '../../services/bundle-versions.service';
import { getTestToken } from '../helpers/auth';
import { removeSites, seedSite, type Site } from '../helpers/allowListSites';
import {
  api,
  certLogin,
  hackathonManifest,
  removeParticipants,
  seedParticipants,
  type Participant,
} from '../helpers/hackathon';

describe('four-eyes restore of a bundle version', () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  let site: Site;
  let a: Participant;
  let b: Participant;
  let sourceId = '';
  let sourceNumber = 0;
  const versionIds: string[] = [];

  const requestUrl = (id: string) => `/api/v1/admin/bundle-versions/${id}/restore`;
  const decide = (rid: string, what: 'approve' | 'reject' | 'cancel') =>
    `/api/v1/admin/bundle-restores/${rid}/${what}`;
  const requestRestore = async (p: Participant = a, reason = `restore ${run}`) => {
    const res = await api(p).post(requestUrl(sourceId), { reason });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const statusOf = async (rid: string) =>
    (await db('bundle_restore_requests').where({ id: rid }).first()).status as string;

  beforeAll(async () => {
    site = await seedSite({ label: 'restore-req' });
    [a, b] = await seedParticipants(hackathonManifest(2, run));
    a.token = await certLogin(a.pem);
    b.token = await certLogin(b.pem);
    const s = await createSnapshot({ triggeredBy: 'MANUAL', triggeredByEmail: 'rr@example.de' });
    sourceId = s.id;
    sourceNumber = s.versionNumber;
    versionIds.push(s.id);
  });

  beforeEach(async () => {
    await db('bundle_restore_requests').del();
  });

  afterAll(async () => {
    await db('bundle_restore_requests').del();
    await db('bundle_versions').whereIn('id', versionIds).del();
    await db('bundle_versions').where('notes', 'like', `%${run}%`).del();
    await removeParticipants(
      [a.user.email, b.user.email],
      [a.user.orgIdentifier, b.user.orgIdentifier],
    );
    await removeSites([site]);
  });

  it('creates a PENDING request, publishes nothing and writes an audit entry', async () => {
    const before = await db('bundle_versions').count<[{ n: number }]>({ n: '*' }).first();
    const rid = await requestRestore();
    const after = await db('bundle_versions').count<[{ n: number }]>({ n: '*' }).first();
    expect(Number(after?.n)).toBe(Number(before?.n));
    const row = await db('bundle_restore_requests').where({ id: rid }).first();
    expect(row).toMatchObject({
      status: 'PENDING',
      source_version_id: sourceId,
      requested_by: a.user.email.toLowerCase(),
      reason: `restore ${run}`,
    });
    const audit = await db('audit_logs').where({ resource_id: rid, operation: 'CREATE' }).first();
    expect(audit).toBeTruthy();

    const list = await api(b).get('/api/v1/admin/bundle-restores');
    expect(list.status).toBe(200);
    const found = (
      list.body.data as Array<{ id: string; status: string; sourceVersionNumber: number }>
    ).find((r) => r.id === rid);
    expect(found).toMatchObject({ status: 'PENDING', sourceVersionNumber: sourceNumber });
  });

  it('allows only one pending request at a time (409)', async () => {
    await requestRestore();
    const second = await api(b).post(requestUrl(sourceId), { reason: `again ${run}` });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_PENDING');
  });

  it('refuses non-admins (403) and a missing step-up (401)', async () => {
    const nonAdmin = await request(app)
      .post(requestUrl(sourceId))
      .set('Authorization', `Bearer ${getTestToken(site.email, site.userId)}`)
      .send({ reason: 'not allowed' });
    expect(nonAdmin.status).toBe(403);
    const noStepUp = await request(app)
      .post(requestUrl(sourceId))
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reason: 'no step up' });
    expect(noStepUp.status).toBe(401);

    const rid = await requestRestore();
    const listAsSite = await request(app)
      .get('/api/v1/admin/bundle-restores')
      .set('Authorization', `Bearer ${getTestToken(site.email, site.userId)}`);
    expect(listAsSite.status).toBe(403);
    const approveAsSite = await request(app)
      .post(decide(rid, 'approve'))
      .set('Authorization', `Bearer ${getTestToken(site.email, site.userId)}`);
    expect(approveAsSite.status).toBe(403);
    const approveNoStepUp = await request(app)
      .post(decide(rid, 'approve'))
      .set('Authorization', `Bearer ${b.token}`);
    expect(approveNoStepUp.status).toBe(401);
    expect(await statusOf(rid)).toBe('PENDING');
  });

  it('refuses versions without a stored input at request time (409)', async () => {
    const legacy = await createSnapshot({
      triggeredBy: 'MANUAL',
      triggeredByEmail: 'rr@example.de',
    });
    await db('bundle_versions').where({ id: legacy.id }).update({ input_json: null });
    const res = await api(a).post(requestUrl(legacy.id), { reason: `legacy ${run}` });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_NOT_RESTORABLE');
    await db('bundle_versions').where({ id: legacy.id }).del();
  });

  it('validates the reason and answers 404 for unknown versions', async () => {
    expect((await api(a).post(requestUrl(sourceId), { reason: 'x' })).status).toBe(400);
    const unknown = await api(a).post(requestUrl('00000000-0000-4000-8000-000000000000'), {
      reason: 'abc',
    });
    expect(unknown.status).toBe(404);
  });

  it('refuses self-approval (403)', async () => {
    const rid = await requestRestore();
    const res = await api(a).post(decide(rid, 'approve'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_APPROVE');
    expect(await statusOf(rid)).toBe('PENDING');
  });

  it('refuses an approver from the requesters site (403)', async () => {
    const rid = await requestRestore();
    const domain = b.user.email.split('@')[1];
    await db('bundle_restore_requests')
      .where({ id: rid })
      .update({ requested_by: `colleague@${domain}` });
    const res = await api(b).post(decide(rid, 'approve'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SAME_SITE');
    expect(await statusOf(rid)).toBe('PENDING');
  });

  it('executes the restore on approval: new RESTORE version, recorded on the request', async () => {
    const rid = await requestRestore();
    const res = await api(b).post(decide(rid, 'approve'));
    expect(res.status).toBe(200);
    expect(res.body.data.restoredFromVersion).toBe(sourceNumber);
    versionIds.push(res.body.data.id);

    const version = await db('bundle_versions').where({ id: res.body.data.id }).first();
    expect(version.triggered_by).toBe('RESTORE');
    expect(version.triggered_by_email).toBe(b.user.email.toLowerCase());
    expect(version.notes).toBe(`Restored from v${sourceNumber}: restore ${run}`);

    const row = await db('bundle_restore_requests').where({ id: rid }).first();
    expect(row).toMatchObject({
      status: 'APPROVED',
      decided_by: b.user.email.toLowerCase(),
      resulting_version_id: res.body.data.id,
    });
    expect(row.decided_at).toBeTruthy();
    const latest = await db('bundle_versions').orderBy('version_number', 'desc').first();
    expect(latest.id).toBe(res.body.data.id);
    const audit = await db('audit_logs').where({ resource_id: rid, operation: 'APPROVE' }).first();
    expect(audit).toBeTruthy();

    const list = await api(a).get('/api/v1/admin/bundle-restores');
    const found = (
      list.body.data as Array<{ id: string; resultingVersionNumber: number | null }>
    ).find((r) => r.id === rid);
    expect(found?.resultingVersionNumber).toBe(res.body.data.versionNumber);
  });

  it('keeps the first decision final (409 afterwards)', async () => {
    const rid = await requestRestore();
    expect((await api(b).post(decide(rid, 'reject'), { comment: 'no need' })).status).toBe(200);
    const again = await api(b).post(decide(rid, 'approve'));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOT_PENDING');
    expect((await api(a).post(decide(rid, 'cancel'))).status).toBe(409);
  });

  it('re-checks restorability at approval time and leaves the request pending', async () => {
    const snap = await createSnapshot({ triggeredBy: 'MANUAL', triggeredByEmail: 'rr@example.de' });
    versionIds.push(snap.id);
    const res = await api(a).post(requestUrl(snap.id), { reason: `late ${run}` });
    expect(res.status).toBe(201);
    await db('bundle_versions').where({ id: snap.id }).update({ input_json: null });
    const approve = await api(b).post(decide(res.body.data.id, 'approve'));
    expect(approve.status).toBe(409);
    expect(approve.body.error.code).toBe('VERSION_NOT_RESTORABLE');
    expect(await statusOf(res.body.data.id)).toBe('PENDING');
  });

  it('rejects with a comment (required) and records who decided', async () => {
    const rid = await requestRestore();
    expect((await api(b).post(decide(rid, 'reject'), {})).status).toBe(400);
    const res = await api(b).post(decide(rid, 'reject'), { comment: 'wrong version' });
    expect(res.status).toBe(200);
    const row = await db('bundle_restore_requests').where({ id: rid }).first();
    expect(row).toMatchObject({
      status: 'REJECTED',
      decided_by: b.user.email.toLowerCase(),
      decision_comment: 'wrong version',
    });
    const audit = await db('audit_logs').where({ resource_id: rid, operation: 'REJECT' }).first();
    expect(audit).toBeTruthy();
    // A new request is possible again.
    await requestRestore();
  });

  it('lets only the requester cancel', async () => {
    const rid = await requestRestore();
    const other = await api(b).post(decide(rid, 'cancel'));
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('NOT_REQUESTER');
    expect((await api(a).post(decide(rid, 'cancel'))).status).toBe(200);
    expect(await statusOf(rid)).toBe('CANCELLED');
    const audit = await db('audit_logs').where({ resource_id: rid, operation: 'DELETE' }).first();
    expect(audit).toBeTruthy();
  });

  it('answers 404 for an unknown request', async () => {
    const res = await api(b).post(decide('00000000-0000-4000-8000-000000000000', 'approve'));
    expect(res.status).toBe(404);
  });
});
