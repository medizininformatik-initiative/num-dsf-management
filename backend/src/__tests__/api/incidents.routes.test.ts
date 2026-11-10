/**
 * incidents.routes.test.ts – Incident register over HTTP: any signed-in user
 * reports (validated) and reads what is visible to them; admin actions need
 * an admin and the step-up; a site user cannot call them; the export carries
 * the description and the hash chain; uploads of a blocked certificate are
 * answered with 409 CERT_BLOCKED.
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
const adminEmail = `incr-admin-${sfx}@imi-test.example.de`;
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
  site = await seedSite({ label: 'incr-site' });
  bystander = await seedSite({ label: 'incr-other' });
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

async function reportAsSite(body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/incidents')
    .set(siteAuth(site))
    .send({
      organizationId: site.orgId,
      title: 'Suspicious login',
      description: 'Internal details',
      escalationLevel: 2,
      ...body,
    });
  if (res.status === 201) created.push(res.body.data.id);
  return res;
}

describe('incident routes', () => {
  it('requires a session', async () => {
    expect((await request(app).get('/api/v1/incidents')).status).toBe(401);
  });

  it('validates a report', async () => {
    expect((await reportAsSite({ title: 'x' })).status).toBe(400);
    expect((await reportAsSite({ escalationLevel: 4 })).status).toBe(400);
    expect((await reportAsSite({ zulipUrl: 'http://zulip.example.de/x' })).status).toBe(400);
    expect(
      (await reportAsSite({ detectedAt: new Date(Date.now() + 86_400_000).toISOString() })).status,
    ).toBe(400);
  });

  it('lets a site report, read its own report and hides it from others until confirmed', async () => {
    const res = await reportAsSite({ dpoInformed: true });
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    expect(res.body.data.description).toBe('Internal details');
    expect(res.body.data.dpoInformed.by).toBe(site.email);

    const own = await request(app).get(`/api/v1/incidents/${id}`).set(siteAuth(site));
    expect(own.status).toBe(200);
    expect(own.body.data.chain).toEqual({ valid: true, brokenAt: null, tamperedFields: [] });
    expect(
      (await request(app).get(`/api/v1/incidents/${id}`).set(siteAuth(bystander))).status,
    ).toBe(404);

    const confirm = await request(app)
      .post(`/api/v1/admin/incidents/${id}/confirm`)
      .set(adminAuth())
      .send(TOTP);
    expect(confirm.status).toBe(200);
    const seen = await request(app).get(`/api/v1/incidents/${id}`).set(siteAuth(bystander));
    expect(seen.status).toBe(200);
    expect(seen.body.data.incident.description).toBeNull();
    expect(seen.body.data.incident.reportedBy).toBeNull();
    expect(seen.body.data.events[0].actorEmail).toBeNull();
  });

  it('keeps admin actions away from site users and requires the step-up', async () => {
    const id = (await reportAsSite()).body.data.id;
    const forbidden = await request(app)
      .post(`/api/v1/admin/incidents/${id}/confirm`)
      .set(siteAuth(site))
      .send(TOTP);
    expect(forbidden.status).toBe(403);
    const noCode = await request(app)
      .post(`/api/v1/admin/incidents/${id}/confirm`)
      .set(adminAuth())
      .send({});
    expect(noCode.status).toBe(400);
    expect(noCode.body.error.code).toBe('TOTP_REQUIRED');
    const comment = await request(app)
      .post(`/api/v1/admin/incidents/${id}/comment`)
      .set(adminAuth())
      .send({ text: 'Phoned the site' });
    expect(comment.status).toBe(201);
    expect(comment.body.data.type).toBe('COMMENT');
  });

  it('suspends, refuses the blocked certificate on upload and exports the incident', async () => {
    const id = (await reportAsSite()).body.data.id;
    const suspend = await request(app)
      .post(`/api/v1/admin/incidents/${id}/suspend`)
      .set(adminAuth())
      .send({ measures: ['BLOCK_CERTIFICATES', 'WITHDRAW'], confirm: true, ...TOTP });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.incident.suspended).toBe(true);

    const upload = await request(app)
      .post(`/api/v1/instances/${bystander.instanceId}/certificates`)
      .set(siteAuth(bystander))
      .send({ pem: site.certPem });
    expect(upload.status).toBe(409);
    expect(upload.body.error.code).toBe('CERT_BLOCKED');

    const close = await request(app)
      .post(`/api/v1/admin/incidents/${id}/close`)
      .set(adminAuth())
      .send({ outcome: 'CLOSED', note: 'review', ...TOTP });
    expect(close.status).toBe(409);
    expect(close.body.error.code).toBe('STILL_SUSPENDED');

    const badLift = await request(app)
      .post(`/api/v1/admin/incidents/${id}/lift-suspension`)
      .set(adminAuth())
      .send({ causeFixed: true, fixTested: false, releasedByTechBoard: true, note: 'x', ...TOTP });
    expect(badLift.status).toBe(400);

    const json = await request(app).get(`/api/v1/admin/incidents/${id}/export`).set(adminAuth());
    expect(json.status).toBe(200);
    expect(json.headers['content-disposition']).toContain(`incident-${id}.json`);
    const doc = JSON.parse(json.text);
    expect(doc.incident.description).toBe('Internal details');
    expect(doc.chain.valid).toBe(true);
    expect(doc.events.every((e: { hash: string }) => /^[0-9a-f]{64}$/.test(e.hash))).toBe(true);

    const csv = await request(app)
      .get(`/api/v1/admin/incidents/${id}/export?format=csv`)
      .set(adminAuth());
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('seq,at,actor,type,details,prev_hash,hash');
    expect(csv.text).toContain('SUSPENDED');
  });

  it('updates fields and ticks a BSI stage over the API', async () => {
    const id = (await reportAsSite()).body.data.id;
    const patch = await request(app)
      .patch(`/api/v1/admin/incidents/${id}`)
      .set(adminAuth())
      .send({ escalationLevel: 3 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.escalationLevel).toBe(3);
    expect(
      (await request(app).patch(`/api/v1/admin/incidents/${id}`).set(adminAuth()).send({})).status,
    ).toBe(400);
    // Detection time and Zulip link move the NIS2 deadlines / are shown to all
    // sites: they need the step-up, the escalation level does not.
    const detectedAt = new Date(Date.now() - 3_600_000).toISOString();
    const zulipUrl = 'https://zulip.example.de/#narrow/topic/y';
    for (const body of [{ detectedAt }, { zulipUrl }]) {
      const noCode = await request(app)
        .patch(`/api/v1/admin/incidents/${id}`)
        .set(adminAuth())
        .send(body);
      expect(noCode.status).toBe(400);
      expect(noCode.body.error.code).toBe('TOTP_REQUIRED');
      const withCode = await request(app)
        .patch(`/api/v1/admin/incidents/${id}`)
        .set(adminAuth())
        .send({ ...body, ...TOTP });
      expect(withCode.status).toBe(200);
    }
    const tick = await request(app)
      .post(`/api/v1/incidents/${id}/nis2/NOTIFICATION`)
      .set(siteAuth(site));
    expect(tick.status).toBe(200);
    expect(tick.body.data.nis2[1].reportedBy).toBe(site.email);
    const again = await request(app)
      .post(`/api/v1/incidents/${id}/nis2/NOTIFICATION`)
      .set(siteAuth(site));
    expect(again.status).toBe(409);
    expect(
      (await request(app).post(`/api/v1/incidents/${id}/nis2/WHATEVER`).set(siteAuth(site))).status,
    ).toBe(400);
  });

  it("lists the approved sites and the caller's own for the report form", async () => {
    const unapproved = await seedSite({ label: 'incr-unapproved', approval: null });
    try {
      const ids = async (s: Site) =>
        (await request(app).get('/api/v1/incidents/organizations').set(siteAuth(s))).body.data.map(
          (o: { identifier: string }) => o.identifier,
        );
      const forSite = await ids(site);
      expect(forSite).toContain(site.orgId);
      expect(forSite).toContain(bystander.orgId);
      expect(forSite).not.toContain(unapproved.orgId);
      expect(await ids(unapproved)).toContain(unapproved.orgId);
    } finally {
      await removeSites([unapproved]);
    }
  });

  it('refuses control characters in the title and implausible detection times', async () => {
    expect((await reportAsSite({ title: 'Bad\u0007title' })).status).toBe(400);
    expect((await reportAsSite({ title: 'Two\nlines' })).status).toBe(400);
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString();
    expect((await reportAsSite({ detectedAt: twoYearsAgo })).status).toBe(400);
    const lastMonth = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect((await reportAsSite({ detectedAt: lastMonth })).status).toBe(201);
  });
});
