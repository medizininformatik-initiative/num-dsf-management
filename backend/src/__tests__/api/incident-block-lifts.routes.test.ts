/**
 * incident-block-lifts.routes.test.ts – Lifting the certificate blocks of a false alarm with two
 * admins (migration 041): only a FALSE_ALARM incident without an active suspension qualifies; admin
 * A requests with a reason, an admin of ANOTHER e-mail domain confirms (not the requester, not the
 * same domain), the requester can cancel, the first decision wins. A confirmed lift is respected by
 * every consumer of the blocks: the certificate login, the mTLS fetch of the allow list, the
 * allow-list input, the login sync, the upload guard and the admin-certificate guard; the block
 * rows stay, and a later incident can block the same thumbprint again. Events are chained,
 * the lift is audited, and writes need the step-up.
 * Dependencies: supertest, app, db, helpers/auth, helpers/allowListSites, incidents.service,
 *               incident-suspension.service, incident-blocks.service, fhir.service
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
import { sha512FingerprintFromPem } from '../../lib/certFingerprint';
import { mtlsHeaders, removeSites, seedSite, type Site } from '../helpers/allowListSites';
import * as incidents from '../../services/incidents.service';
import { liftSuspension, suspendIncident } from '../../services/incident-suspension.service';
import { blockFingerprints, isFingerprintBlocked } from '../../services/incident-blocks.service';
import { listEvents, verifyEvents } from '../../services/incident-events.service';
import { loadAllowListInput } from '../../services/fhir.service';
import { resolveCertLogin } from '../../services/auth.service';
import { syncLoginCertificatesFromApproval } from '../../services/login-certificate-sync.service';
import { createCertificate } from '../../services/certificate.service';
import { AdminCertError, assertAcceptable } from '../../services/admin-certificates.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const admins = {
  a: { email: `lift-a-${sfx}@uni-a.example.de`, id: uuidv4() },
  a2: { email: `lift-a2-${sfx}@uni-a.example.de`, id: uuidv4() },
  b: { email: `lift-b-${sfx}@uni-b.example.de`, id: uuidv4() },
};
type Who = keyof typeof admins;
const sites: Site[] = [];
const incidentIds: string[] = [];
const TOTP = { totpCode: '123456' };

const auth = (who: Who) => ({
  Authorization: `Bearer ${getTestToken(admins[who].email, admins[who].id)}`,
});
const caller = (who: Who): incidents.IncidentCaller => ({
  email: admins[who].email,
  isAdmin: true,
  instanceIds: [],
  ip: '127.0.0.1',
  scopeInstanceId: null,
});
const checklist = {
  causeFixed: true as const,
  fixTested: true as const,
  releasedByTechBoard: true as const,
  note: 'fixed',
};

beforeAll(async () => {
  for (const a of Object.values(admins)) {
    await db('email_whitelist').insert({ id: uuidv4(), email: a.email, created_at: new Date() });
    await db('users').insert({
      id: a.id,
      email: a.email,
      totp_enabled: true,
      totp_secret: 'placeholder',
    });
    const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await db('admin_grants').insert({
      email: a.email,
      granted_at: grantedAt,
      granted_by_a: 'SYSTEM:test',
      granted_by_b: 'SYSTEM:test',
      signature_hex: signGrant(a.email, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
    });
  }
});

afterAll(async () => {
  if (incidentIds.length) {
    await db('certificate_block_lifts').whereIn('incident_id', incidentIds).del();
    await db('certificate_block_lift_requests').whereIn('incident_id', incidentIds).del();
    await db('incident_events').whereIn('incident_id', incidentIds).del();
    await db('blocked_certificate_thumbprints').whereIn('incident_id', incidentIds).del();
    await db('incidents').whereIn('id', incidentIds).del();
  }
  const emails = Object.values(admins).map((a) => a.email);
  await db('bundle_versions').whereIn('triggered_by_email', emails).del();
  await db('audit_logs').whereIn('user_email', emails).del();
  await db('admin_grants').whereIn('email', emails).del();
  await db('users')
    .whereIn(
      'id',
      Object.values(admins).map((a) => a.id),
    )
    .del();
  await db('email_whitelist').whereIn('email', emails).del();
  await removeSites(sites);
});

/** Store the site's live member as the allowList section of its approved snapshot. */
async function approveLiveState(site: Site): Promise<string> {
  const member = (await loadAllowListInput()).members.find((m) => m.identifier === site.orgId);
  if (!member) throw new Error('site not published');
  const request = await db('approval_requests')
    .where({ instance_id: site.instanceId, status: 'APPROVED' })
    .first('id');
  await db('approval_requests')
    .where({ id: request.id })
    .update({
      snapshot_json: JSON.stringify({ allowList: { version: 1, active: true, member } }),
    });
  return request.id;
}

