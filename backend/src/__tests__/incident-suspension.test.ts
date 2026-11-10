/**
 * incident-suspension.test.ts – Suspension measures against data that is
 * not (or no longer) in the live certificate list: a certificate deleted
 * before the suspension but still in the approved or a pending snapshot is
 * blocked too, so lifting the suspension does not republish it and it cannot
 * be uploaded again. Publishing: blocking alone publishes a new version too;
 * the suspension flag, its event and the published version succeed or fail
 * together, and a retry republishes. Removing logins ends the sessions of
 * the site's organization scope also for an admin owner.
 * Dependencies: db, helpers/allowListSites, incidents.service,
 *               incident-suspension.service, fhir.service, certificate.service,
 *               lib/adminGrants, lib/certFingerprint
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { makeCertPem, removeSites, seedSite, type Site } from './helpers/allowListSites';
import { signGrant } from '../lib/adminGrants';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import * as svc from '../services/incidents.service';
import { liftSuspension, suspendIncident } from '../services/incident-suspension.service';
import { listEvents } from '../services/incident-events.service';
import { loadAllowListInput } from '../services/fhir.service';
import { createCertificate } from '../services/certificate.service';
import { AdminCertError, assertAcceptable } from '../services/admin-certificates.service';
import * as bundleVersions from '../services/bundle-versions.service';
import { parseAllowListInput } from '../lib/allowListInput';
import { redis, setRefreshToken } from '../services/redis.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `inc-susp-admin-${sfx}@imi-test.example.de`;
const sites: Site[] = [];
const incidentIds: string[] = [];
const adminCertIds: string[] = [];

const admin = (): svc.IncidentCaller => ({
  email: adminEmail,
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
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: adminEmail,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(adminEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
});

afterAll(async () => {
  if (incidentIds.length) {
    await db('incident_events').whereIn('incident_id', incidentIds).del();
    await db('blocked_certificate_thumbprints').whereIn('incident_id', incidentIds).del();
    await db('incidents').whereIn('id', incidentIds).del();
  }
  await db('bundle_versions').where({ triggered_by_email: adminEmail }).del();
  await db('audit_logs').where({ user_email: adminEmail }).del();
  await db('admin_grants').where({ email: adminEmail }).del();
  if (adminCertIds.length) await db('admin_cert_fingerprints').whereIn('id', adminCertIds).del();
  await removeSites(sites);
});

async function seed(label: string): Promise<Site> {
  const site = await seedSite({ label });
  sites.push(site);
  return site;
}

/** Store the site's current live member as the allowList section of its approved snapshot. */
async function approveLiveState(site: Site): Promise<void> {
  const member = (await loadAllowListInput()).members.find((m) => m.identifier === site.orgId);
  if (!member) throw new Error('site not published');
  await db('approval_requests')
    .where({ instance_id: site.instanceId, status: 'APPROVED' })
    .update({ snapshot_json: JSON.stringify({ allowList: { version: 1, active: true, member } }) });
}

async function reportFor(site: Site): Promise<string> {
  const incident = await svc.reportIncident(
    { organizationId: site.orgId, title: 'Key leaked', description: 'd', escalationLevel: 3 },
    admin(),
  );
  incidentIds.push(incident.id);
  return incident.id;
}

describe('blocking certificates that only snapshots still hold', () => {
  it('blocks a certificate deleted before the suspension but still approved', async () => {
    const site = await seed('inc-del-approved');
    await approveLiveState(site);
    await db('certificates').where({ organization_id: site.orgId }).del();
    const id = await reportFor(site);

    await suspendIncident(id, ['BLOCK_CERTIFICATES', 'WITHDRAW'], true, admin());
    await liftSuspension(id, checklist, admin());

    const input = await loadAllowListInput();
    expect(input.members.some((m) => m.identifier === site.orgId)).toBe(false);
    expect(input.removed.some((r) => r.identifier === site.orgId)).toBe(true);
    await expect(
      createCertificate(site.instanceId, site.certPem!, site.email, '127.0.0.1', false),
    ).rejects.toThrow('CERT_BLOCKED');
  });

  it('blocks the thumbprints of a pending request', async () => {
    const site = await seed('inc-del-pending');
    const pendingPem = makeCertPem(`pending.${site.orgId}`);
    const member = {
      identifier: site.orgId,
      name: site.name,
      thumbprints: [sha512FingerprintFromPem(pendingPem)],
      endpoints: [],
      affiliations: [],
      removedAffiliations: [],
    };
    await db('approval_requests').insert({
      id: uuidv4(),
      instance_id: site.instanceId,
      status: 'PENDING',
      created_at: new Date(Date.now() + 1000),
      submitted_at: new Date(),
      snapshot_json: JSON.stringify({ allowList: { version: 1, active: true, member } }),
    });
    const id = await reportFor(site);

    await suspendIncident(id, ['BLOCK_CERTIFICATES'], true, admin());

    await expect(
      createCertificate(site.instanceId, pendingPem, site.email, '127.0.0.1', false),
    ).rejects.toThrow('CERT_BLOCKED');
  });
});

