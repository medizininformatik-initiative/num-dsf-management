// Purpose: Integration tests for GET /api/v1/parent-organizations
// Dependencies: supertest, app, db connection, auth helper
//
// Self-contained unique fixtures so the suite is concurrency-safe; asserts only on its own
// parent identifiers plus the known Verbünde.

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';

type Option = { identifier: string; name: string; known: boolean; usedBy: number };

describe('Parent organizations API', () => {
  const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const userId = uuidv4();
  const email = `parents-${sfx}@example.de`;
  const instanceId = uuidv4();
  const orgId = `parents-${sfx}.example.de`;
  const endpointId = `ep-parents-${sfx}.example.de`;
  const hub = `hub-${sfx}.example.de`;
  const gone = `gone-${sfx}.example.de`;
  let token: string;

  function membership(parent: string, deleted: boolean) {
    return {
      id: uuidv4(),
      organization_id: orgId,
      parent_organization: parent,
      endpoint_id: endpointId,
      roles: JSON.stringify(['DIC']),
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: deleted ? new Date() : null,
    };
  }

  async function fetchList(): Promise<Option[]> {
    const res = await request(app)
      .get('/api/v1/parent-organizations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.data as Option[];
  }

  beforeAll(async () => {
    await db('email_whitelist')
      .insert({ id: uuidv4(), email, created_by: 'test', created_at: new Date() })
      .onConflict('email')
      .ignore();
    await db('users')
      .insert({ id: userId, email, totp_enabled: false, created_at: new Date() })
      .onConflict('email')
      .ignore();
    await db('instances').insert({
      id: instanceId,
      user_id: userId,
      label: 'Parents Route Test',
      created_at: new Date(),
    });
    await db('organizations').insert({
      identifier: orgId,
      instance_id: instanceId,
      name: 'Parents Route Org',
      active: true,
      email,
      address_line: 'Test Street 1',
      postal_code: '12345',
      city: 'Teststadt',
      country_code: 'DE',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('endpoints').insert({
      identifier: endpointId,
      organization_id: orgId,
      name: 'Parents Route FHIR',
      address: `https://${endpointId}/fhir`,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('memberships').insert([
      membership(hub, false),
      membership(hub, false),
      membership(gone, true),
    ]);
    token = getTestToken(email, userId);
  });

  afterAll(async () => {
    await db('memberships').where({ organization_id: orgId }).del();
    await db('endpoints').where({ organization_id: orgId }).del();
    await db('organizations').where({ identifier: orgId }).del();
    await db('instances').where({ id: instanceId }).del();
    await db('users').where({ id: userId }).del();
    await db('email_whitelist').where({ email }).del();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/parent-organizations');
    expect(res.status).toBe(401);
  });

  it('lists the known Verbünde and parents in use, known first', async () => {
    const list = await fetchList();

    const dktk = list.find((o) => o.identifier === 'dktk.dkfz.de');
    expect(dktk).toMatchObject({ known: true });
    expect(dktk!.name).not.toBe('dktk.dkfz.de');

    expect(list.find((o) => o.identifier === hub)).toEqual({
      identifier: hub,
      name: hub,
      known: false,
      usedBy: 2,
    });

    const firstUnknown = list.findIndex((o) => !o.known);
    expect(list.slice(firstUnknown).some((o) => o.known)).toBe(false);
  });

  it('excludes parents only used by deleted memberships', async () => {
    const list = await fetchList();
    expect(list.some((o) => o.identifier === gone)).toBe(false);
  });

  it('uses the stored organization name for a registered parent', async () => {
    await db('memberships').insert(membership(orgId, false));
    const list = await fetchList();
    expect(list.find((o) => o.identifier === orgId)?.name).toBe('Parents Route Org');
  });
});