interface Setup {
  site: Site;
  incidentId: string;
  fp: string;
  requestId: string;
}

/** A site whose certificate an incident blocked; the incident ended as a false alarm. */
async function falseAlarm(label: string, end: 'FALSE_ALARM' | 'CLOSED' = 'FALSE_ALARM') {
  const site = await seedSite({ label });
  sites.push(site);
  // Uploaded by the clinic itself: one approval is enough for the login sync.
  await db('certificates').where({ organization_id: site.orgId }).update({ uploaded_by_admin: 0 });
  const requestId = await approveLiveState(site);
  const incident = await incidents.reportIncident(
    { organizationId: site.orgId, title: 'Key leaked', description: 'd', escalationLevel: 3 },
    caller('a'),
  );
  incidentIds.push(incident.id);
  await suspendIncident(
    incident.id,
    ['BLOCK_CERTIFICATES', 'REMOVE_LOGINS', 'WITHDRAW'],
    true,
    caller('a'),
  );
  await liftSuspension(incident.id, checklist, caller('a'));
  await incidents.closeIncident(incident.id, end, 'checked', caller('a'));
  const setup: Setup = {
    site,
    incidentId: incident.id,
    fp: sha512FingerprintFromPem(site.certPem!),
    requestId,
  };
  return setup;
}

const base = (id: string) => `/api/v1/admin/incidents/${id}/block-lifts`;
const requestLift = (who: Who, id: string, reason = 'It was a drill') =>
  request(app)
    .post(base(id))
    .set(auth(who))
    .send({ ...TOTP, reason });
const decide = (who: Who, id: string, rid: string, action: 'confirm' | 'cancel') =>
  request(app)
    .post(`${base(id)}/${rid}/${action}`)
    .set(auth(who))
    .send(TOTP);

