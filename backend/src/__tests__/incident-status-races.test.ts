/**
 * incident-status-races.test.ts – Status checks of incident actions hold
 * under concurrency (re-checked on the locked row): an incident is confirmed
 * or closed once, a BSI stage or the DPO tick is recorded once, and a closed
 * incident takes no more ticks.
 * Dependencies: db, incidents.service, incident-events.service, lib/adminGrants
 */
import { db } from '../db/connection';
import { signGrant } from '../lib/adminGrants';
import * as svc from '../services/incidents.service';
import { listEvents } from '../services/incident-events.service';

const sfx = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const adminEmail = `inc-race-admin-${sfx}@imi-test.example.de`;
const incidentIds: string[] = [];

const admin = (): svc.IncidentCaller => ({
  email: adminEmail,
  isAdmin: true,
  instanceIds: [],
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
});

afterAll(async () => {
  if (incidentIds.length) {
    await db('incident_events').whereIn('incident_id', incidentIds).del();
    await db('incidents').whereIn('id', incidentIds).del();
  }
  await db('audit_logs').where({ user_email: adminEmail }).del();
  await db('admin_grants').where({ email: adminEmail }).del();
});

async function report(): Promise<string> {
  const incident = await svc.reportIncident(
    { title: 'Race', description: 'd', escalationLevel: 2 },
    admin(),
  );
  incidentIds.push(incident.id);
  return incident.id;
}

async function eventTypes(id: string): Promise<string[]> {
  return (await listEvents(id)).map((e) => e.type);
}

describe('incident status under concurrency', () => {
  it('confirms once', async () => {
    const id = await report();
    const outcomes = await Promise.allSettled([
      svc.confirmIncident(id, admin()),
      svc.confirmIncident(id, admin()),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect((await eventTypes(id)).filter((t) => t === 'CONFIRMED')).toHaveLength(1);
  });

  it('closes once', async () => {
    const id = await report();
    const outcomes = await Promise.allSettled([
      svc.closeIncident(id, 'CLOSED', 'review', admin()),
      svc.closeIncident(id, 'FALSE_ALARM', 'noise', admin()),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const types = await eventTypes(id);
    expect(types.filter((t) => t === 'CLOSED' || t === 'FALSE_ALARM')).toHaveLength(1);
  });

  it('records a BSI stage and the DPO tick once', async () => {
    const id = await report();
    const nis2 = await Promise.allSettled([
      svc.acknowledgeNis2(id, 'EARLY_WARNING', admin()),
      svc.acknowledgeNis2(id, 'EARLY_WARNING', admin()),
    ]);
    const dpo = await Promise.allSettled([
      svc.acknowledgeDpo(id, admin()),
      svc.acknowledgeDpo(id, admin()),
    ]);
    expect(nis2.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(dpo.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect((await eventTypes(id)).filter((t) => t === 'UPDATED')).toHaveLength(2);
  });

  it('takes no ticks on a closed incident', async () => {
    const id = await report();
    await svc.closeIncident(id, 'FALSE_ALARM', 'noise', admin());
    await expect(svc.acknowledgeNis2(id, 'NOTIFICATION', admin())).rejects.toThrow(
      'INVALID_STATUS',
    );
    await expect(svc.acknowledgeDpo(id, admin())).rejects.toThrow('INVALID_STATUS');
  });
});
