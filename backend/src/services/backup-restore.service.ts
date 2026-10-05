/**
 * backup-restore.service.ts – restores a JSON backup into the database. Run
 * by hand on the server through scripts/restore-backup.ts, never by the portal.
 *
 * Safety: the document is verified first (format, version, row counts,
 * SHA-256); a backup from a NEWER schema is refused, a backup from an older
 * schema is accepted only when every table and column it contains still exists
 * (otherwise the operator must restore into a database migrated to the backup's
 * schema first). All data changes run in ONE transaction with FOREIGN_KEY_CHECKS
 * off; any error rolls everything back. Tables that exist in the database but
 * not in the backup (added by a newer migration) keep their rows.
 *
 * audit_logs is append-only (DELETE/UPDATE triggers, migration 013). Restoring
 * into an emptied table is the one documented exception: the triggers of the
 * restored tables are dropped before the transaction and re-created afterwards
 * (also after a failure), without their original DEFINER clause.
 *
 * Never logs row content. Dependencies: mysql2, backup-dump.service, lib/backup*
 */
import mysql, { Connection, ConnectionOptions } from 'mysql2';
import { promisify } from 'util';
import { gunzip } from 'zlib';
import { readFile } from 'fs/promises';
import {
  BackupDocument,
  SCHEMA_VERSION,
  decodeCell,
  verifyBackupDocument,
} from '../lib/backupFormat';
import { decryptBackup, isEncryptedBackup } from '../lib/backupCrypto';
import { mysqlConnectionOptions, readSchema, SchemaTable } from './backup-dump.service';

const gunzipAsync = promisify(gunzip);
const BATCH_ROWS = 500;
const BATCH_CHARS = 1_000_000;

/** Reads, decrypts, decompresses, parses and verifies a backup file. */
export async function loadBackupFile(path: string, key: Buffer | null): Promise<BackupDocument> {
  let buf: Buffer = await readFile(path);
  if (isEncryptedBackup(buf)) {
    if (!key) throw new Error('This backup is encrypted: set BACKUP_ENCRYPTION_KEY to restore it');
    buf = decryptBackup(buf, key);
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = await gunzipAsync(buf);
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('Backup is not valid JSON (truncated or damaged file)');
  }
  return verifyBackupDocument(parsed);
}

export interface RestorePlan {
  /** Backup tables that will be emptied and refilled, with their row counts. */
  tables: Array<{ name: string; rows: number }>;
  /** Tables only the database has: left untouched. */
  untouched: string[];
}

/** Compares the backup with the live schema; throws when it cannot be restored. */
export function planRestore(
  doc: BackupDocument,
  schema: SchemaTable[],
  appSchemaVersion = SCHEMA_VERSION,
): RestorePlan {
  if (doc.schemaVersion > appSchemaVersion) {
    throw new Error(
      `The backup is from schema version ${doc.schemaVersion}, newer than this installation ` +
        `(${appSchemaVersion}). Update the portal and apply its migrations first.`,
    );
  }
  const live = new Map(schema.map((t) => [t.name, new Set(t.columns.map((c) => c.name))]));
  for (const [name, table] of Object.entries(doc.tables)) {
    const columns = live.get(name);
    if (!columns) {
      throw new Error(
        `Table "${name}" of the backup does not exist in this database. ` +
          `Restore into a database migrated to schema version ${doc.schemaVersion}.`,
      );
    }
    const missing = table.columns.filter((c) => !columns.has(c.name)).map((c) => c.name);
    if (missing.length > 0) {
      throw new Error(
        `Table "${name}" no longer has the column(s) ${missing.join(', ')} that the backup contains. ` +
          `Restore into a database migrated to schema version ${doc.schemaVersion}.`,
      );
    }
  }
  return {
    tables: Object.entries(doc.tables).map(([name, t]) => ({ name, rows: t.rows.length })),
    untouched: schema.map((t) => t.name).filter((n) => !(n in doc.tables)),
  };
}

interface TriggerDef {
  name: string;
  ddl: string;
}

