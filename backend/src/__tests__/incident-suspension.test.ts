/**
 * incident-suspension.test.ts – Suspension measures against data that is
 * not (or no longer) in the live certificate list: a certificate deleted
 * before the suspension but still in the approved or a pending snapshot is
 * blocked too, so lifting the suspension does not republish it and it cannot
 * be uploaded again.
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
import { loadAllowListInput } from '../services/fhir.service';
import { createCertificate } from '../services/certificate.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `inc-susp-admin-${sfx}@imi-test.example.de`;
const sites: Site[] = [];
const incidentIds: string[] = [];

const admin = (): svc.IncidentCaller => ({
  email: adminEmail,
  isAdmin: true,
  instanceIds: [],
  ip: '127.0.0.1',
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
