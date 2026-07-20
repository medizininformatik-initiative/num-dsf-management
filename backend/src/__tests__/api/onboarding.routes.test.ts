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
});
