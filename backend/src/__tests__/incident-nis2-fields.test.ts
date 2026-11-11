/**
 * incident-nis2-fields.test.ts – The structured NIS2 report fields of an
 * incident on the real test DB: saved as a draft per stage, required in full
 * before a stage can be ticked, visible and editable for admins, the reporter
 * and the affected site only, locked once the stage is ticked, and covered by
 * the hash chain (events and audit entries name fields, never carry texts).
 * Dependencies: db, helpers/allowListSites, helpers/nis2Fields, incidents.service,
 *               incident-nis2.service, incident-events.service, auditQuery.service
 */
import { db } from '../db/connection';
import { removeSites, seedSite, type Site } from './helpers/allowListSites';
import { VALID_FIELDS } from './helpers/nis2Fields';
import { signGrant } from '../lib/adminGrants';
import { Nis2FieldsIncompleteError } from '../lib/incidentErrors';
import * as svc from '../services/incidents.service';
import { updateNis2Fields } from '../services/incident-nis2.service';
import { listEvents, verifyEvents } from '../services/incident-events.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `nis2f-admin-${sfx}@imi-test.example.de`;
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
  affected = await seedSite({ label: 'nis2f-affected' });
  other = await seedSite({ label: 'nis2f-other' });
});

afterAll(async () => {
  if (incidentIds.length) {
    await db('incident_events').whereIn('incident_id', incidentIds).del();
    await db('incidents').whereIn('id', incidentIds).del();
  }
  await db('audit_logs').where({ user_email: adminEmail }).del();
  await db('audit_logs').where({ user_email: affected.email }).del();
  await db('admin_grants').where({ email: adminEmail }).del();
  await removeSites([affected, other]);
});

async function confirmed() {
  const incident = await svc.reportIncident(
    {
      organizationId: affected.orgId,
      title: 'NIS2 fields',
      description: 'details',
      escalationLevel: 2,
    },
    admin(),
  );
  incidentIds.push(incident.id);
  await svc.confirmIncident(incident.id, admin());
  return incident;
}

const entry = (i: svc.ApiIncident, stage: string) => i.nis2.find((n) => n.stage === stage)!;