describe('admin certificates and incident blocks', () => {
  it('does not block an admin certificate the suspended site also holds', async () => {
    const site = await seed('inc-admin-cert');
    const fp = sha512FingerprintFromPem(site.certPem!);
    const certId = uuidv4();
    adminCertIds.push(certId);
    await db('admin_cert_fingerprints').insert({
      id: certId,
      email: adminEmail,
      fingerprint: fp,
      created_by: 'test',
      created_at: new Date(),
    });
    const id = await reportFor(site);

    const { results } = await suspendIncident(id, ['BLOCK_CERTIFICATES'], true, admin());

    expect(results[0].blocked).toBe(0);
    expect(await db('blocked_certificate_thumbprints').where({ fingerprint: fp }).first()).toBe(
      undefined,
    );
  });

  it('refuses a blocked thumbprint as a new admin certificate', async () => {
    const site = await seed('inc-admin-blocked');
    const id = await reportFor(site);
    await suspendIncident(id, ['BLOCK_CERTIFICATES'], true, admin());
    const now = new Date();
    const err = await assertAcceptable(
      {
        fingerprint: sha512FingerprintFromPem(site.certPem!),
        subject: 'CN=x',
        validFrom: new Date(now.getTime() - 60_000),
        validUntil: new Date(now.getTime() + 86_400_000),
        issuerDn: 'CN=x',
      },
      now,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminCertError);
    expect((err as AdminCertError).code).toBe('CERT_BLOCKED');
  });
});

async function publishedInput(versionNumber: unknown) {
  const row = await db('bundle_versions')
    .where({ version_number: Number(versionNumber) })
    .first('input_json');
  return parseAllowListInput(row.input_json);
}

describe('publishing suspension measures', () => {
  afterEach(() => jest.restoreAllMocks());

  it('publishes a new version when only certificates are blocked', async () => {
    const site = await seed('inc-block-only');
    const id = await reportFor(site);
    const { results } = await suspendIncident(id, ['BLOCK_CERTIFICATES'], true, admin());
    const published = results.find((r) => typeof r.versionNumber === 'number');
    expect(published).toBeDefined();
    const input = await publishedInput(published!.versionNumber);
    expect(input.members.some((m) => m.identifier === site.orgId)).toBe(false);
    expect(input.removed.some((r) => r.identifier === site.orgId)).toBe(true);
  });

  it('leaves the site unsuspended when publishing fails, and a retry suspends it', async () => {
    const site = await seed('inc-publish-fail');
    const id = await reportFor(site);
    jest.spyOn(bundleVersions, 'createSnapshot').mockRejectedValueOnce(new Error('disk full'));
    await expect(suspendIncident(id, ['WITHDRAW'], true, admin())).rejects.toThrow('disk full');
    expect((await svc.loadIncidentRow(id))?.suspended).toBeFalsy();

    const { incident, results } = await suspendIncident(id, ['WITHDRAW'], false, admin());
    expect(incident.suspended).toBe(true);
    expect(typeof results[0].versionNumber).toBe('number');
  });

  it('republishes when an already suspended site is withdrawn again', async () => {
    const site = await seed('inc-republish');
    const id = await reportFor(site);
    await suspendIncident(id, ['WITHDRAW'], true, admin());
    const { results } = await suspendIncident(id, ['WITHDRAW'], false, admin());
    expect(results[0]).toMatchObject({ measure: 'WITHDRAW', alreadySuspended: true });
    const input = await publishedInput(results[0].versionNumber);
    expect(input.removed.some((r) => r.identifier === site.orgId)).toBe(true);
  });

  it('keeps the suspension when publishing the lift fails, and a retry lifts it', async () => {
    const site = await seed('inc-lift-fail');
    const id = await reportFor(site);
    await suspendIncident(id, ['WITHDRAW'], true, admin());
    jest.spyOn(bundleVersions, 'createSnapshot').mockRejectedValueOnce(new Error('disk full'));
    await expect(liftSuspension(id, checklist, admin())).rejects.toThrow('disk full');
    expect((await svc.loadIncidentRow(id))?.suspended).toBeTruthy();

    const lifted = await liftSuspension(id, checklist, admin());
    expect(lifted.suspended).toBe(false);
    const events = await listEvents(id);
    const last = events.at(-1);
    expect(last?.type).toBe('SUSPENSION_LIFTED');
    const input = await publishedInput(last?.details?.versionNumber);
    expect(input.members.some((m) => m.identifier === site.orgId)).toBe(true);
  });
});

describe('removing the logins of a site', () => {
  async function tokens(site: Site) {
    const scoped = uuidv4();
    const personal = uuidv4();
    await setRefreshToken(scoped, site.userId, 600, site.instanceId);
    await setRefreshToken(personal, site.userId, 600);
    return { scoped, personal };
  }
  const alive = async (hash: string) => (await redis.get(`refresh:${hash}`)) !== null;

  afterAll(async () => {
    for (const site of sites) await redis.del(`scope-revoked:${site.instanceId}`);
  });

  it("ends the organization scope of an admin owner but keeps the admin's own sessions", async () => {
    const site = await seed('inc-admin-owner');
    const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await db('admin_grants').insert({
      email: site.email,
      granted_at: grantedAt,
      granted_by_a: 'SYSTEM:test',
      granted_by_b: 'SYSTEM:test',
      signature_hex: signGrant(site.email, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
    });
    try {
      const { scoped, personal } = await tokens(site);
      const id = await reportFor(site);
      const { results } = await suspendIncident(id, ['REMOVE_LOGINS'], true, admin());
      expect(results[0]).toMatchObject({ scopedSessionsRevoked: 1, sessionsRevoked: 0 });
      expect(await alive(scoped)).toBe(false);
      expect(await alive(personal)).toBe(true);
      await redis.del(`refresh:${personal}`);
    } finally {
      await db('admin_grants').where({ email: site.email }).del();
    }
  });

  it('ends every session of a non-admin owner', async () => {
    const site = await seed('inc-user-owner');
    const { scoped, personal } = await tokens(site);
    const id = await reportFor(site);
    const { results } = await suspendIncident(id, ['REMOVE_LOGINS'], true, admin());
    expect(results[0]).toMatchObject({ scopedSessionsRevoked: 1, sessionsRevoked: 1 });
    expect(await alive(scoped)).toBe(false);
    expect(await alive(personal)).toBe(false);
  });
});
