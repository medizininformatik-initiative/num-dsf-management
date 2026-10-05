/**
 * onboarding.service.test.ts — pure unit tests for parseOnboardingFile, the
 * input-hardening core of the admin bulk cert-onboarding upload (CSV/JSON).
 * Covers: valid CSV/JSON parsing, per-row error collection (bad FQDN/email/
 * fingerprint) without failing the whole file, the CSV/Excel formula-injection
 * guard on organizationName, and the file-level guards (size, PEM, row count,
 * unsupported format) which are the only conditions allowed to throw.
 * No DB.
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import {
  parseOnboardingFile,
  importSites,
  onboardingRowSchema,
  type OnboardingRow,
} from '../services/onboarding.service';

const FP_A = 'a'.repeat(128);
const FP_B = 'b'.repeat(128);
const HEADER = 'organizationIdentifier,organizationName,contactEmail,clientCertFingerprint';

function csvOf(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

function importRow(overrides: Partial<OnboardingRow> = {}): OnboardingRow {
  return onboardingRowSchema.parse({
    organizationIdentifier: `import-${Date.now()}-${uuidv4().slice(0, 8)}.example.de`,
    organizationName: 'Import Test Org',
    contactEmail: `import-${uuidv4().slice(0, 8)}@example.de`,
    clientCertFingerprint: 'c'.repeat(128),
    ...overrides,
  });
}

describe('parseOnboardingFile — valid input', () => {
  it('parses a valid CSV with two good rows', () => {
    const csv = csvOf([
      `ukm.de,Uniklinikum Muenster,admin@ukm.de,${FP_A}`,
      `charite.de,Charite Berlin,admin@charite.de,${FP_B}`,
    ]);
    const result = parseOnboardingFile(Buffer.from(csv), 'text/csv');
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  it('parses a valid JSON array with the same two rows', () => {
    const rows = [
      {
        organizationIdentifier: 'ukm.de',
        organizationName: 'Uniklinikum Muenster',
        contactEmail: 'admin@ukm.de',
        clientCertFingerprint: FP_A,
      },
      {
        organizationIdentifier: 'charite.de',
        organizationName: 'Charite Berlin',
        contactEmail: 'admin@charite.de',
        clientCertFingerprint: FP_B,
      },
    ];
    const result = parseOnboardingFile(Buffer.from(JSON.stringify(rows)), 'application/json');
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  it('detects a JSON body from its leading "[" even without an application/json content-type', () => {
    const rows = [
      {
        organizationIdentifier: 'ukm.de',
        organizationName: 'Uniklinikum Muenster',
        contactEmail: 'admin@ukm.de',
        clientCertFingerprint: FP_A,
      },
    ];
    const result = parseOnboardingFile(Buffer.from(JSON.stringify(rows)), undefined);
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('wraps a single JSON object into a one-row array', () => {
    const row = {
      organizationIdentifier: 'ukm.de',
      organizationName: 'Uniklinikum Muenster',
      contactEmail: 'admin@ukm.de',
      clientCertFingerprint: FP_A,
    };
    const result = parseOnboardingFile(Buffer.from(JSON.stringify(row)), 'application/json');
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('normalizes a fingerprint with colons and upper-case hex before validating', () => {
    const colonUpperFp = Array(64).fill('AB').join(':');
    const csv = csvOf([`ukm.de,Uniklinikum Muenster,admin@ukm.de,${colonUpperFp}`]);
    const result = parseOnboardingFile(Buffer.from(csv), 'text/csv');
    expect(result.errors).toEqual([]);
    expect(result.valid[0]?.clientCertFingerprint).toBe('ab'.repeat(64));
  });
});

describe('parseOnboardingFile — per-row validation errors', () => {
  it('collects a bad-FQDN row as an error while keeping the valid row', () => {
    const csv = csvOf([
      `ukm.de,Uniklinikum Muenster,admin@ukm.de,${FP_A}`,
      `not_a_domain,Bad Org,admin@bad.de,${FP_B}`,
    ]);
    const result = parseOnboardingFile(Buffer.from(csv), 'text/csv');
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.organizationIdentifier).toBe('ukm.de');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2 });
  });

  it('collects a bad-email row as an error while keeping the valid row', () => {
    const csv = csvOf([
      `ukm.de,Uniklinikum Muenster,admin@ukm.de,${FP_A}`,
      `charite.de,Charite Berlin,not-an-email,${FP_B}`,
    ]);
    const result = parseOnboardingFile(Buffer.from(csv), 'text/csv');
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2 });
  });

  it('collects a 127-char (one-short) fingerprint row as an error while keeping the valid row', () => {
    const csv = csvOf([
      `ukm.de,Uniklinikum Muenster,admin@ukm.de,${FP_A}`,
      `charite.de,Charite Berlin,admin@charite.de,${'b'.repeat(127)}`,
    ]);
    const result = parseOnboardingFile(Buffer.from(csv), 'text/csv');
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2 });
  });
});

describe('parseOnboardingFile — formula-injection guard', () => {
  it('rejects an organizationName starting with a spreadsheet formula, but accepts a normal name', () => {
    const csv = csvOf([
      `ukm.de,Uniklinikum Muenster,admin@ukm.de,${FP_A}`,
      `evil.de,=SUM(1+1),admin@evil.de,${FP_B}`,
    ]);
    const result = parseOnboardingFile(Buffer.from(csv), 'text/csv');
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.organizationIdentifier).toBe('ukm.de');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2 });
  });
});

describe('parseOnboardingFile — file-level guards (throw)', () => {
  it('throws FILE_TOO_LARGE for a buffer over 1 MB', () => {
    const big = Buffer.alloc(1_000_001, 'a');
    expect(() => parseOnboardingFile(big, 'text/csv')).toThrow('FILE_TOO_LARGE');
  });

  it('throws PEM_NOT_ALLOWED when the upload contains a PEM header', () => {
    // Header split across concatenation so the secret scanner does not flag
    // this deliberately-fake fixture (matches the pattern already used in
    // certFingerprint.test.ts for the same reason).
    const pemLike = '-----BEGIN' + ' PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';
    expect(() => parseOnboardingFile(Buffer.from(pemLike), 'text/plain')).toThrow(
      'PEM_NOT_ALLOWED',
    );
  });

  it('throws UNSUPPORTED_FORMAT for a body that looks like JSON but fails to parse', () => {
    const broken = '[{ "organizationIdentifier": "ukm.de", ';
    expect(() => parseOnboardingFile(Buffer.from(broken), 'application/json')).toThrow(
      'UNSUPPORTED_FORMAT',
    );
  });

  it('throws TOO_MANY_ROWS for more than 1000 data rows', () => {
    const rows = Array.from(
      { length: 1001 },
      (_, i) => `org${i}.de,Org ${i},admin${i}@org${i}.de,${FP_A}`,
    );
    const csv = csvOf(rows);
    expect(() => parseOnboardingFile(Buffer.from(csv), 'text/csv')).toThrow('TOO_MANY_ROWS');
  });
});

describe('importSites', () => {
  const ACTOR_EMAIL = 'importer@imi.uni-muenster.de';
  const IP = '127.0.0.1';
  const identifiers: string[] = [];
  const emails: string[] = [];

  function track(row: OnboardingRow): OnboardingRow {
    identifiers.push(row.organizationIdentifier);
    emails.push(row.contactEmail);
    return row;
  }

  afterEach(async () => {
    if (identifiers.length) {
      await db('audit_logs')
        .where({ resource_type: 'ORGANIZATION' })
        .whereIn('resource_id', identifiers)
        .del();
    }
    if (emails.length) {
      // users → instances → organizations all cascade on delete, so removing
      // the users row cleans up everything this test created for that email.
      await db('users').whereIn('email', emails).del();
      await db('email_whitelist').whereIn('email', emails).del();
    }
    identifiers.length = 0;
    emails.length = 0;
  });

  it('creates a brand-new site: org + instance + user + whitelist, with an audit row', async () => {
    const row = track(importRow());

    const result = await importSites([row], ACTOR_EMAIL, IP);

    expect(result.rows).toEqual([
      { identifier: row.organizationIdentifier, action: 'created', ok: true },
    ]);
    expect(result.summary).toEqual({ created: 1, updated: 0, failed: 0 });

    const org = await db('organizations').where({ identifier: row.organizationIdentifier }).first();
    expect(org).toBeTruthy();
    expect(org.client_cert_fingerprint).toBe(row.clientCertFingerprint);
    expect(!!org.active).toBe(true);

    const user = await db('users').where({ email: row.contactEmail }).first();
    expect(user).toBeTruthy();
    const whitelisted = await db('email_whitelist').where({ email: row.contactEmail }).first();
    expect(whitelisted).toBeTruthy();
    const instance = await db('instances').where({ id: org.instance_id }).first();
    expect(instance).toBeTruthy();
    expect(instance.user_id).toBe(user.id);

    const audit = await db('audit_logs')
      .where({ resource_type: 'ORGANIZATION', resource_id: row.organizationIdentifier })
      .first();
    expect(audit).toBeTruthy();
    expect(audit.operation).toBe('CREATE');
  });

  it('re-importing the same row updates in place without duplicating org/instance', async () => {
    const row = track(importRow());

    const first = await importSites([row], ACTOR_EMAIL, IP);
    expect(first.rows[0]).toMatchObject({ action: 'created', ok: true });

    const second = await importSites([row], ACTOR_EMAIL, IP);
    expect(second.rows).toEqual([
      { identifier: row.organizationIdentifier, action: 'updated', ok: true },
    ]);
    expect(second.summary).toEqual({ created: 0, updated: 1, failed: 0 });

    const orgs = await db('organizations').where({ identifier: row.organizationIdentifier });
    expect(orgs).toHaveLength(1);
    const instances = await db('instances').where({ id: orgs[0].instance_id });
    expect(instances).toHaveLength(1);
  });

  it('fails a repeated identifier in one payload with DUPLICATE_IDENTIFIER and writes only the first', async () => {
    const row = track(importRow());
    const again = { ...row, organizationName: 'Renamed in a second file' };

    const result = await importSites([row, again], ACTOR_EMAIL, IP);

    expect(result.rows[0]).toMatchObject({ action: 'created', ok: true });
    expect(result.rows[1]).toMatchObject({
      action: 'failed',
      ok: false,
      issue: 'DUPLICATE_IDENTIFIER',
    });
    const org = await db('organizations').where({ identifier: row.organizationIdentifier }).first();
    expect(org.name).toBe(row.organizationName);
  });

  it("fails the second row with FINGERPRINT_IN_USE when it reuses another identifier's fingerprint, first row stays ok", async () => {
    const sharedFp = 'd'.repeat(128);
    const rowA = track(importRow({ clientCertFingerprint: sharedFp }));
    const rowB = track(importRow({ clientCertFingerprint: sharedFp }));

    const result = await importSites([rowA, rowB], ACTOR_EMAIL, IP);

    expect(result.rows[0]).toEqual({
      identifier: rowA.organizationIdentifier,
      action: 'created',
      ok: true,
    });
    expect(result.rows[1]).toMatchObject({
      identifier: rowB.organizationIdentifier,
      action: 'failed',
      ok: false,
      issue: 'FINGERPRINT_IN_USE',
    });
    expect(result.summary).toEqual({ created: 1, updated: 0, failed: 1 });

    const orgA = await db('organizations')
      .where({ identifier: rowA.organizationIdentifier })
      .first();
    expect(orgA).toBeTruthy();
    const orgB = await db('organizations')
      .where({ identifier: rowB.organizationIdentifier })
      .first();
    expect(orgB).toBeFalsy();
  });
});