describe('requesting', () => {
  it('lists the blocked thumbprints and needs a reason and the step-up', async () => {
    const s = await falseAlarm('lift-req');
    const list = await request(app).get(base(s.incidentId)).set(auth('a'));
    expect(list.status).toBe(200);
    expect(list.body.data.blocks).toHaveLength(1);
    expect(list.body.data.blocks[0]).toMatchObject({ fingerprint: s.fp, lifted: false });
    expect(list.body.data.request).toBeNull();

    const noReason = await request(app)
      .post(base(s.incidentId))
      .set(auth('a'))
      .send({ ...TOTP });
    expect(noReason.status).toBe(400);
    const noStepUp = await request(app)
      .post(base(s.incidentId))
      .set(auth('a'))
      .send({ reason: 'x' });
    expect(noStepUp.status).toBe(400);

    const ok = await requestLift('a', s.incidentId);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({
      status: 'PENDING',
      reason: 'It was a drill',
      requestedBy: admins.a.email,
    });
    // Only one pending request per incident.
    expect((await requestLift('b', s.incidentId)).body.error.code).toBe('LIFT_ALREADY_PENDING');
    // Nothing is lifted yet.
    expect(await isFingerprintBlocked(s.fp)).toBe(true);
  });

  it('is refused for an incident that is not a false alarm or still suspends the site', async () => {
    const closed = await falseAlarm('lift-closed', 'CLOSED');
    const res = await requestLift('a', closed.incidentId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_FALSE_ALARM');

    // A false alarm that is still suspended (the suspension was not lifted).
    const site = await seedSite({ label: 'lift-susp' });
    sites.push(site);
    await approveLiveState(site);
    const incident = await incidents.reportIncident(
      { organizationId: site.orgId, title: 't', description: 'd', escalationLevel: 3 },
      caller('a'),
    );
    incidentIds.push(incident.id);
    await suspendIncident(incident.id, ['BLOCK_CERTIFICATES', 'WITHDRAW'], true, caller('a'));
    await db('incidents').where({ id: incident.id }).update({ status: 'FALSE_ALARM' });
    const suspended = await requestLift('a', incident.id);
    expect(suspended.status).toBe(409);
    expect(suspended.body.error.code).toBe('STILL_SUSPENDED');
  });

  it('is refused when the incident blocked nothing, and for an unknown incident', async () => {
    const site = await seedSite({ label: 'lift-none' });
    sites.push(site);
    const incident = await incidents.reportIncident(
      { organizationId: site.orgId, title: 't', description: 'd', escalationLevel: 1 },
      caller('a'),
    );
    incidentIds.push(incident.id);
    await incidents.closeIncident(incident.id, 'FALSE_ALARM', 'n', caller('a'));
    expect((await requestLift('a', incident.id)).body.error.code).toBe('NOTHING_TO_LIFT');
    expect((await requestLift('a', uuidv4())).status).toBe(404);
  });

  it('is only for admins', async () => {
    const s = await falseAlarm('lift-nonadmin');
    const plain = { Authorization: `Bearer ${getTestToken(s.site.email, s.site.userId)}` };
    const res = await request(app)
      .post(base(s.incidentId))
      .set(plain)
      .send({ ...TOTP, reason: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('confirming', () => {
  it('needs a second admin of another e-mail domain, and the first decision wins', async () => {
    const s = await falseAlarm('lift-rule');
    const created = await requestLift('a', s.incidentId);
    const rid = created.body.data.id as string;

    const own = await decide('a', s.incidentId, rid, 'confirm');
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('SELF_CONFIRM');
    const sameDomain = await decide('a2', s.incidentId, rid, 'confirm');
    expect(sameDomain.status).toBe(403);
    expect(sameDomain.body.error.code).toBe('SAME_SITE');
    expect(await isFingerprintBlocked(s.fp)).toBe(true);

    const ok = await decide('b', s.incidentId, rid, 'confirm');
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ lifted: 1, published: true });
    expect(ok.body.data.request).toMatchObject({ status: 'CONFIRMED', decidedBy: admins.b.email });

    const again = await decide('b', s.incidentId, rid, 'confirm');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LIFT_NOT_PENDING');
    expect((await decide('b', s.incidentId, uuidv4(), 'confirm')).status).toBe(404);
  });

  it('can be cancelled by the requester only, and a cancelled request cannot be confirmed', async () => {
    const s = await falseAlarm('lift-cancel');
    const rid = (await requestLift('a', s.incidentId)).body.data.id as string;
    const other = await decide('b', s.incidentId, rid, 'cancel');
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('NOT_REQUESTER');
    expect((await decide('a', s.incidentId, rid, 'cancel')).status).toBe(200);
    expect((await decide('b', s.incidentId, rid, 'confirm')).body.error.code).toBe(
      'LIFT_NOT_PENDING',
    );
    expect(await isFingerprintBlocked(s.fp)).toBe(true);
    // A new request is possible afterwards.
    expect((await requestLift('a', s.incidentId)).status).toBe(201);
  });
});

describe('a confirmed lift', () => {
  it('is respected by login, mTLS fetch, allow list, sync and the upload and admin guards', async () => {
    const s = await falseAlarm('lift-effect');
    const { site, fp } = s;

    // While blocked: no login, no fetch, not published, no sync, no upload, no admin certificate.
    expect(await resolveCertLogin(fp)).toBeNull();
    expect(
      (
        await request(app)
          .get(`/fhir/Bundle/${site.endpointIds[0]}`)
          .set(mtlsHeaders(site.certPem!))
      ).status,
    ).toBe(403);
    expect((await loadAllowListInput()).members.some((m) => m.identifier === site.orgId)).toBe(
      false,
    );
    expect(await syncLoginCertificatesFromApproval(s.requestId)).toEqual({
      added: [],
      removed: [],
    });
    await expect(
      createCertificate(site.instanceId, site.certPem!, site.email, '127.0.0.1', false),
    ).rejects.toThrow('CERT_BLOCKED');
    const now = new Date();
    const parsed = {
      fingerprint: fp,
      subject: 'CN=x',
      validFrom: new Date(now.getTime() - 60_000),
      validUntil: new Date(now.getTime() + 86_400_000),
      issuerDn: 'CN=x',
    };
    const blockedErr = await assertAcceptable(parsed, now).catch((e: unknown) => e);
    expect((blockedErr as AdminCertError).code).toBe('CERT_BLOCKED');

    const rid = (await requestLift('a', s.incidentId)).body.data.id as string;
    expect((await decide('b', s.incidentId, rid, 'confirm')).status).toBe(200);

    // After the lift everything follows at once.
    expect(await isFingerprintBlocked(fp)).toBe(false);
    expect(await resolveCertLogin(fp)).toMatchObject({ kind: 'org', instanceId: site.instanceId });
    expect(
      (
        await request(app)
          .get(`/fhir/Bundle/${site.endpointIds[0]}`)
          .set(mtlsHeaders(site.certPem!))
      ).status,
    ).toBe(200);
    expect((await loadAllowListInput()).members.some((m) => m.identifier === site.orgId)).toBe(
      true,
    );
    // The admin-certificate guard no longer says CERT_BLOCKED (it now refuses the certificate for
    // another reason: it is the site's login certificate again).
    const afterErr = await assertAcceptable(parsed, now).catch((e: unknown) => e);
    expect((afterErr as AdminCertError).code).not.toBe('CERT_BLOCKED');
    // The login entry came back through the sync (the site's own certificate).
    expect(
      await db('org_login_certificates').where({ fingerprint: fp, source: 'APPROVAL' }).first(),
    ).toBeTruthy();

    // The block row stays; the lift is a separate append-only record with both admins.
    expect(
      await db('blocked_certificate_thumbprints').where({ fingerprint: fp }).first(),
    ).toBeTruthy();
    const lift = await db('certificate_block_lifts').where({ fingerprint: fp }).first();
    expect(lift).toMatchObject({
      incident_id: s.incidentId,
      requested_by: admins.a.email,
      confirmed_by: admins.b.email,
      reason: 'It was a drill',
    });
    const list = await request(app).get(base(s.incidentId)).set(auth('a'));
    expect(list.body.data.blocks[0]).toMatchObject({
      fingerprint: fp,
      lifted: true,
      liftedBy: admins.b.email,
    });
    expect(list.body.data.request).toBeNull();
  });

  it('writes chained events and audit entries, and a later incident can block it again', async () => {
    const s = await falseAlarm('lift-events');
    const rid = (await requestLift('a', s.incidentId)).body.data.id as string;
    await decide('b', s.incidentId, rid, 'confirm');

    const events = await listEvents(s.incidentId);
    const types = events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['BLOCK_LIFT_REQUESTED', 'BLOCKS_LIFTED']));
    expect(types.indexOf('BLOCK_LIFT_REQUESTED')).toBeLessThan(types.indexOf('BLOCKS_LIFTED'));
    expect(verifyEvents(s.incidentId, events).valid).toBe(true);
    const lifted = events.find((e) => e.type === 'BLOCKS_LIFTED');
    expect(lifted?.details).toMatchObject({ requestId: rid, lifted: 1 });

    const audit = await db('audit_logs')
      .where({ resource_type: 'INCIDENT', resource_id: s.incidentId })
      .select('diff_json', 'user_email');
    const actions = audit.map((a) => a.diff_json.action);
    expect(actions).toEqual(
      expect.arrayContaining(['incident_block_lift_request', 'incident_block_lift_confirm']),
    );

    // A later incident blocks the lifted thumbprint again; the new block is effective.
    const second = await incidents.reportIncident(
      { organizationId: s.site.orgId, title: 'Again', description: 'd', escalationLevel: 1 },
      caller('a'),
    );
    incidentIds.push(second.id);
    expect(await isFingerprintBlocked(s.fp)).toBe(false);
    const added = await db.transaction((trx) =>
      blockFingerprints(trx, [s.fp], second.id, admins.a.email),
    );
    expect(added).toBe(1);
    expect(await isFingerprintBlocked(s.fp)).toBe(true);
    expect(await resolveCertLogin(s.fp)).toBeNull();
    // Blocking it once more for the same effective block adds nothing.
    expect(
      await db.transaction((trx) => blockFingerprints(trx, [s.fp], second.id, admins.a.email)),
    ).toBe(0);
  });
});
