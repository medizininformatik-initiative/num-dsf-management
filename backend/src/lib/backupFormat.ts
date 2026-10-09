/**
 * backupFormat.ts – the JSON backup document: streaming serializer, value
 * encoding for restore, and verification (format, version, row counts, SHA-256).
 *
 * Layout (all one JSON document, key order fixed so it can be streamed):
 *   { format, formatVersion, createdAt, appVersion, schemaVersion,
 *     tables: { <name>: { columns: [{name,type}], rows: [[...], ...] } },
 *     counts: { <name>: <rowCount> }, sha256 }
 * `sha256` covers the exact text of the `tables` value. Rows are arrays aligned
 * with `columns`. Values: datetimes as the MySQL string (full precision),
 * BIGINT beyond 2^53 and DECIMAL as strings, JSON columns as parsed JSON
 * (a JSON literal null as {"$jsonNull":true}), binary as {"$base64":"..."}.
 *
 * Pure: no database or filesystem access. Dependencies: crypto.
 */
import { createHash } from 'crypto';

export const BACKUP_FORMAT = 'dsf-allowlist-backup';
export const BACKUP_FORMAT_VERSION = 1;
/**
 * Number of the latest migration in db/migrations. Bump together with every new
 * migration; a test compares it to the migrations directory.
 */
export const SCHEMA_VERSION = 29;

export interface BackupColumn {
  name: string;
  /** MySQL DATA_TYPE in lower case (varchar, datetime, json, longblob, ...). */
  type: string;
}

export interface BackupTable {
  columns: BackupColumn[];
  rows: unknown[][];
}

export interface BackupDocument {
  format: string;
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  tables: Record<string, BackupTable>;
  counts: Record<string, number>;
  sha256: string;
}

export interface BackupMeta {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
}

export interface TableSource {
  name: string;
  columns: BackupColumn[];
  rows: AsyncIterable<unknown[]>;
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

const FLUSH_CHARS = 64 * 1024;

/**
 * Serializes the backup document as string chunks. The `tables` text is hashed
 * on the fly, so a table is never held in memory as a whole.
 */
export async function* serializeBackup(
  meta: BackupMeta,
  tables: AsyncIterable<TableSource>,
): AsyncGenerator<string> {
  const hash = createHash('sha256');
  const counts: Record<string, number> = {};
  let buffer = '';

  yield `{"format":${JSON.stringify(BACKUP_FORMAT)},"formatVersion":${BACKUP_FORMAT_VERSION},` +
    `"createdAt":${JSON.stringify(meta.createdAt)},"appVersion":${JSON.stringify(meta.appVersion)},` +
    `"schemaVersion":${meta.schemaVersion},"tables":`;

  const hashed = (text: string): void => {
    hash.update(text);
    buffer += text;
  };

  hashed('{');
  let firstTable = true;
  for await (const table of tables) {
    hashed(
      `${firstTable ? '' : ','}${JSON.stringify(table.name)}:` +
        `{"columns":${JSON.stringify(table.columns)},"rows":[`,
    );
    firstTable = false;
    let count = 0;
    for await (const row of table.rows) {
      hashed(`${count === 0 ? '' : ','}${JSON.stringify(row)}`);
      count++;
      if (buffer.length >= FLUSH_CHARS) {
        yield buffer;
        buffer = '';
      }
    }
    counts[table.name] = count;
    hashed(']}');
  }
  hashed('}');
  if (buffer) yield buffer;
  yield `,"counts":${JSON.stringify(counts)},"sha256":"${hash.digest('hex')}"}`;
}

/** SHA-256 over the canonical text of a parsed `tables` value. */
export function tablesSha256(tables: Record<string, BackupTable>): string {
  return createHash('sha256').update(JSON.stringify(tables)).digest('hex');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates a parsed document and returns it typed; throws BackupFormatError. */
export function verifyBackupDocument(input: unknown): BackupDocument {
  if (!isRecord(input) || input.format !== BACKUP_FORMAT) {
    throw new BackupFormatError('Not a DSF Allow List backup (format marker missing).');
  }
  if (input.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `Unsupported backup formatVersion ${String(input.formatVersion)} (supported: ${BACKUP_FORMAT_VERSION}).`,
    );
  }
  const { tables, counts, schemaVersion } = input;
  if (!isRecord(tables) || !isRecord(counts) || typeof schemaVersion !== 'number') {
    throw new BackupFormatError('Backup is incomplete (tables, counts or schemaVersion missing).');
  }
  for (const [name, table] of Object.entries(tables)) {
    if (!isRecord(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
      throw new BackupFormatError(`Table "${name}" is malformed.`);
    }
    if (counts[name] !== table.rows.length) {
      throw new BackupFormatError(
        `Row count mismatch for "${name}": header says ${String(counts[name])}, file has ${table.rows.length}.`,
      );
    }
    const width = table.columns.length;
    if (table.rows.some((row) => !Array.isArray(row) || row.length !== width)) {
      throw new BackupFormatError(`Table "${name}" has a row that does not match its columns.`);
    }
  }
  const doc = input as unknown as BackupDocument;
  if (tablesSha256(doc.tables) !== input.sha256) {
    throw new BackupFormatError('Checksum mismatch: the backup file is corrupt or was modified.');
  }
  return doc;
}

// ---- value encoding -------------------------------------------------------

export function encodeBinary(buf: Buffer): { $base64: string } {
  return { $base64: buf.toString('base64') };
}

function isBase64Marker(v: unknown): v is { $base64: string } {
  return isRecord(v) && Object.keys(v).length === 1 && typeof v.$base64 === 'string';
}

function isJsonNullMarker(v: unknown): boolean {
  return isRecord(v) && Object.keys(v).length === 1 && v.$jsonNull === true;
}

/** Wraps a parsed JSON column value so a JSON literal null differs from SQL NULL. */
export function encodeJsonColumn(text: string | null): unknown {
  if (text === null) return null;
  const parsed: unknown = JSON.parse(text);
  return parsed === null ? { $jsonNull: true } : parsed;
}

/** Turns a backup cell back into a value to bind in an INSERT. */
export function decodeCell(type: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'json') return isJsonNullMarker(value) ? 'null' : JSON.stringify(value);
  if (isBase64Marker(value)) return Buffer.from(value.$base64, 'base64');
  return value;
}
