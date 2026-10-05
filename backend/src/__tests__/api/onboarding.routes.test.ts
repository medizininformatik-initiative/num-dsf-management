/**
 * onboarding.routes.test.ts – Integration tests for
 * POST /api/v1/admin/onboarding/import.
 * Covers: the auth/admin guard (401/403), a successful CSV import (200,
 * created summary), the PEM-content rejection (400 PEM_NOT_ALLOWED), and
 * the oversized-body rejection (413 FILE_TOO_LARGE).
 * Dependencies: supertest, app, db, seed helpers, auth helper
 */
import request from 'supertest';
import { app } from '../../app';
import { db } from '../../db/connection';
import { cleanTestData, seedTestUser, seedAdminUser } from '../helpers/seed';
import { getTestToken } from '../helpers/auth';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { XLSX_CONTENT_TYPE } from '../../services/onboarding.service';

const FP_A = 'a'.repeat(128);
const FP_B = 'b'.repeat(128);
const HEADER = 'organizationIdentifier,organizationName,contactEmail,clientCertFingerprint';

function csvOf(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

let adminEmail: string;
let adminUserId: string;
let nonAdminEmail: string;
let nonAdminUserId: string;

const identifiers: string[] = [];
const emails: string[] = [];

beforeEach(async () => {
  await cleanTestData();
  const nonAdmin = await seedTestUser();
  nonAdminEmail = nonAdmin.email;
  nonAdminUserId = nonAdmin.userId;
  const admin = await seedAdminUser();
  adminEmail = admin.email;
  adminUserId = admin.userId;
});

afterEach(async () => {
  if (identifiers.length) {
    await db('audit_logs')
      .where({ resource_type: 'ORGANIZATION' })
      .whereIn('resource_id', identifiers)
      .del();
  }
  if (emails.length) {
    // users → instances → organizations all cascade on delete.
    await db('users').whereIn('email', emails).del();
    await db('email_whitelist').whereIn('email', emails).del();
  }
  identifiers.length = 0;
  emails.length = 0;
});

describe('POST /api/v1/admin/onboarding/import', () => {
  it('returns 401 with no auth token', async () => {
    const res = await request(app)
      .post('/api/v1/admin/onboarding/import')
      .set('Content-Type', 'text/csv')
      .send(csvOf([`ukm.de,Uniklinikum Muenster,admin@ukm.de,${FP_A}`]));

    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin token', async () => {
    const token = getTestToken(nonAdminEmail, nonAdminUserId);

    const res = await request(app)
      .post('/api/v1/admin/onboarding/import')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/csv')
      .send(csvOf([`ukm.de,Uniklinikum Muenster,admin@ukm.de,${FP_A}`]));

    expect(res.status).toBe(403);
  });

  it('admin + valid CSV (2 good rows) → 200 with created summary', async () => {
    const token = getTestToken(adminEmail, adminUserId);
    const idA = `import-route-a-${uuidv4().slice(0, 8)}.example.de`;
    const idB = `import-route-b-${uuidv4().slice(0, 8)}.example.de`;
    const emailA = `import-route-a-${uuidv4().slice(0, 8)}@example.de`;
    const emailB = `import-route-b-${uuidv4().slice(0, 8)}@example.de`;
    identifiers.push(idA, idB);
    emails.push(emailA, emailB);

    const csv = csvOf([
      `${idA},Import Route Org A,${emailA},${FP_A}`,
      `${idB},Import Route Org B,${emailB},${FP_B}`,
    ]);

    const res = await request(app)
      .post('/api/v1/admin/onboarding/import')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/csv')
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ created: 2, updated: 0, failed: 0 });
    expect(res.body.data.parseErrors).toEqual([]);
    expect(res.body.data.rows).toHaveLength(2);
  });

  it('admin + valid JSON array body (Content-Type: application/json) → 200 with created summary', async () => {
    const token = getTestToken(adminEmail, adminUserId);
    const idA = `import-json-a-${uuidv4().slice(0, 8)}.example.de`;
    const idB = `import-json-b-${uuidv4().slice(0, 8)}.example.de`;
    const emailA = `import-json-a-${uuidv4().slice(0, 8)}@example.de`;
    const emailB = `import-json-b-${uuidv4().slice(0, 8)}@example.de`;
    identifiers.push(idA, idB);
    emails.push(emailA, emailB);

    const rows = [
      {
        organizationIdentifier: idA,
        organizationName: 'Import JSON Org A',
        contactEmail: emailA,
        clientCertFingerprint: FP_A,
      },
      {
        organizationIdentifier: idB,
        organizationName: 'Import JSON Org B',
        contactEmail: emailB,
        clientCertFingerprint: FP_B,
      },
    ];

    const res = await request(app)
      .post('/api/v1/admin/onboarding/import')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(rows);

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ created: 2, updated: 0, failed: 0 });
    expect(res.body.data.parseErrors).toEqual([]);
    expect(res.body.data.rows).toHaveLength(2);

    const orgA = await db('organizations').where({ identifier: idA }).first();
    const orgB = await db('organizations').where({ identifier: idB }).first();
    expect(orgA.client_cert_fingerprint).toBe(FP_A);
    expect(orgB.client_cert_fingerprint).toBe(FP_B);
  });

  it('returns 400 PEM_NOT_ALLOWED when the body contains a PEM header', async () => {
    const token = getTestToken(adminEmail, adminUserId);
    // Header split across concatenation so the secret scanner does not flag
    // this deliberately-fake fixture (matches onboarding.service.test.ts).
    const pemLike = '-----BEGIN' + ' PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';

    const res = await request(app)
      .post('/api/v1/admin/onboarding/import')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(pemLike);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PEM_NOT_ALLOWED');
  });

  it('returns 413 FILE_TOO_LARGE for a body over 1 MB', async () => {
    const token = getTestToken(adminEmail, adminUserId);
    // 1,000,001 bytes: over onboarding.service's 1,000,000-byte cap but under
    // express.raw's own 1mb (1,048,576-byte) limit, so this exercises OUR
    // FILE_TOO_LARGE → 413 mapping rather than the raw body-parser's limit.
    const big = Buffer.alloc(1_000_001, 'a');

    const res = await request(app)
      .post('/api/v1/admin/onboarding/import')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/csv')
      .send(big);

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  describe('templates', () => {
    it('serves the CSV template to an admin and 403 to others', async () => {
      const token = getTestToken(adminEmail, adminUserId);
      const ok = await request(app)
        .get('/api/v1/admin/onboarding/template.csv')
        .set('Authorization', `Bearer ${token}`);
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toMatch(/text\/csv/);
      expect(ok.headers['content-disposition']).toMatch(/dsf-onboarding-template\.csv/);
      expect(ok.text.split(/\r?\n/)[0]).toBe(
        'organizationIdentifier,organizationName,contactEmail,clientCertFingerprint,city,countryCode',
      );

      const nonAdminToken = getTestToken(nonAdminEmail, nonAdminUserId);
      const denied = await request(app)
        .get('/api/v1/admin/onboarding/template.csv')
        .set('Authorization', `Bearer ${nonAdminToken}`);
      expect(denied.status).toBe(403);
    });

    it('serves the XLSX template as a workbook', async () => {
      const token = getTestToken(adminEmail, adminUserId);
      const res = await request(app)
        .get('/api/v1/admin/onboarding/template.xlsx')
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/spreadsheetml/);
      expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    });

    it('returns 401 for the templates without a token', async () => {
      const res = await request(app).get('/api/v1/admin/onboarding/template.xlsx');
      expect(res.status).toBe(401);
    });
  });

  describe('xlsx import and dry run', () => {
    async function xlsxOf(rows: string[][]): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sites');
      ws.addRow(HEADER.split(','));
      rows.forEach((r) => ws.addRow(r));
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    it('imports an .xlsx upload through the same path as CSV', async () => {
      const token = getTestToken(adminEmail, adminUserId);
      const id = `import-xlsx-${uuidv4().slice(0, 8)}.example.de`;
      const email = `import-xlsx-${uuidv4().slice(0, 8)}@example.de`;
      identifiers.push(id);
      emails.push(email);

      const res = await request(app)
        .post('/api/v1/admin/onboarding/import')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', XLSX_CONTENT_TYPE)
        .send(await xlsxOf([[id, 'Xlsx Org', email, FP_A]]));

      expect(res.status).toBe(200);
      expect(res.body.data.dryRun).toBe(false);
      expect(res.body.data.summary).toEqual({ created: 1, updated: 0, failed: 0 });
      expect(res.body.data.rows[0]).toMatchObject({ identifier: id, row: 1 });
      expect(await db('organizations').where({ identifier: id }).first()).toBeTruthy();
    });

    it('dryRun=true reports created/updated/failed with row numbers and writes nothing', async () => {
      const token = getTestToken(adminEmail, adminUserId);
      const idNew = `dry-new-${uuidv4().slice(0, 8)}.example.de`;
      const idTaken = `dry-taken-${uuidv4().slice(0, 8)}.example.de`;
      const email = `dry-${uuidv4().slice(0, 8)}@example.de`;
      identifiers.push(idNew, idTaken);
      emails.push(email);

      // Real import first so FP_B belongs to idTaken.
      await request(app)
        .post('/api/v1/admin/onboarding/import')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/csv')
        .send(csvOf([`${idTaken},Taken Org,${email},${FP_B}`]));

      const csv = csvOf([
        `${idNew},New Org,${email},${FP_A}`,
        `bad,Bad Org,${email},${FP_A}`,
        `${idTaken},Taken Org renamed,${email},${FP_B}`,
        `dry-clash-${idNew},Clash Org,${email},${FP_B}`,
      ]);
      const res = await request(app)
        .post('/api/v1/admin/onboarding/import?dryRun=true')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/csv')
        .send(csv);

      expect(res.status).toBe(200);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.parseErrors).toEqual([{ row: 2, issue: 'Must be a valid FQDN' }]);
      expect(
        res.body.data.rows.map((r: { action: string; row: number }) => [r.row, r.action]),
      ).toEqual([
        [1, 'created'],
        [3, 'updated'],
        [4, 'failed'],
      ]);
      expect(res.body.data.rows[2].issue).toBe('FINGERPRINT_IN_USE');
      expect(await db('organizations').where({ identifier: idNew }).first()).toBeUndefined();
      expect(await db('audit_logs').where({ resource_id: idNew }).first()).toBeUndefined();
    });

    it('dryRun=true flags a repeated identifier in one payload as DUPLICATE_IDENTIFIER', async () => {
      const token = getTestToken(adminEmail, adminUserId);
      const id = `dry-dup-${uuidv4().slice(0, 8)}.example.de`;
      const email = `dry-dup-${uuidv4().slice(0, 8)}@example.de`;
      identifiers.push(id);
      emails.push(email);

      const res = await request(app)
        .post('/api/v1/admin/onboarding/import?dryRun=true')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/csv')
        .send(csvOf([`${id},Org,${email},${FP_A}`, `${id},Org again,${email},${FP_A}`]));

      expect(res.status).toBe(200);
      expect(
        res.body.data.rows.map((r: { action: string; issue?: string }) => [r.action, r.issue]),
      ).toEqual([
        ['created', undefined],
        ['failed', 'DUPLICATE_IDENTIFIER'],
      ]);
    });
  });

  describe('POST /parse', () => {
    it('returns the validated rows and parse errors without writing anything', async () => {
      const token = getTestToken(adminEmail, adminUserId);
      const id = `parse-${uuidv4().slice(0, 8)}.example.de`;
      identifiers.push(id);

      const res = await request(app)
        .post('/api/v1/admin/onboarding/parse')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/csv')
        .send(
          csvOf([`${id},Parse Org,p@parse.example.de,${FP_A}`, `bad,Bad,x@y.example.de,${FP_A}`]),
        );

      expect(res.status).toBe(200);
      expect(res.body.data.rows).toEqual([
        expect.objectContaining({
          organizationIdentifier: id,
          organizationName: 'Parse Org',
          contactEmail: 'p@parse.example.de',
          clientCertFingerprint: FP_A,
          row: 1,
        }),
      ]);
      expect(res.body.data.parseErrors).toEqual([{ row: 2, issue: 'Must be a valid FQDN' }]);
      expect(await db('organizations').where({ identifier: id }).first()).toBeUndefined();
    });

    it('rejects a PEM, an empty body and non-admins', async () => {
      const token = getTestToken(adminEmail, adminUserId);
      const pem = await request(app)
        .post('/api/v1/admin/onboarding/parse')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/csv').send(`${HEADER}
-----BEGIN PRIVATE KEY-----`);
      expect(pem.status).toBe(400);
      expect(pem.body.error.code).toBe('PEM_NOT_ALLOWED');

      const empty = await request(app)
        .post('/api/v1/admin/onboarding/parse')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/csv');
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('EMPTY_BODY');

      const nonAdmin = await request(app)
        .post('/api/v1/admin/onboarding/parse')
        .set('Authorization', `Bearer ${getTestToken(nonAdminEmail, nonAdminUserId)}`)
        .set('Content-Type', 'text/csv')
        .send(csvOf([]));
      expect(nonAdmin.status).toBe(403);
    });
  });
});
