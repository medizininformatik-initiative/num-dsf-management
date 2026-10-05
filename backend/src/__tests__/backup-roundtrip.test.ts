/**
 * backup-roundtrip.test.ts – DB-backed: seed tables with every column type the
 * portal uses (DATETIME(3), TIMESTAMP, JSON incl. JSON null, BLOB, BIGINT
 * beyond 2^53, DECIMAL, ENUM, generated column, FK, unicode, NULLs) -> dump ->
 * wipe -> restore -> compare every table row for row. Uses its own bkt_<run>_*
 * tables, so the shared dev database is never wiped. Also checks the
 * all-or-nothing rollback, trigger preservation, encrypted files and a
 * read-only dump + dry-run of the whole real schema.
 * Dependencies: mysql2, backup-dump.service, backup-restore.service, lib/backup*
 */
import mysql from 'mysql2';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import {
  mysqlConnectionOptions,
  readSchema,
  writeBackupFile,
} from '../services/backup-dump.service';
import { loadBackupFile, planRestore, restoreBackup } from '../services/backup-restore.service';
import { SCHEMA_VERSION } from '../lib/backupFormat';

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const PARENT = `bkt_${run}_parent`;
const CHILD = `bkt_${run}_child`;
const TRIGGER = `bkt_${run}_no_delete`;
const only = (name: string): boolean => name.startsWith(`bkt_${run}_`);

const BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

let conn: mysql.Connection;
let dir: string;

/** Own connection that returns exact values: strings for dates and big numbers. */
function raw(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  return conn
    .promise()
    .query(sql, params)
    .then(([rows]) => rows as Array<Record<string, unknown>>);
}

async function snapshot(): Promise<Record<string, unknown>> {
  return {
    parent: await raw(
      `SELECT p.*, JSON_TYPE(p.doc) AS doc_type, HEX(p.payload) AS payload_hex FROM ${PARENT} p ORDER BY id`,
    ),
    child: await raw(`SELECT * FROM ${CHILD} ORDER BY id`),
  };
}

