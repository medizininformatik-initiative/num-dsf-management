/**
 * backup-dump.service.ts – streams every application table of the MySQL
 * schema into the JSON backup document (gzip, optionally AES-256-GCM).
 *
 * Tables are discovered from information_schema, so a table added by a future
 * migration is part of the next backup without code changes. Nothing is
 * excluded: there is no migration bookkeeping table in this schema (migrations
 * are applied by hand, tracked outside the database in .migrations-applied).
 * Generated columns (e.g. bundle_restore_requests.pending_slot) are skipped,
 * MySQL recomputes them on restore. All tables are read inside one REPEATABLE
 * READ snapshot on a dedicated connection, so the dump is internally consistent
 * even while the portal keeps writing.
 *
 * Never logs row content. Dependencies: mysql2, lib/backupFormat, backupCrypto
 */
import mysql, { Connection, ConnectionOptions } from 'mysql2';
import { createGzip } from 'zlib';
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { PassThrough, Readable, Transform, TransformCallback } from 'stream';
import { pipeline } from 'stream/promises';
import {
  BackupColumn,
  BackupMeta,
  TableSource,
  SCHEMA_VERSION,
  encodeBinary,
  encodeJsonColumn,
  serializeBackup,
} from '../lib/backupFormat';
import { createEncryptStream } from '../lib/backupCrypto';

export function mysqlConnectionOptions(): ConnectionOptions {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'dsf_allowlist',
    user: process.env.DB_USER || 'dsf',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
    // Dates are handled as the exact strings MySQL sends; UTC pins TIMESTAMPs.
    timezone: 'Z',
    dateStrings: true,
  };
}

export interface SchemaTable {
  name: string;
  /** Insertable columns (generated columns excluded), in table order. */
  columns: BackupColumn[];
}

const SUPPORTED_TYPES = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'bigint',
  'decimal',
  'float',
  'double',
  'bit',
  'char',
  'varchar',
  'tinytext',
  'text',
  'mediumtext',
  'longtext',
  'enum',
  'set',
  'binary',
  'varbinary',
  'tinyblob',
  'blob',
  'mediumblob',
  'longblob',
  'date',
  'time',
  'datetime',
  'timestamp',
  'year',
  'json',
]);
const BINARY_TYPES = new Set([
  'bit',
  'binary',
  'varbinary',
  'tinyblob',
  'blob',
  'mediumblob',
  'longblob',
]);
const STRING_TYPES = new Set(['date', 'time', 'datetime', 'timestamp', 'year', 'decimal']);

/** Application tables and their insertable columns, straight from the live schema. */
export async function readSchema(conn: Connection): Promise<SchemaTable[]> {
  const db = conn.promise();
  const [tableRows] = await db.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
  );
  const [columnRows] = await db.query(
    `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, LOWER(DATA_TYPE) AS dtype, EXTRA AS extra
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  );
  const byTable = new Map<string, BackupColumn[]>();
  for (const c of columnRows as Array<{ tbl: string; col: string; dtype: string; extra: string }>) {
    if (/\b(STORED|VIRTUAL) GENERATED\b/i.test(c.extra)) continue;
    if (!SUPPORTED_TYPES.has(c.dtype)) {
      throw new Error(
        `Column ${c.tbl}.${c.col} has type "${c.dtype}", which the backup does not support`,
      );
    }
    const list = byTable.get(c.tbl) ?? [];
    list.push({ name: c.col, type: c.dtype });
    byTable.set(c.tbl, list);
  }
  return (tableRows as Array<{ name: string }>).map((t) => ({
    name: t.name,
    columns: byTable.get(t.name) ?? [],
  }));
}

function buildTypeCast(columns: BackupColumn[]) {
  const kinds = new Map(columns.map((c) => [c.name, c.type]));
  return (
    field: {
      name: string;
      string: (encoding?: string) => string | null;
      buffer: () => Buffer | null;
    },
    next: () => unknown,
  ): unknown => {
    const kind = kinds.get(field.name) ?? '';
    if (BINARY_TYPES.has(kind)) {
      const buf = field.buffer();
      return buf === null ? null : encodeBinary(buf);
    }
    if (kind === 'json') return encodeJsonColumn(field.string('utf8'));
    if (STRING_TYPES.has(kind)) return field.string();
    if (kind === 'bigint') {
      const text = field.string();
      if (text === null) return null;
      const n = Number(text);
      return Number.isSafeInteger(n) ? n : text;
    }
    if (
      ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set'].includes(
        kind,
      )
    ) {
      return field.string();
    }
    return next();
  };
}

async function* tableSources(conn: Connection, tables: SchemaTable[]): AsyncGenerator<TableSource> {
  for (const table of tables) {
    const cols = table.columns.map((c) => mysql.escapeId(c.name)).join(', ');
    const sql = `SELECT ${cols} FROM ${mysql.escapeId(table.name)}`;
    const query = conn.query({
      sql,
      rowsAsArray: true,
      typeCast: buildTypeCast(table.columns),
    } as mysql.QueryOptions);
    const rows = query.stream({ highWaterMark: 256 }) as AsyncIterable<unknown[]>;
    yield { name: table.name, columns: table.columns, rows };
  }
}

export interface DumpResult {
  sizeBytes: number;
  /** SHA-256 of the file as written (what an admin checks after copying it). */
  fileSha256: string;
}

export interface DumpOptions {
  connection?: ConnectionOptions;
  /** Restrict to some tables (tests only; production dumps everything). */
  tableFilter?: (name: string) => boolean;
  appVersion?: string;
  /** AES-256 key; the file is encrypted when given. */
  encryptionKey?: Buffer | null;
}

class Tally extends Transform {
  readonly hash = createHash('sha256');
  size = 0;
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.hash.update(chunk);
    this.size += chunk.length;
    cb(null, chunk);
  }
}

/** Writes the full backup to `filePath` (mode 0600). Throws on any failure. */
export async function writeBackupFile(
  filePath: string,
  opts: DumpOptions = {},
): Promise<DumpResult> {
  const conn = mysql.createConnection(opts.connection ?? mysqlConnectionOptions());
  const db = conn.promise();
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    await db.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const schema = (await readSchema(conn)).filter((t) => opts.tableFilter?.(t.name) ?? true);
    const meta: BackupMeta = {
      createdAt: new Date().toISOString(),
      appVersion: opts.appVersion ?? 'unknown',
      schemaVersion: SCHEMA_VERSION,
    };
    const source = Readable.from(serializeBackup(meta, tableSources(conn, schema)));
    const tally = new Tally();
    await pipeline(
      source,
      createGzip(),
      opts.encryptionKey ? createEncryptStream(opts.encryptionKey) : new PassThrough(),
      tally,
      createWriteStream(filePath, { mode: 0o600, flags: 'wx' }),
    );
    await db.query('ROLLBACK');
    return { sizeBytes: tally.size, fileSha256: tally.hash.digest('hex') };
  } finally {
    conn.destroy();
  }
}