describe('NIS2 report fields', () => {
  it('saves a draft per stage and requires the complete set before the tick', async () => {
    const incident = await confirmed();
    expect(entry(incident, 'EARLY_WARNING').fields).toEqual({});
    const draft = await updateNis2Fields(
      incident.id,
      'EARLY_WARNING',
      { suspectedMalicious: 'yes' },
      siteCaller(affected),
    );
    expect(entry(draft, 'EARLY_WARNING').fields).toEqual({ suspectedMalicious: 'yes' });

    const err = await svc
      .acknowledgeNis2(incident.id, 'EARLY_WARNING', siteCaller(affected))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Nis2FieldsIncompleteError);
    expect((err as Nis2FieldsIncompleteError).missing).toEqual(['crossBorder', 'affectedServices']);

    await updateNis2Fields(
      incident.id,
      'EARLY_WARNING',
      { crossBorder: 'unknown', affectedServices: 'BPE' },
      siteCaller(affected),
    );
    const ticked = await svc.acknowledgeNis2(incident.id, 'EARLY_WARNING', siteCaller(affected));
    expect(entry(ticked, 'EARLY_WARNING').reportedAt).not.toBeNull();
    expect(entry(ticked, 'EARLY_WARNING').fields).toEqual({
      suspectedMalicious: 'yes',
      crossBorder: 'unknown',
      affectedServices: 'BPE',
    });
  });

  it('keeps the indicators of compromise optional and clears a field with an empty text', async () => {
    const incident = await confirmed();
    const saved = await updateNis2Fields(
      incident.id,
      'NOTIFICATION',
      { severity: 'critical', impact: 'Endpoint offline', iocs: '1.2.3.4' },
      admin(),
    );
    expect(entry(saved, 'NOTIFICATION').fields).toMatchObject({ iocs: '1.2.3.4' });
    const cleared = await updateNis2Fields(incident.id, 'NOTIFICATION', { iocs: '' }, admin());
    expect(entry(cleared, 'NOTIFICATION').fields).toEqual({
      severity: 'critical',
      impact: 'Endpoint offline',
    });
    const ticked = await svc.acknowledgeNis2(incident.id, 'NOTIFICATION', admin());
    expect(entry(ticked, 'NOTIFICATION').reportedAt).not.toBeNull();
  });

  it('shows the fields and takes edits from admins, the reporter and the affected site only', async () => {
    const incident = await confirmed();
    await updateNis2Fields(incident.id, 'NOTIFICATION', VALID_FIELDS.NOTIFICATION!, admin());
    await expect(
      updateNis2Fields(incident.id, 'NOTIFICATION', { impact: 'x' }, siteCaller(other)),
    ).rejects.toThrow('FORBIDDEN');
    const seenByOther = (await svc.listIncidents(siteCaller(other))).find(
      (i) => i.id === incident.id,
    )!;
    expect(entry(seenByOther, 'NOTIFICATION').fields).toBeNull();
    const seenByAffected = (await svc.listIncidents(siteCaller(affected))).find(
      (i) => i.id === incident.id,
    )!;
    expect(entry(seenByAffected, 'NOTIFICATION').fields).toMatchObject({ severity: 'high' });
  });

  it('puts the field names, never the texts, into the event and the audit entry', async () => {
    const incident = await confirmed();
    await updateNis2Fields(
      incident.id,
      'NOTIFICATION',
      { severity: 'low', impact: 'SECRET-IMPACT-TEXT' },
      admin(),
    );
    const events = await listEvents(incident.id);
    const last = events.at(-1)!;
    expect(last.type).toBe('UPDATED');
    expect(last.details).toMatchObject({
      field: 'nis2Fields',
      stage: 'NOTIFICATION',
      changed: ['impact', 'severity'],
    });
    expect(JSON.stringify(last.details)).not.toContain('SECRET-IMPACT-TEXT');
    expect(
      (last.details as { fieldSha256: Record<string, string> }).fieldSha256.nis2Notification,
    ).toMatch(/^[0-9a-f]{64}$/);
    const audit = await db('audit_logs')
      .where({ resource_id: incident.id, user_email: adminEmail })
      .orderBy('timestamp', 'desc');
    expect(JSON.stringify(audit)).toContain('incident_nis2_fields');
    expect(JSON.stringify(audit)).not.toContain('SECRET-IMPACT-TEXT');
  });

  it('writes no event for an unchanged save', async () => {
    const incident = await confirmed();
    await updateNis2Fields(incident.id, 'NOTIFICATION', { severity: 'low' }, admin());
    const before = (await listEvents(incident.id)).length;
    await updateNis2Fields(incident.id, 'NOTIFICATION', { severity: 'low' }, admin());
    expect((await listEvents(incident.id)).length).toBe(before);
  });

  it('detects report fields changed outside the timeline', async () => {
    const incident = await confirmed();
    await updateNis2Fields(incident.id, 'NOTIFICATION', VALID_FIELDS.NOTIFICATION!, admin());
    const row = (await svc.loadIncidentRow(incident.id))!;
    expect(
      verifyEvents(incident.id, await listEvents(incident.id), svc.hashedFieldsOf(row)),
    ).toEqual({ valid: true, brokenAt: null, tamperedFields: [] });
    await db('incidents')
      .where({ id: incident.id })
      .update({
        nis2_data: JSON.stringify({ notification: { severity: 'low', impact: 'edited' } }),
      });
    const tampered = (await svc.loadIncidentRow(incident.id))!;
    expect(
      verifyEvents(incident.id, await listEvents(incident.id), svc.hashedFieldsOf(tampered))
        .tamperedFields,
    ).toEqual(['nis2Notification']);
  });

  it('locks the fields of a ticked stage and rejects stages without fields', async () => {
    const incident = await confirmed();
    await updateNis2Fields(incident.id, 'NOTIFICATION', VALID_FIELDS.NOTIFICATION!, admin());
    await svc.acknowledgeNis2(incident.id, 'NOTIFICATION', admin());
    await expect(
      updateNis2Fields(incident.id, 'NOTIFICATION', { impact: 'changed' }, admin()),
    ).rejects.toThrow('ALREADY_ACKNOWLEDGED');
    await expect(updateNis2Fields(incident.id, 'INTERIM_REPORT', {}, admin())).rejects.toThrow(
      'NIS2_STAGE_WITHOUT_FIELDS',
    );
  });

  it('shares the final report fields with the progress report and refuses a false alarm', async () => {
    const incident = await confirmed();
    await updateNis2Fields(incident.id, 'PROGRESS_REPORT', { rootCause: 'Phishing' }, admin());
    const saved = await updateNis2Fields(
      incident.id,
      'FINAL_REPORT',
      { mitigation: 'Reset', crossBorderFinal: 'no' },
      admin(),
    );
    expect(entry(saved, 'FINAL_REPORT').fields).toEqual({
      rootCause: 'Phishing',
      mitigation: 'Reset',
      crossBorderFinal: 'no',
    });
    const alarm = await confirmed();
    await svc.closeIncident(alarm.id, 'FALSE_ALARM', 'noise', admin());
    await expect(
      updateNis2Fields(alarm.id, 'EARLY_WARNING', { crossBorder: 'no' }, admin()),
    ).rejects.toThrow('INVALID_STATUS');
  });
});