async function captureAndDropTriggers(conn: Connection, tables: string[]): Promise<TriggerDef[]> {
  if (tables.length === 0) return [];
  const db = conn.promise();
  const [rows] = await db.query(
    `SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE IN (?)`,
    [tables],
  );
  const defs: TriggerDef[] = [];
  for (const { name } of rows as Array<{ name: string }>) {
    const [res] = await db.query(`SHOW CREATE TRIGGER ${mysql.escapeId(name)}`);
    const ddl = String((res as Array<Record<string, unknown>>)[0]['SQL Original Statement']);
    // A DEFINER of another account cannot be re-created without SUPER.
    defs.push({ name, ddl: ddl.replace(/\bDEFINER\s*=\s*`[^`]*`@`[^`]*`\s*/i, '') });
  }
  for (const d of defs) await db.query(`DROP TRIGGER ${mysql.escapeId(d.name)}`);
  return defs;
}

async function insertTable(
  conn: Connection,
  name: string,
  doc: BackupDocument['tables'][string],
): Promise<void> {
  const db = conn.promise();
  const types = doc.columns.map((c) => c.type);
  const colList = doc.columns.map((c) => mysql.escapeId(c.name)).join(', ');
  const sql = `INSERT INTO ${mysql.escapeId(name)} (${colList}) VALUES ?`;
  let batch: unknown[][] = [];
  let chars = 0;
  const flush = async (): Promise<void> => {
    if (batch.length > 0) await db.query(sql, [batch]);
    batch = [];
    chars = 0;
  };
  for (const row of doc.rows) {
    batch.push(row.map((cell, i) => decodeCell(types[i], cell)));
    chars += JSON.stringify(row).length;
    if (batch.length >= BATCH_ROWS || chars >= BATCH_CHARS) await flush();
  }
  await flush();
}

export interface RestoreOptions {
  connection?: ConnectionOptions;
  /** Validate and plan only. */
  dryRun?: boolean;
  /** Restrict to some tables (tests only). */
  tableFilter?: (name: string) => boolean;
  log?: (line: string) => void;
}

export interface RestoreResult {
  plan: RestorePlan;
  restored: boolean;
  /** Row counts per table as found in the database after the restore. */
  counts: Record<string, number>;
}

export async function restoreBackup(
  doc: BackupDocument,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  const log = opts.log ?? ((): void => undefined);
  const conn = mysql.createConnection({
    ...(opts.connection ?? mysqlConnectionOptions()),
    // Cells arrive as strings/Buffers; keep mysql2 from reinterpreting them.
    dateStrings: true,
  });
  const db = conn.promise();
  let dropped: TriggerDef[] = [];
  try {
    const schema = (await readSchema(conn)).filter((t) => opts.tableFilter?.(t.name) ?? true);
    const plan = planRestore(doc, schema);
    if (opts.dryRun) return { plan, restored: false, counts: {} };

    await db.query("SET SESSION time_zone = '+00:00'");
    dropped = await captureAndDropTriggers(
      conn,
      plan.tables.map((t) => t.name),
    );
    if (dropped.length > 0) {
      log(`Temporarily dropped ${dropped.length} trigger(s); they are re-created at the end.`);
      log('If this process is killed now, re-apply db/migrations/013 and 015 to restore them.');
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    await db.query('START TRANSACTION');
    try {
      for (const { name } of plan.tables) {
        await db.query(`DELETE FROM ${mysql.escapeId(name)}`);
      }
      for (const { name } of plan.tables) {
        log(`Restoring ${name} ...`);
        await insertTable(conn, name, doc.tables[name]);
      }
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    const counts: Record<string, number> = {};
    for (const { name } of plan.tables) {
      const [r] = await db.query(`SELECT COUNT(*) AS n FROM ${mysql.escapeId(name)}`);
      counts[name] = Number((r as Array<{ n: number }>)[0].n);
    }
    return { plan, restored: true, counts };
  } finally {
    try {
      await db.query('SET FOREIGN_KEY_CHECKS = 1');
      for (const d of dropped) await db.query(d.ddl);
    } finally {
      conn.destroy();
    }
  }
}
