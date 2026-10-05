// Purpose: Integration tests for the filtered audit list, anomaly flags, scoping and export
// Dependencies: supertest, app, db/connection, auth helper, adminGrants, audit.service (spy)
//
// Own users/instances/rows per suite (concurrency-safe); tears everything down.
// Only enum values that exist before migration 027 are inserted directly.

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../app';
import { db } from '../../db/connection';
import { getTestToken } from '../helpers/auth';
import { signGrant } from '../../lib/adminGrants';
import * as auditService from '../../services/audit.service';
import { queryAuditForExport } from '../../services/auditQuery.service';

describe('Audit list filters, flags and export', () => {
  const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ownerId = uuidv4();
  const ownerEmail = `own-${sfx}@example.de`;
  const otherId = uuidv4();
  const otherEmail = `oth-${sfx}@example.de`;
  const adminId = uuidv4();
  const adminEmail = `adm-${sfx}@imi-test.example.de`;
  const instA = uuidv4();
  const instB = uuidv4();
  const base = Date.parse('2026-03-10T10:00:00Z');
  let ownerToken: string;
  let otherToken: string;
  let adminToken: string;
  const insertedIds: string[] = [];

  async function addRow(
    instanceId: string,
    over: Record<string, unknown>,
    offsetSec: number,
  ): Promise<string> {
    const id = uuidv4();
    insertedIds.push(id);
    await db('audit_logs').insert({
      id,
      timestamp: new Date(base + offsetSec * 1000),
      user_email: ownerEmail,
      instance_id: instanceId,
      resource_type: 'CONTACT',
      resource_id: uuidv4(),
      operation: 'UPDATE',
      diff_json: null,
      ip_address: '10.0.0.1',
      ...over,
    });
    return id;
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [ownerId, ownerEmail],
      [otherId, otherEmail],
      [adminId, adminEmail],
    ] as const) {
      await db('email_whitelist').insert({
        id: uuidv4(),
        email,
        created_by: 'test',
        created_at: new Date(),
      });
      await db('users').insert({ id, email, totp_enabled: false, created_at: new Date() });
    }
    const grantedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await db('admin_grants').insert({
      email: adminEmail,
      granted_at: grantedAt,
      granted_by_a: 'SYSTEM:test',
      granted_by_b: 'SYSTEM:test',
      signature_hex: signGrant(adminEmail, grantedAt, 'SYSTEM:test', 'SYSTEM:test'),
    });
    await db('instances').insert([
      { id: instA, user_id: ownerId, label: `a-${sfx}`, created_at: new Date() },
      { id: instB, user_id: otherId, label: `b-${sfx}`, created_at: new Date() },
    ]);

    // Instance A: 5 failed sign-ins within a minute (burst), a delete, a plain update.
    for (let i = 0; i < 5; i++) {
      await addRow(
        instA,
        { resource_type: 'AUTH', operation: 'FAILED_LOGIN', ip_address: '10.9.9.9' },
        i * 10,
      );
    }
    await addRow(instA, { operation: 'DELETE', user_email: `=cmd-${sfx}@example.de` }, 100);
    await addRow(
      instA,
      { operation: 'UPDATE', diff_json: JSON.stringify({ note: `needle-${sfx}` }) },
      200,
    );
    // Instance B: foreign data the owner must never see.
    await addRow(instB, { user_email: otherEmail, operation: 'CREATE' }, 300);

    ownerToken = getTestToken(ownerEmail, ownerId);
    otherToken = getTestToken(otherEmail, otherId);
    adminToken = getTestToken(adminEmail, adminId);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await db('audit_logs').whereIn('id', insertedIds).del();
    await db('audit_logs').whereIn('instance_id', [instA, instB]).del();
    await db('instances').whereIn('id', [instA, instB]).del();
    await db('admin_grants').where({ email: adminEmail }).del();
    await db('users').whereIn('id', [ownerId, otherId, adminId]).del();
    await db('email_whitelist').whereIn('email', [ownerEmail, otherEmail, adminEmail]).del();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const siteAudit = `/api/v1/instances/${instA}/audit`;

  describe('list', () => {
    it('returns flags per row and a severity summary for the current filter', async () => {
      const res = await request(app).get(siteAudit).set(auth(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(7);
      const failed = res.body.data.filter(
        (r: { operation: string }) => r.operation === 'FAILED_LOGIN',
      );
      expect(failed).toHaveLength(5);
      expect(failed[0].flags).toEqual([{ code: 'FAILED_AUTH_BURST', severity: 'warning' }]);
      expect(res.body.meta.summary).toMatchObject({ warning: 5, flagged: 5 });
    });

    it('flaggedOnly returns only flagged rows and a matching total', async () => {
      const res = await request(app)
        .get(siteAudit)
        .query({ flaggedOnly: 'true', limit: 2 })
        .set(auth(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(5);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((r: { flags: unknown[] }) => r.flags.length > 0)).toBe(true);
    });

    it('filters by actor, free text, time range and operation', async () => {
      const byActor = await request(app)
        .get(siteAudit)
        .query({ actor: `cmd-${sfx}` })
        .set(auth(ownerToken));
      expect(byActor.body.meta.total).toBe(1);

      const byText = await request(app)
        .get(siteAudit)
        .query({ q: `needle-${sfx}` })
        .set(auth(ownerToken));
      expect(byText.body.meta.total).toBe(1);
      expect(byText.body.data[0].operation).toBe('UPDATE');

      const byTime = await request(app)
        .get(siteAudit)
        .query({
          from: new Date(base + 90_000).toISOString(),
          to: new Date(base + 150_000).toISOString(),
        })
        .set(auth(ownerToken));
      expect(byTime.body.meta.total).toBe(1);
      expect(byTime.body.data[0].operation).toBe('DELETE');

      const byOp = await request(app)
        .get(siteAudit)
        .query({ operation: 'FAILED_LOGIN' })
        .set(auth(ownerToken));
      expect(byOp.body.meta.total).toBe(5);
    });

    it('treats LIKE wildcards in free text literally', async () => {
      const res = await request(app).get(siteAudit).query({ q: '%' }).set(auth(ownerToken));
      expect(res.body.meta.total).toBe(0);
    });

    it('rejects a malformed date with 400', async () => {
      const res = await request(app)
        .get(siteAudit)
        .query({ from: 'yesterday' })
        .set(auth(ownerToken));
      expect(res.status).toBe(400);
    });
  });

  describe('scoping', () => {
    it("a site user cannot read another site's audit log", async () => {
      const res = await request(app).get(siteAudit).set(auth(otherToken));
      expect(res.status).toBe(403);
      const exp = await request(app).get(`${siteAudit}/export`).set(auth(otherToken));
      expect(exp.status).toBe(403);
    });

    it('the cross-site list shows non-admins only their own sites', async () => {
      const res = await request(app).get('/api/v1/audit').set(auth(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body.meta.isAdmin).toBe(false);
      const ids = new Set(res.body.data.map((r: { instance_id: string }) => r.instance_id));
      expect(ids).toEqual(new Set([instA]));
    });

    it('a non-admin cannot widen the cross-site list with instanceId', async () => {
      const res = await request(app)
        .get('/api/v1/audit')
        .query({ instanceId: instB })
        .set(auth(ownerToken));
      expect(res.body.data).toHaveLength(0);
    });

    it('admins see every site and can filter by one', async () => {
      const all = await request(app)
        .get('/api/v1/audit')
        .query({ limit: 200 })
        .set(auth(adminToken));
      expect(all.body.meta.isAdmin).toBe(true);
      const instances = new Set(all.body.data.map((r: { instance_id: string }) => r.instance_id));
      expect(instances.has(instA) && instances.has(instB)).toBe(true);

      const one = await request(app)
        .get('/api/v1/audit')
        .query({ instanceId: instB })
        .set(auth(adminToken));
      expect(one.body.meta.total).toBe(1);
    });
  });

  describe('export', () => {
    it('exports the current filter as CSV with BOM, filename and formula guard', async () => {
      const spy = jest.spyOn(auditService, 'writeAuditLog');
      const res = await request(app)
        .get(`${siteAudit}/export`)
        .query({ format: 'csv', operation: 'DELETE' })
        .set(auth(ownerToken))
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (c) => (data += c));
          r.on('end', () => cb(null, data));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="audit-site-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      const body = res.body as unknown as string;
      expect(body.startsWith('\uFEFFtimestamp,site,')).toBe(true);
      const lines = body.trim().split('\r\n');
      expect(lines).toHaveLength(2); // header + the single DELETE row
      expect(lines[1]).toContain(`'=cmd-${sfx}@example.de`);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'AUDIT',
          operation: 'EXPORT',
          userEmail: ownerEmail,
          instanceId: instA,
          diffJson: expect.objectContaining({ format: 'csv', rows: 1 }),
        }),
      );
    });

    it('exports JSON with flags', async () => {
      const res = await request(app)
        .get(`${siteAudit}/export`)
        .query({ format: 'json', flaggedOnly: 'true' })
        .set(auth(ownerToken));
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/\.json"$/);
      expect(res.body).toHaveLength(5);
      expect(res.body[0].flags[0].code).toBe('FAILED_AUTH_BURST');
    });

    it('the all-sites export requires admin', async () => {
      const denied = await request(app).get('/api/v1/audit/export').set(auth(ownerToken));
      expect(denied.status).toBe(403);

      const ok = await request(app)
        .get('/api/v1/audit/export')
        .query({ format: 'json', instanceId: instB })
        .set(auth(adminToken));
      expect(ok.status).toBe(200);
      expect(ok.headers['content-disposition']).toMatch(/^attachment; filename="audit-all-/);
      expect(ok.body).toHaveLength(1);
    });

    it('requires authentication and a valid format', async () => {
      expect((await request(app).get(`${siteAudit}/export`)).status).toBe(401);
      const bad = await request(app)
        .get(`${siteAudit}/export`)
        .query({ format: 'xml' })
        .set(auth(ownerToken));
      expect(bad.status).toBe(400);
    });

    it('caps the number of exported rows and reports truncation', async () => {
      const capped = await queryAuditForExport({ kind: 'instance', instanceId: instA }, {}, 3);
      expect(capped.rows).toHaveLength(3);
      expect(capped.truncated).toBe(true);
      const full = await queryAuditForExport({ kind: 'instance', instanceId: instA }, {}, 50);
      expect(full.rows).toHaveLength(7);
      expect(full.truncated).toBe(false);
    });
  });
});
