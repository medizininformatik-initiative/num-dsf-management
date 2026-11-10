/**
 * incidents.service.test.ts – The incident register end to end on the real
 * test DB: a report is visible to admins and the reporter only, confirming
 * makes it visible to everyone, suspending blocks the site's thumbprints,
 * removes its logins, publishes it as withdrawn in a new allow-list version
 * and refuses the certificate everywhere; lifting needs the checklist and
 * keeps the thumbprints blocked; closing needs the lift first. Every step is
 * a hash-chained event.
 * Dependencies: db, helpers/allowListSites, incidents.service,
 *               incident-suspension.service, incident-events.service,
 *               fhir.service, certificate.service, auth.service, lib/adminGrants
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';
import { signGrant } from '../lib/adminGrants';
import { sha512FingerprintFromPem } from '../lib/certFingerprint';
import * as svc from '../services/incidents.service';
import { liftSuspension, suspendIncident } from '../services/incident-suspension.service';
import { listEvents, verifyEvents } from '../services/incident-events.service';
import { loadAllowListInput } from '../services/fhir.service';
import { createCertificate } from '../services/certificate.service';
import { resolveCertLogin } from '../services/auth.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `inc-admin-${sfx}@imi-test.example.de`;
let affected: Site;
let other: Site;
const incidentIds: string[] = [];

const admin = (): svc.IncidentCaller => ({
  email: adminEmail,
  isAdmin: true,
  instanceIds: [],
  ip: '127.0.0.1',
  scopeInstanceId: null,
});
const siteCaller = (site: Site): svc.IncidentCaller => ({
  email: site.email,
  isAdmin: false,
  instanceIds: [site.instanceId],
  ip: '127.0.0.1',
  scopeInstanceId: null,
});

beforeAll(async () => {
  const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db('admin_grants').insert({
    email: adminEmail,
    granted_at: grantedAt,
    granted_by_a: 'SYSTEM:test',
    granted_by_b: 'SYSTEM:test',
    signature_hex: signGrant(adminEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
  });
  affected = await seedSite({ label: 'inc-affected', loginCert: true });
  other = await seedSite({ label: 'inc-other' });
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
  await removeSites([affected, other]);
});

async function report(by: svc.IncidentCaller, level: 1 | 2 | 3 = 3) {
  const incident = await svc.reportIncident(
    {
      organizationId: affected.orgId,
      title: 'Compromised BPE',
      description: 'Secret details only for admins',
      escalationLevel: level,
    },
    by,
  );
  incidentIds.push(incident.id);
  return incident;
}

describe('incident register', () => {
  it('shows a report to admins and the reporter only, with the description', async () => {
    const incident = await report(siteCaller(other));
    expect(incident.status).toBe('REPORTED');
    expect(incident.description).toBe('Secret details only for admins');
    expect(incident.nis2.map((n) => n.stage)).toEqual([
      'EARLY_WARNING',
      'NOTIFICATION',
      'FINAL_REPORT',
    ]);

    const forAffected = await svc.listIncidents(siteCaller(affected));
    expect(forAffected.find((i) => i.id === incident.id)).toBeUndefined();
    await expect(svc.requireVisible(incident.id, siteCaller(affected))).rejects.toThrow(
      'INCIDENT_NOT_FOUND',
    );
    const forAdmin = await svc.listIncidents(admin());
    expect(forAdmin.find((i) => i.id === incident.id)?.description).toBe(
      'Secret details only for admins',
    );
  });

  it('makes a confirmed incident visible to everyone without the description and reporter', async () => {
    const incident = await report(admin());
    await svc.confirmIncident(incident.id, admin());
    const seen = (await svc.listIncidents(siteCaller(other))).find((i) => i.id === incident.id);
    expect(seen?.status).toBe('CONFIRMED');
    expect(seen?.description).toBeNull();
    expect(seen?.reportedBy).toBeNull();
    await expect(svc.confirmIncident(incident.id, admin())).rejects.toThrow('INVALID_STATUS');
  });

  it('suspends the site: blocks thumbprints, removes logins and publishes it as withdrawn', async () => {
    const incident = await report(admin());
    const loginFp = sha512FingerprintFromPem(affected.loginCertPem!);
    expect(await resolveCertLogin(loginFp)).not.toBeNull();

    await expect(suspendIncident(incident.id, ['WITHDRAW'], false, admin())).rejects.toThrow(
      'INVALID_STATUS',
    );
    const { incident: after, results } = await suspendIncident(
      incident.id,
      ['MAIL_SITES', 'WITHDRAW', 'REMOVE_LOGINS', 'BLOCK_CERTIFICATES'],
      true,
      admin(),
    );
    expect(after.status).toBe('CONFIRMED');
    expect(after.suspended).toBe(true);
    expect(results.map((r) => r.measure)).toEqual([
      'BLOCK_CERTIFICATES',
      'REMOVE_LOGINS',
      'WITHDRAW',
      'MAIL_SITES',
    ]);
    expect(results[0].blocked).toBe(2);
    expect(results[1].removedLogins).toBe(1);
    expect(typeof results[2].versionNumber).toBe('number');

    const input = await loadAllowListInput();
    expect(input.members.some((m) => m.identifier === affected.orgId)).toBe(false);
    expect(input.removed.some((r) => r.identifier === affected.orgId)).toBe(true);
    expect(input.members.some((m) => m.identifier === other.orgId)).toBe(true);

    expect(await resolveCertLogin(loginFp)).toBeNull();
    await expect(
      createCertificate(other.instanceId, affected.certPem!, other.email, '127.0.0.1', false),
    ).rejects.toThrow('CERT_BLOCKED');
    // Withdrawing again republishes (a retry after a failed publish).
    const again = await suspendIncident(incident.id, ['WITHDRAW'], false, admin());
    expect(again.results[0]).toMatchObject({ measure: 'WITHDRAW', alreadySuspended: true });
    await expect(svc.closeIncident(incident.id, 'CLOSED', 'review', admin())).rejects.toThrow(
      'STILL_SUSPENDED',
    );

    const lifted = await liftSuspension(
      incident.id,
      { causeFixed: true, fixTested: true, releasedByTechBoard: true, note: 'patched and tested' },
      admin(),
    );
    expect(lifted.suspended).toBe(false);
    // The old certificate stays blocked, so the site stays out until a new one is approved.
    const relisted = await loadAllowListInput();
    expect(relisted.members.some((m) => m.identifier === affected.orgId)).toBe(false);
    await expect(
      liftSuspension(
        incident.id,
        { causeFixed: true, fixTested: true, releasedByTechBoard: true, note: 'again' },
        admin(),
      ),
    ).rejects.toThrow('NOT_SUSPENDED');

    const closed = await svc.closeIncident(
      incident.id,
      'CLOSED',
      'Review: rotate keys yearly',
      admin(),
    );
    expect(closed.status).toBe('CLOSED');
    await expect(svc.closeIncident(incident.id, 'FALSE_ALARM', 'x', admin())).rejects.toThrow(
      'INVALID_STATUS',
    );

    const events = await listEvents(incident.id);
    expect(events.map((e) => e.type)).toEqual([
      'REPORTED',
      'CONFIRMED',
      'MEASURE',
      'MEASURE',
      'SUSPENDED',
      'MEASURE',
      'SUSPENDED',
      'SUSPENSION_LIFTED',
      'CLOSED',
    ]);
    expect(events.at(-1)?.details).toEqual({ reviewNote: 'Review: rotate keys yearly' });
    expect(verifyEvents(incident.id, events)).toEqual({ valid: true, brokenAt: null });
  });

  it('records BSI stages and DPO informed once, for the affected site or admins', async () => {
    const incident = await report(admin(), 2);
    await svc.confirmIncident(incident.id, admin());
    await expect(
      svc.acknowledgeNis2(incident.id, 'EARLY_WARNING', siteCaller(other)),
    ).rejects.toThrow('FORBIDDEN');
    const acked = await svc.acknowledgeNis2(incident.id, 'EARLY_WARNING', siteCaller(affected));
    expect(acked.nis2[0].reportedBy).toBe(affected.email);
    expect(acked.canAcknowledge).toBe(true);
    await expect(svc.acknowledgeNis2(incident.id, 'EARLY_WARNING', admin())).rejects.toThrow(
      'ALREADY_ACKNOWLEDGED',
    );
    const dpo = await svc.acknowledgeDpo(incident.id, admin());
    expect(dpo.dpoInformed?.by).toBe(adminEmail);
  });

  it('logs every admin field change and comment as a chained event', async () => {
    const incident = await report(admin(), 1);
    const detectedAt = new Date(Date.now() - 3_600_000).toISOString();
    const updated = await svc.updateIncident(
      incident.id,
      { escalationLevel: 2, detectedAt, zulipUrl: 'https://zulip.example.de/#narrow/topic/x' },
      admin(),
    );
    expect(updated.escalationLevel).toBe(2);
    expect(new Date(updated.detectedAt).toISOString()).toBe(detectedAt);
    await svc.commentIncident(incident.id, 'Called the site, BPE taken offline', admin());
    const closed = await svc.closeIncident(incident.id, 'FALSE_ALARM', 'Scanner noise', admin());
    expect(closed.status).toBe('FALSE_ALARM');
    const events = await listEvents(incident.id);
    expect(events.filter((e) => e.type === 'UPDATED').map((e) => e.details?.field)).toEqual([
      'escalationLevel',
      'detectedAt',
      'zulipUrl',
    ]);
    expect(events.at(-1)?.details).toEqual({ reason: 'Scanner noise' });
    expect(verifyEvents(incident.id, events).valid).toBe(true);
  });

  it('detects a tampered event in the stored chain', async () => {
    const incident = await report(admin(), 1);
    await svc.commentIncident(incident.id, 'first', admin());
    await svc.commentIncident(incident.id, 'second', admin());
    await db('incident_events')
      .where({ incident_id: incident.id, seq: 2 })
      .update({ details: JSON.stringify({ text: 'edited' }) });
    expect(verifyEvents(incident.id, await listEvents(incident.id))).toEqual({
      valid: false,
      brokenAt: 2,
    });
  });

  it('chains concurrent events without forking', async () => {
    const incident = await report(admin(), 1);
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => svc.commentIncident(incident.id, `c${i}`, admin())),
    );
    const events = await listEvents(incident.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(verifyEvents(incident.id, events).valid).toBe(true);
  });

  it('refuses suspending an incident without an affected site', async () => {
    const incident = await svc.reportIncident(
      { title: 'Unknown origin', description: 'n/a', escalationLevel: 2 },
      admin(),
    );
    incidentIds.push(incident.id);
    await expect(suspendIncident(incident.id, ['WITHDRAW'], true, admin())).rejects.toThrow(
      'NO_ORGANIZATION',
    );
  });

  it('refuses a report for an unknown organization', async () => {
    await expect(
      svc.reportIncident(
        {
          organizationId: `nope-${uuidv4()}.example.de`,
          title: 'x x x',
          description: 'y',
          escalationLevel: 1,
        },
        admin(),
      ),
    ).rejects.toThrow('ORGANIZATION_NOT_FOUND');
  });
});
