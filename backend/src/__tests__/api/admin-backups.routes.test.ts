/**
 * admin-backups.routes.test.ts – Admin API for backups: non-admins get 403,
 * writes and the download need the certificate step-up (401 without it),
 * settings validation, "back up now", run list, and the audited download.
 * Dependencies: supertest, app, db/connection, helpers/hackathon, helpers/auth,
 *               helpers/allowListSites
 */
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { app } from '../../app';
import { db } from '../../db/connection';
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
import { getSettings, updateSettings } from '../../services/backup.service';

const BASE = '/api/v1/admin/backups';

describe('/api/v1/admin/backups', () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const manifest = hackathonManifest(1, run);
  let admin: Participant;
  let siteUser: Site;
  let dir: string;
  let original: Awaited<ReturnType<typeof getSettings>>;

  beforeAll(async () => {
    original = await getSettings();
    dir = await mkdtemp(join(tmpdir(), 'bk-api-'));
    process.env.BACKUP_DIR = dir;
    [admin] = await seedParticipants(manifest);
    admin.token = await certLogin(admin.pem);
    siteUser = await seedSite({ label: 'bk-user', approval: null });
  });

  afterAll(async () => {
    delete process.env.BACKUP_DIR;
    await db('backup_runs').where({ triggered_by: admin.user.email }).del();
    await updateSettings(
      {
        enabled: original.enabled,
        mode: original.mode,
        dailyTime: original.dailyTime,
        retentionCount: original.retentionCount,
      },
      admin.user.email,
    );
    await db('audit_logs').where({ user_email: admin.user.email }).del();
    await removeParticipants([admin.user.email], [admin.user.orgIdentifier]);
    await removeSites([siteUser]);
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses non-admins on every route', async () => {
    const auth = { Authorization: `Bearer ${getTestToken(siteUser.email, siteUser.userId)}` };
    const calls = [
      request(app).get(`${BASE}/settings`).set(auth),
      request(app).put(`${BASE}/settings`).set(auth).send({}),
      request(app).get(`${BASE}/runs`).set(auth),
      request(app).post(`${BASE}/run`).set(auth),
      request(app).post(`${BASE}/runs/x/download`).set(auth),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });

  it('requires a bearer token', async () => {
    expect((await request(app).get(`${BASE}/runs`)).status).toBe(401);
  });

  it('rejects writes and the download without the certificate step-up', async () => {
    const auth = { Authorization: `Bearer ${admin.token}` };
    const put = await request(app).put(`${BASE}/settings`).set(auth).send({});
    const post = await request(app).post(`${BASE}/run`).set(auth);
    const dl = await request(app).post(`${BASE}/runs/x/download`).set(auth);
    expect([put.status, post.status, dl.status]).toEqual([401, 401, 401]);
    expect(put.body.error.code).toBe('CERT_STEP_UP_FAILED');
  });

  it('reads the settings and whether files are encrypted', async () => {
    const res = await api(admin).get(`${BASE}/settings`);
    expect(res.status).toBe(200);
    expect(res.body.data.settings).toMatchObject({ mode: expect.any(String) });
    expect(res.body.data.encryptionEnabled).toBe(false);
    expect(res.body.data.directory).toBe(dir);
  });

  it('validates and saves the schedule, and audits the change', async () => {
    const bad = [
      { enabled: true, mode: 'WEEKLY', dailyTime: '02:30', retentionCount: 14 },
      { enabled: true, mode: 'DAILY', dailyTime: '25:00', retentionCount: 14 },
      { enabled: true, mode: 'DAILY', dailyTime: '02:30', retentionCount: 3 },
      { enabled: true, mode: 'DAILY', dailyTime: '02:30', retentionCount: 1000 },
    ];
    for (const body of bad) {
      expect((await api(admin).put(`${BASE}/settings`, body)).status).toBe(400);
    }
    const ok = await api(admin).put(`${BASE}/settings`, {
      enabled: true,
      mode: 'EVERY_6H',
      dailyTime: '03:15',
      retentionCount: 21,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.settings).toMatchObject({
      enabled: true,
      mode: 'EVERY_6H',
      dailyTime: '03:15',
      retentionCount: 21,
      updatedBy: admin.user.email,
    });
    const audit = await db('audit_logs')
      .where({ user_email: admin.user.email, resource_type: 'BACKUP', operation: 'UPDATE' })
      .first();
    expect(audit).toBeTruthy();
  });

  it('creates a backup now, lists it and streams the file with an audit entry', async () => {
    const created = await api(admin).post(`${BASE}/run`);
    expect(created.status).toBe(201);
    const runRow = created.body.data.run;
    expect(runRow).toMatchObject({ status: 'SUCCESS', trigger: 'MANUAL' });

    const list = await api(admin).get(`${BASE}/runs`);
    expect(list.status).toBe(200);
    expect(list.body.data.runs.some((r: { id: string }) => r.id === runRow.id)).toBe(true);

    const dl = await api(admin)
      .post(`${BASE}/runs/${runRow.id}/download`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain(`filename="${runRow.fileName}"`);
    expect(
      createHash('sha256')
        .update(dl.body as Buffer)
        .digest('hex'),
    ).toBe(runRow.sha256);
    const audit = await db('audit_logs')
      .where({ user_email: admin.user.email, resource_id: runRow.id, operation: 'DOWNLOAD' })
      .first();
    expect(audit).toBeTruthy();
  });

  it('answers 404 for an unknown run and never serves path-like names', async () => {
    expect((await api(admin).post(`${BASE}/runs/does-not-exist/download`)).status).toBe(404);
    await db('backup_runs').insert({
      id: `bkt-${run}`,
      started_at: new Date(),
      finished_at: new Date(),
      trigger_type: 'MANUAL',
      triggered_by: admin.user.email,
      status: 'SUCCESS',
      file_name: '../../etc/passwd',
      size_bytes: 1,
      sha256: 'a'.repeat(64),
      encrypted: 0,
      duration_ms: 1,
      file_deleted: 0,
    });
    expect((await api(admin).post(`${BASE}/runs/bkt-${run}/download`)).status).toBe(404);
  });
});
