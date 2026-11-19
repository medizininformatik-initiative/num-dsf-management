/**
 * incident-archive.routes.test.ts – Archiving (soft delete) of incidents: only a
 * CLOSED / FALSE_ALARM incident without an active suspension can be archived
 * (admin, step-up); archived incidents leave the default lists, stay visible to
 * an admin with includeArchived, and write an ARCHIVED event and an audit entry.
 * Dependencies: supertest, app, db, helpers/auth, helpers/allowListSites, lib/adminGrants
 */
jest.mock('../../services/totp.service', () => ({
  ...jest.requireActual('../../services/totp.service'),
  verifyTotpCode: jest.fn().mockResolvedValue(true),
}));

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';
import { signGrant } from '../../lib/adminGrants';
import { removeSites, seedSite, type Site } from '../helpers/allowListSites';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `inca-admin-${sfx}@imi-test.example.de`;
const adminId = uuidv4();
let site: Site;
let bystander: Site;
const created: string[] = [];

const adminAuth = () => ({ Authorization: `Bearer ${getTestToken(adminEmail, adminId)}` });
const siteAuth = (s: Site) => ({ Authorization: `Bearer ${getTestToken(s.email, s.userId)}` });
const TOTP = { totpCode: '123456' };

beforeAll(async () => {
  await db('email_whitelist').insert({ id: uuidv4(), email: adminEmail, created_at: new Date() });
  await db('users').insert({
    id: adminId,
    email: adminEmail,
    totp_enabled: true,
    totp_secret: 'placeholder',
  });
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: adminEmail,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(adminEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
  site = await seedSite({ label: 'inca-site' });
  bystander = await seedSite({ label: 'inca-other' });
});

afterAll(async () => {
  if (created.length) {
    await db('incident_events').whereIn('incident_id', created).del();
    await db('blocked_certificate_thumbprints').whereIn('incident_id', created).del();
    await db('incidents').whereIn('id', created).del();
  }
  await db('bundle_versions').where({ triggered_by_email: adminEmail }).del();
  await db('audit_logs').where({ user_email: adminEmail }).del();
  await db('admin_grants').where({ email: adminEmail }).del();
  await db('users').where({ id: adminId }).del();
  await db('email_whitelist').where({ email: adminEmail }).del();
  await removeSites([site, bystander]);
});

async function report(): Promise<string> {
  const res = await request(app).post('/api/v1/incidents').set(siteAuth(site)).send({
    organizationId: site.orgId,
    title: 'Suspicious login',
    description: 'Internal details',
    escalationLevel: 1,
  });
  expect(res.status).toBe(201);
  created.push(res.body.data.id);
  return res.body.data.id;
}

const post = (id: string, action: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/v1/admin/incidents/${id}/${action}`)
    .set(adminAuth())
    .send({ ...TOTP, ...body });

const listIds = async (auth: Record<string, string>, query = '') =>
  (
    (await request(app).get(`/api/v1/incidents${query}`).set(auth)).body.data as { id: string }[]
  ).map((i) => i.id);

describe('incident archive', () => {
  it('archives a false alarm, hides it from the lists and records event + audit', async () => {
    const id = await report();
    await post(id, 'confirm');
    expect((await post(id, 'close', { outcome: 'FALSE_ALARM', note: 'test run' })).status).toBe(
      200,
    );
    expect(await listIds(adminAuth())).toContain(id);
    expect(await listIds(siteAuth(bystander))).toContain(id);

    const res = await post(id, 'archive');
    expect(res.status).toBe(200);
    expect(res.body.data.archivedAt).toBeTruthy();
    expect(res.body.data.archivedBy).toBe(adminEmail);

    expect(await listIds(adminAuth())).not.toContain(id);
    expect(await listIds(siteAuth(bystander))).not.toContain(id);
    expect(await listIds(siteAuth(site))).not.toContain(id);
    expect(await listIds(adminAuth(), '?includeArchived=true')).toContain(id);
    // Sites cannot opt in to archived incidents.
    expect(await listIds(siteAuth(bystander), '?includeArchived=true')).not.toContain(id);

    const events = await db('incident_events').where({ incident_id: id }).orderBy('seq', 'asc');
    expect(events[events.length - 1].type).toBe('ARCHIVED');
    const detail = await request(app).get(`/api/v1/incidents/${id}`).set(adminAuth());
    expect(detail.body.data.chain.valid).toBe(true);
    const audit = await db('audit_logs').where({ resource_type: 'INCIDENT', resource_id: id });
    expect(audit.some((a) => JSON.stringify(a.diff_json).includes('incident_archive'))).toBe(true);
  });

  it('archives a closed incident whose suspension was lifted and keeps its blocks', async () => {
    const id = await report();
    await post(id, 'suspend', { measures: ['BLOCK_CERTIFICATES', 'WITHDRAW'], confirm: true });
    const lift = await post(id, 'lift-suspension', {
      causeFixed: true,
      fixTested: true,
      releasedByTechBoard: true,
      note: 'fixed',
    });
    expect(lift.status).toBe(200);
    expect((await post(id, 'close', { outcome: 'CLOSED', note: 'review done' })).status).toBe(200);
    const blocked = await db('blocked_certificate_thumbprints').where({ incident_id: id });
    expect(blocked.length).toBeGreaterThan(0);
    expect((await post(id, 'archive')).status).toBe(200);
    expect(await db('blocked_certificate_thumbprints').where({ incident_id: id })).toHaveLength(
      blocked.length,
    );
  });

  it('refuses while the incident is open or still suspends the site', async () => {
    const open = await report();
    const refused = await post(open, 'archive');
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('NOT_ARCHIVABLE');

    const suspended = await report();
    await post(suspended, 'suspend', { measures: ['WITHDRAW'], confirm: true });
    const stillSuspended = await post(suspended, 'archive');
    expect(stillSuspended.status).toBe(409);
    expect(stillSuspended.body.error.code).toBe('NOT_ARCHIVABLE');
    expect(await listIds(adminAuth())).toEqual(expect.arrayContaining([open, suspended]));
  });

  it('refuses a second archive, a missing step-up and a site user', async () => {
    const id = await report();
    await post(id, 'close', { outcome: 'FALSE_ALARM', note: 'x' });
    const noCode = await request(app)
      .post(`/api/v1/admin/incidents/${id}/archive`)
      .set(adminAuth())
      .send({});
    expect(noCode.status).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/incidents/${id}/archive`)
          .set(siteAuth(site))
          .send(TOTP)
      ).status,
    ).toBe(403);
    expect((await post(id, 'archive')).status).toBe(200);
    const again = await post(id, 'archive');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_ARCHIVED');
    expect((await post(uuidv4(), 'archive')).status).toBe(404);
  });
});
