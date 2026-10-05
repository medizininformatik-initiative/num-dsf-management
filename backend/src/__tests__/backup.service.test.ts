/**
 * backup.service.test.ts – DB + Redis backed: a manual backup run (file mode,
 * checksum, run row, audit entry, lock release), the failure path, the Redis
 * lock, encrypted runs, retention pruning of real files, and the scheduled
 * due-check. BACKUP_DIR points to a temp directory.
 * Dependencies: backup.service, db/connection, redis.service, lib/backupFormat
 */
import { mkdtemp, rm, writeFile, readFile, stat, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { db } from '../db/connection';
import { redis } from '../services/redis.service';
import { loadBackupFile } from '../services/backup-restore.service';
import {
  getSettings,
  listRuns,
  pruneBackups,
  runBackup,
  runScheduledBackupIfDue,
  updateSettings,
} from '../services/backup.service';

const ADMIN = `bk-admin-${Date.now()}@example.de`;
let dir: string;
let original: Awaited<ReturnType<typeof getSettings>>;

beforeAll(async () => {
  original = await getSettings();
  dir = await mkdtemp(join(tmpdir(), 'bk-svc-'));
  process.env.BACKUP_DIR = dir;
});

afterAll(async () => {
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  await db('backup_runs').where({ triggered_by: ADMIN }).del();
  await db('backup_runs').where('id', 'like', 'bkt-%').del();
  await db('audit_logs').where({ user_email: ADMIN }).del();
  await updateSettings(
    {
      enabled: original.enabled,
      mode: original.mode,
      dailyTime: original.dailyTime,
      retentionCount: original.retentionCount,
    },
    ADMIN,
  );
  await db('audit_logs').where({ user_email: ADMIN }).del();
  await redis.del('backup:lock');
  await rm(dir, { recursive: true, force: true });
});

describe('runBackup', () => {
  it('writes a verified 0600 file, records the run and audits it', async () => {
    const run = await runBackup({ trigger: 'MANUAL', userEmail: ADMIN });
    expect(run.status).toBe('SUCCESS');
    expect(run.fileName).toMatch(/^dsf-allowlist-backup-\d{8}-\d{6}-[0-9a-f]{8}\.json\.gz$/);
    const path = join(dir, run.fileName!);
    const bytes = await readFile(path);
    expect(run.sizeBytes).toBe(bytes.length);
    expect(run.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    const doc = await loadBackupFile(path, null);
    expect(Object.keys(doc.tables)).toEqual(expect.arrayContaining(['users', 'backup_runs']));
    expect((await listRuns()).some((r) => r.id === run.id)).toBe(true);
    const audit = await db('audit_logs')
      .where({ user_email: ADMIN, resource_type: 'BACKUP', resource_id: run.id })
      .first();
    expect(audit?.operation).toBe('CREATE');
    expect(await redis.get('backup:lock')).toBeNull();
    // No temp file is left behind.
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a parallel run while the lock is held', async () => {
    await redis.set('backup:lock', 'someone-else', 'EX', 60);
    await expect(runBackup({ trigger: 'MANUAL', userEmail: ADMIN })).rejects.toThrow('BACKUP_BUSY');
    expect(await redis.get('backup:lock')).toBe('someone-else');
    await redis.del('backup:lock');
  });

  it('records a failed run when the directory is unusable', async () => {
    const blocker = join(dir, 'not-a-dir');
    await writeFile(blocker, 'x');
    process.env.BACKUP_DIR = join(blocker, 'sub');
    try {
      await expect(runBackup({ trigger: 'MANUAL', userEmail: ADMIN })).rejects.toThrow();
    } finally {
      process.env.BACKUP_DIR = dir;
    }
    const failed = (await listRuns()).find((r) => r.triggeredBy === ADMIN && r.status === 'FAILED');
    expect(failed?.error).toBeTruthy();
    expect(failed?.fileName).toBeNull();
    expect(await redis.get('backup:lock')).toBeNull();
  });

  it('encrypts the file when BACKUP_ENCRYPTION_KEY is set', async () => {
    const hex = 'cd'.repeat(32);
    process.env.BACKUP_ENCRYPTION_KEY = hex;
    try {
      const run = await runBackup({ trigger: 'MANUAL', userEmail: ADMIN });
      expect(run.encrypted).toBe(true);
      expect(run.fileName).toMatch(/\.json\.gz\.enc$/);
      const path = join(dir, run.fileName!);
      await expect(loadBackupFile(path, null)).rejects.toThrow(/BACKUP_ENCRYPTION_KEY/);
      const doc = await loadBackupFile(path, Buffer.from(hex, 'hex'));
      expect(doc.tables.users).toBeDefined();
    } finally {
      delete process.env.BACKUP_ENCRYPTION_KEY;
    }
  });
});

describe('retention pruning', () => {
  it('deletes files beyond the retention count and keeps the run rows', async () => {
    await updateSettings(
      { enabled: false, mode: 'DAILY', dailyTime: '02:30', retentionCount: 7 },
      ADMIN,
    );
    const names: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const day = String(i).padStart(2, '0');
      const name = `dsf-allowlist-backup-209901${day}-000000-0000000${i % 10}.json.gz`;
      names.push(name);
      await writeFile(join(dir, name), 'x');
      await db('backup_runs').insert({
        id: `bkt-${Date.now()}-${i}`,
        started_at: new Date(Date.UTC(2099, 0, i)),
        finished_at: new Date(Date.UTC(2099, 0, i)),
        trigger_type: 'SCHEDULED',
        status: 'SUCCESS',
        file_name: name,
        size_bytes: 1,
        sha256: 'a'.repeat(64),
        encrypted: 0,
        duration_ms: 1,
        file_deleted: 0,
      });
    }
    const pruned = await pruneBackups();
    expect(pruned).toBeGreaterThanOrEqual(3);
    const left = await readdir(dir);
    for (const old of names.slice(0, 3)) expect(left).not.toContain(old);
    for (const kept of names.slice(3)) expect(left).toContain(kept);
    const rows = await db('backup_runs').whereIn('file_name', names.slice(0, 3));
    expect(rows.every((r) => !!r.file_deleted)).toBe(true);
  });
});

describe('runScheduledBackupIfDue', () => {
  it('does nothing while disabled', async () => {
    await updateSettings(
      { enabled: false, mode: 'DAILY', dailyTime: '02:30', retentionCount: 14 },
      ADMIN,
    );
    expect(await runScheduledBackupIfDue()).toBeNull();
  });

  it('does nothing when the newest success is current', async () => {
    await updateSettings(
      { enabled: true, mode: 'EVERY_12H', dailyTime: '02:30', retentionCount: 14 },
      ADMIN,
    );
    // The rows inserted above start in 2099, so the newest success is "in the future".
    expect(await runScheduledBackupIfDue()).toBeNull();
  });
});
