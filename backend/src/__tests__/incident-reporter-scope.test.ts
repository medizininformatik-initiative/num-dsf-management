/**
 * incident-reporter-scope.test.ts – Who counts as the reporter of an
 * incident. An organization certificate session carries the e-mail of the
 * instance owner, so the reporter is the e-mail AND the session scope: the
 * certificate session of a site owned by an admin does not inherit the
 * admin's own reports, and its own reports are shown as made through that
 * organization's certificate.
 * The affected site's own audit log never shows incident entries (an
 * unconfirmed report and its reporter stay with the admins).
 * Dependencies: db, helpers/allowListSites, incidents.service, auditQuery.service,
 *               lib/adminGrants
 */
import { db } from '../db/connection';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';
import { signGrant } from '../lib/adminGrants';
import * as svc from '../services/incidents.service';
import { queryAudit } from '../services/auditQuery.service';

let site: Site;
let ownerEmail: string;
const incidentIds: string[] = [];

/** The owner of the site as an admin, without a certificate scope. */
const owner = (): svc.IncidentCaller => ({
  email: ownerEmail,
  isAdmin: true,
  instanceIds: [],
  ip: '127.0.0.1',
  scopeInstanceId: null,
});
/** The same e-mail through the site's organization certificate. */
const scoped = (): svc.IncidentCaller => ({
  email: ownerEmail,
  isAdmin: false,
  instanceIds: [site.instanceId],
  ip: '127.0.0.1',
  scopeInstanceId: site.instanceId,
});

beforeAll(async () => {
  site = await seedSite({ label: 'inc-scope' });
  ownerEmail = site.email;
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: ownerEmail,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(ownerEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
});

afterAll(async () => {
  if (incidentIds.length) {
    await db('incident_events').whereIn('incident_id', incidentIds).del();
    await db('incidents').whereIn('id', incidentIds).del();
  }
  await db('audit_logs').where({ user_email: ownerEmail }).del();
  await db('admin_grants').where({ email: ownerEmail }).del();
  await removeSites([site]);
});

async function report(by: svc.IncidentCaller) {
  const incident = await svc.reportIncident(
    { title: 'Phishing wave', description: 'internal notes', escalationLevel: 1 },
    by,
  );
  incidentIds.push(incident.id);
  return incident;
}

describe('reporter scope', () => {
  it("does not show the admin's unconfirmed report to its certificate session", async () => {
    const incident = await report(owner());
    expect((await svc.listIncidents(scoped())).some((i) => i.id === incident.id)).toBe(false);
    await expect(svc.requireVisible(incident.id, scoped())).rejects.toThrow('INCIDENT_NOT_FOUND');
  });

  it("hides the description of the admin's confirmed report and refuses ticks", async () => {
    const incident = await report(owner());
    await svc.confirmIncident(incident.id, owner());
    const seen = (await svc.listIncidents(scoped())).find((i) => i.id === incident.id);
    expect(seen?.description).toBeNull();
    expect(seen?.isMine).toBe(false);
    await expect(svc.acknowledgeDpo(incident.id, scoped())).rejects.toThrow('FORBIDDEN');
  });

  it('keeps a certificate-session report to that session and names the organization', async () => {
    const incident = await report(scoped());
    expect(incident.isMine).toBe(true);
    expect(incident.description).toBe('internal notes');
    expect(incident.reportedByOrganization).toBe(site.orgId);
    const forOwner = (await svc.listIncidents(owner())).find((i) => i.id === incident.id);
    expect(forOwner?.isMine).toBe(false);
    expect(forOwner?.reportedBy).toBe(ownerEmail);
    expect(forOwner?.reportedByOrganization).toBe(site.orgId);
  });
});

describe('audit entries of incidents', () => {
  it("stay out of the affected site's instance and user audit views", async () => {
    const incident = await svc.reportIncident(
      { organizationId: site.orgId, title: 'Suspicious', description: 'd', escalationLevel: 1 },
      owner(),
    );
    incidentIds.push(incident.id);
    const params = { page: 1, limit: 100, resource: 'INCIDENT' };
    const byInstance = await queryAudit({ kind: 'instance', instanceId: site.instanceId }, params);
    const byUser = await queryAudit({ kind: 'user', userId: site.userId }, params);
    expect(byInstance.rows.some((r) => r.resource_id === incident.id)).toBe(false);
    expect(byUser.rows.some((r) => r.resource_id === incident.id)).toBe(false);
    const all = await queryAudit({ kind: 'all' }, params);
    const entry = all.rows.find((r) => r.resource_id === incident.id);
    expect(entry?.instance_id).toBeNull();
  });
});
