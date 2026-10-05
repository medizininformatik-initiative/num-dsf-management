/**
 * backup-format.test.ts – JSON backup document: streaming serialization,
 * checksum / count / version verification, value encoding (dates, JSON, binary)
 * and AES-256-GCM file encryption. Pure, no database.
 * Dependencies: lib/backupFormat, lib/backupCrypto
 */
import { Readable } from 'stream';
import {
  BACKUP_FORMAT,
  BackupColumn,
  TableSource,
  decodeCell,
  encodeBinary,
  encodeJsonColumn,
  serializeBackup,
  tablesSha256,
  verifyBackupDocument,
} from '../lib/backupFormat';
import {
  createEncryptStream,
  decryptBackup,
  isEncryptedBackup,
  readBackupKey,
} from '../lib/backupCrypto';

const META = { createdAt: '2026-10-05T10:00:00.000Z', appVersion: '1.0.0', schemaVersion: 28 };

async function* rowsOf(rows: unknown[][]): AsyncGenerator<unknown[]> {
  for (const r of rows) yield r;
}

async function* sources(tables: Array<[string, BackupColumn[], unknown[][]]>) {
  for (const [name, columns, rows] of tables) {
    const t: TableSource = { name, columns, rows: rowsOf(rows) };
    yield t;
  }
}

async function build(tables: Array<[string, BackupColumn[], unknown[][]]>): Promise<string> {
  let out = '';
  for await (const chunk of serializeBackup(META, sources(tables))) out += chunk;
  return out;
}

const COLS: BackupColumn[] = [
  { name: 'id', type: 'char' },
  { name: 'at', type: 'datetime' },
  { name: 'data', type: 'json' },
  { name: 'blob', type: 'longblob' },
];
const ROWS: unknown[][] = [
  ['a1', '2026-10-05 10:00:00.123', { k: [1, 2] }, encodeBinary(Buffer.from([0, 255, 10]))],
  ['a2', null, null, null],
  ['b "quoted"   emoji \u{1F600}', '2026-01-01 00:00:00.000', { $jsonNull: true }, null],
];

describe('serializeBackup / verifyBackupDocument', () => {
  it('writes a document whose checksum and counts verify, including empty tables', async () => {
    const text = await build([
      ['things', COLS, ROWS],
      ['empty_table', [{ name: 'id', type: 'int' }], []],
    ]);
    const doc = verifyBackupDocument(JSON.parse(text));
    expect(doc.format).toBe(BACKUP_FORMAT);
    expect(doc.formatVersion).toBe(1);
    expect(doc.schemaVersion).toBe(28);
    expect(doc.counts).toEqual({ things: 3, empty_table: 0 });
    expect(doc.tables.things.rows).toEqual(ROWS);
    expect(doc.sha256).toBe(tablesSha256(doc.tables));
  });

  it('handles a document without any table', async () => {
    const doc = verifyBackupDocument(JSON.parse(await build([])));
    expect(doc.counts).toEqual({});
  });

  it('rejects a modified cell (checksum mismatch)', async () => {
    const parsed = JSON.parse(await build([['things', COLS, ROWS]]));
    parsed.tables.things.rows[0][0] = 'tampered';
    expect(() => verifyBackupDocument(parsed)).toThrow(/Checksum mismatch/);
  });

  it('rejects a removed row (count mismatch)', async () => {
    const parsed = JSON.parse(await build([['things', COLS, ROWS]]));
    parsed.tables.things.rows.pop();
    expect(() => verifyBackupDocument(parsed)).toThrow(/Row count mismatch/);
  });

  it('rejects a row that does not match the columns', async () => {
    const parsed = JSON.parse(await build([['things', COLS, ROWS]]));
    parsed.tables.things.rows[1] = ['only-one'];
    expect(() => verifyBackupDocument(parsed)).toThrow(/does not match its columns/);
  });

  it('rejects foreign files and unsupported format versions', async () => {
    expect(() => verifyBackupDocument({ hello: 'world' })).toThrow(/Not a DSF Allow List backup/);
    expect(() => verifyBackupDocument(null)).toThrow(/Not a DSF Allow List backup/);
    const parsed = JSON.parse(await build([]));
    parsed.formatVersion = 2;
    expect(() => verifyBackupDocument(parsed)).toThrow(/Unsupported backup formatVersion 2/);
  });
});

describe('value encoding', () => {
  it('round-trips binary through the base64 marker', () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const decoded = decodeCell('longblob', JSON.parse(JSON.stringify(encodeBinary(bytes))));
    expect(Buffer.isBuffer(decoded)).toBe(true);
    expect((decoded as Buffer).equals(bytes)).toBe(true);
  });

  it('keeps SQL NULL and a JSON literal null apart', () => {
    expect(encodeJsonColumn(null)).toBeNull();
    expect(encodeJsonColumn('null')).toEqual({ $jsonNull: true });
    expect(decodeCell('json', null)).toBeNull();
    expect(decodeCell('json', { $jsonNull: true })).toBe('null');
  });

  it('binds JSON columns as JSON text, also when the value looks like a base64 marker', () => {
    expect(decodeCell('json', { a: [1, { b: 'x' }] })).toBe('{"a":[1,{"b":"x"}]}');
    expect(decodeCell('json', { $base64: 'AAE=' })).toBe('{"$base64":"AAE="}');
  });

  it('passes datetimes, strings and numbers through unchanged', () => {
    expect(decodeCell('datetime', '2026-10-05 10:00:00.123')).toBe('2026-10-05 10:00:00.123');
    expect(decodeCell('varchar', 'Müller \u{1F600}')).toBe('Müller \u{1F600}');
    expect(decodeCell('bigint', '9007199254740993')).toBe('9007199254740993');
    expect(decodeCell('tinyint', 1)).toBe(1);
    expect(decodeCell('varchar', undefined)).toBeNull();
  });
});

describe('backup file encryption', () => {
  const key = Buffer.alloc(32, 7);

  async function encrypt(plain: Buffer): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const enc = createEncryptStream(key);
    // Several small writes: the header must be emitted exactly once.
    const src = Readable.from([plain.subarray(0, 5), plain.subarray(5)]);
    for await (const c of src.pipe(enc)) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  it('round-trips and is recognizable as encrypted', async () => {
    const plain = Buffer.from('{"format":"dsf-allowlist-backup"} and some more text');
    const file = await encrypt(plain);
    expect(isEncryptedBackup(file)).toBe(true);
    expect(file.includes(plain)).toBe(false);
    expect(decryptBackup(file, key).equals(plain)).toBe(true);
  });

  it('refuses a wrong key and a modified file', async () => {
    const file = await encrypt(Buffer.from('secret backup content'));
    expect(() => decryptBackup(file, Buffer.alloc(32, 9))).toThrow(/Decryption failed/);
    const flipped = Buffer.from(file);
    flipped[flipped.length - 20] ^= 0xff;
    expect(() => decryptBackup(flipped, key)).toThrow(/Decryption failed/);
  });

  it('reads the key from a 64-hex-character value only', () => {
    expect(readBackupKey(undefined)).toBeNull();
    expect(readBackupKey('')).toBeNull();
    expect(readBackupKey('ab'.repeat(32))?.length).toBe(32);
    expect(() => readBackupKey('too-short')).toThrow(/64 hex/);
  });
});