beforeAll(async () => {
  conn = mysql.createConnection({
    ...mysqlConnectionOptions(),
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  dir = await mkdtemp(join(tmpdir(), 'bkt-'));
  await raw(`CREATE TABLE ${PARENT} (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    stamp TIMESTAMP(3) NULL,
    due DATE NULL,
    doc JSON NULL,
    payload LONGBLOB NULL,
    flag TINYINT(1) NOT NULL DEFAULT 0,
    big BIGINT UNSIGNED NULL,
    amount DECIMAL(12,4) NULL,
    kind ENUM('A','B') NOT NULL DEFAULT 'A',
    note TEXT NULL,
    only_when_flag TINYINT AS (IF(flag = 1, 1, NULL)) STORED,
    UNIQUE KEY uq_${run}_flag (only_when_flag)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await raw(`CREATE TABLE ${CHILD} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parent_id CHAR(36) NOT NULL,
    label VARCHAR(100) NOT NULL,
    CONSTRAINT fk_${run}_parent FOREIGN KEY (parent_id) REFERENCES ${PARENT} (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await raw(
    `INSERT INTO ${PARENT}
    (id, name, created_at, stamp, due, doc, payload, flag, big, amount, kind, note) VALUES
    ('p1', 'Müller & Söhne \u{1F600} "quoted"', '2026-10-05 10:00:00.123', '2026-10-05 08:00:00.456',
     '2026-12-31', '{"a":[1,2,{"b":null}],"s":"Zürich \u{1F600}"}', ?, 1, 9007199254740993, 1234.5000, 'B',
     'Zeile 1\\nZeile 2\\ttab'),
    ('p2', 'all nulls', '2000-01-01 00:00:00.000', NULL, NULL, NULL, NULL, 0, NULL, NULL, 'A', NULL),
    ('p3', 'json null literal', '2026-02-28 23:59:59.999', NULL, NULL, 'null', ?, 0, 18446744073709551615,
     -0.0001, 'A', '')`,
    [BYTES, Buffer.alloc(0)],
  );
  await raw(
    `INSERT INTO ${CHILD} (parent_id, label) VALUES ('p1', 'one'), ('p1', 'two'), ('p3', 'three')`,
  );
});

afterAll(async () => {
  await raw(`DROP TRIGGER IF EXISTS ${TRIGGER}`).catch(() => undefined);
  await raw(`DROP TABLE IF EXISTS ${CHILD}`).catch(() => undefined);
  await raw(`DROP TABLE IF EXISTS ${PARENT}`).catch(() => undefined);
  conn.destroy();
  await rm(dir, { recursive: true, force: true });
});

describe('backup round trip', () => {
  it('dumps, wipes and restores every table row for row', async () => {
    const before = await snapshot();
    const file = join(dir, 'roundtrip.json.gz');
    const dump = await writeBackupFile(file, { tableFilter: only });
    expect(dump.sizeBytes).toBeGreaterThan(100);
    expect(dump.fileSha256).toBe(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    );
    expect((await stat(file)).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o600);

    const doc = await loadBackupFile(file, null);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.counts).toEqual({ [CHILD]: 3, [PARENT]: 3 });
    // The generated column is recomputed by MySQL, not stored.
    expect(doc.tables[PARENT].columns.map((c) => c.name)).not.toContain('only_when_flag');

    await raw(`DELETE FROM ${CHILD}`);
    await raw(`DELETE FROM ${PARENT}`);
    expect(await raw(`SELECT 1 FROM ${PARENT}`)).toHaveLength(0);

    const result = await restoreBackup(doc, { tableFilter: only });
    expect(result.restored).toBe(true);
    expect(result.counts).toEqual({ [CHILD]: 3, [PARENT]: 3 });
    expect(await snapshot()).toEqual(before);
  });

  it('keeps JSON null, NULL, empty and binary values distinct after a restore', async () => {
    const rows = await raw(
      `SELECT id, JSON_TYPE(doc) AS jt, doc IS NULL AS doc_is_null, HEX(payload) AS hx, big
         FROM ${PARENT} ORDER BY id`,
    );
    expect(rows[0]).toMatchObject({
      id: 'p1',
      jt: 'OBJECT',
      hx: BYTES.toString('hex').toUpperCase(),
    });
    expect(rows[1]).toMatchObject({ id: 'p2', doc_is_null: '1', hx: null, big: null });
    expect(rows[2]).toMatchObject({
      id: 'p3',
      jt: 'NULL',
      doc_is_null: '0',
      hx: '',
      big: '18446744073709551615',
    });
  });

  it('rolls everything back when one row cannot be inserted', async () => {
    const before = await snapshot();
    const doc = await loadBackupFile(await dumpToFile('rollback.json.gz'), null);
    // Orphaned duplicate primary key in the second table, after the first was refilled.
    doc.tables[CHILD].rows.push([...doc.tables[CHILD].rows[0]]);
    await expect(restoreBackup(doc, { tableFilter: only })).rejects.toThrow(/Duplicate entry/);
    expect(await snapshot()).toEqual(before);
  });

  it('re-creates the triggers of restored tables (audit_logs style append-only guards)', async () => {
    await raw(
      `CREATE TRIGGER ${TRIGGER} BEFORE DELETE ON ${CHILD} FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'append-only'`,
    );
    const doc = await loadBackupFile(await dumpToFile('trigger.json.gz'), null);
    // A plain DELETE is blocked by the trigger, the restore still replaces the table.
    await expect(raw(`DELETE FROM ${CHILD}`)).rejects.toThrow(/append-only/);
    const result = await restoreBackup(doc, { tableFilter: only });
    expect(result.restored).toBe(true);
    expect(
      await raw(
        `SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`,
        [TRIGGER],
      ),
    ).toHaveLength(1);
    await expect(raw(`DELETE FROM ${CHILD}`)).rejects.toThrow(/append-only/);
    await raw(`DROP TRIGGER ${TRIGGER}`);
  });

  it('dry run validates and changes nothing', async () => {
    const before = await snapshot();
    const doc = await loadBackupFile(await dumpToFile('dry.json.gz'), null);
    await raw(`UPDATE ${CHILD} SET label = 'changed' WHERE label = 'one'`);
    const result = await restoreBackup(doc, { dryRun: true, tableFilter: only });
    expect(result.restored).toBe(false);
    expect(result.plan.tables.map((t) => t.name).sort()).toEqual([CHILD, PARENT].sort());
    expect(await snapshot()).not.toEqual(before);
    await restoreBackup(doc, { tableFilter: only });
    expect(await snapshot()).toEqual(before);
  });

  it('restores an encrypted backup only with the key', async () => {
    const key = Buffer.alloc(32, 3);
    const file = join(dir, 'enc.json.gz.enc');
    await writeBackupFile(file, { tableFilter: only, encryptionKey: key });
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 8).toString('ascii')).toBe('DSFBAK01');
    expect(bytes.includes(Buffer.from('Müller'))).toBe(false);
    await expect(loadBackupFile(file, null)).rejects.toThrow(/BACKUP_ENCRYPTION_KEY/);
    await expect(loadBackupFile(file, Buffer.alloc(32, 4))).rejects.toThrow(/Decryption failed/);
    expect((await loadBackupFile(file, key)).counts).toEqual({ [CHILD]: 3, [PARENT]: 3 });
  });
});

describe('restore compatibility checks', () => {
  const schema = [
    {
      name: 't',
      columns: [
        { name: 'id', type: 'int' },
        { name: 'extra', type: 'text' },
      ],
    },
    { name: 'only_in_db', columns: [{ name: 'id', type: 'int' }] },
  ];
  const doc = (over: Record<string, unknown> = {}, tables?: Record<string, unknown>) =>
    ({
      format: 'dsf-allowlist-backup',
      formatVersion: 1,
      createdAt: '',
      appVersion: '',
      schemaVersion: 10,
      counts: {},
      sha256: '',
      tables: tables ?? {
        t: { columns: [{ name: 'id', type: 'int' }], rows: [[1]] },
      },
      ...over,
    }) as unknown as Parameters<typeof planRestore>[0];

  it('accepts an older, column-compatible backup and leaves unknown tables untouched', () => {
    const plan = planRestore(doc(), schema, 28);
    expect(plan.tables).toEqual([{ name: 't', rows: 1 }]);
    expect(plan.untouched).toEqual(['only_in_db']);
  });

  it('refuses a backup from a newer schema', () => {
    expect(() => planRestore(doc({ schemaVersion: 29 }), schema, 28)).toThrow(/newer than/);
  });

  it('refuses tables and columns the database does not have', () => {
    expect(() =>
      planRestore(
        doc({}, { gone: { columns: [{ name: 'id', type: 'int' }], rows: [] } }),
        schema,
        28,
      ),
    ).toThrow(/does not exist/);
    expect(() =>
      planRestore(
        doc({}, { t: { columns: [{ name: 'old', type: 'int' }], rows: [] } }),
        schema,
        28,
      ),
    ).toThrow(/no longer has the column/);
  });
});

describe('whole real schema (read only)', () => {
  it('dumps every table of the database and verifies, dry run included', async () => {
    const file = join(dir, 'full.json.gz');
    await writeBackupFile(file, {});
    const doc = await loadBackupFile(file, null);
    const live = (await readSchema(conn)).map((t) => t.name);
    // Tables other test files create concurrently may appear in between.
    const stable = live.filter((n) => !n.startsWith('bkt_'));
    expect(Object.keys(doc.tables)).toEqual(expect.arrayContaining(stable));
    for (const must of ['users', 'organizations', 'audit_logs', 'backup_settings', 'backup_runs']) {
      expect(doc.tables[must]).toBeDefined();
    }
    const schemaForPlan = (await readSchema(conn)).filter((t) => t.name in doc.tables);
    expect(planRestore(doc, schemaForPlan).tables.length).toBe(Object.keys(doc.tables).length);
    // Generated columns never appear in a dump.
    expect(doc.tables['bundle_restore_requests'].columns.map((c) => c.name)).not.toContain(
      'pending_slot',
    );
  });
});

async function dumpToFile(name: string): Promise<string> {
  const file = join(dir, name);
  await writeBackupFile(file, { tableFilter: only });
  return file;
}
