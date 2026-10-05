/**
 * backup.service.ts – application backups on the server: settings, running a
 * dump (scheduled or on demand), run history, retention and file access.
 *
 * Files land in BACKUP_DIR (default /backups, a docker volume, never exposed
 * over a port), mode 0600 in a 0700 directory, written to a temp file and moved
 * into place atomically. A Redis lock (backup:lock) keeps several backend
 * instances from dumping at once. Backup content is never logged.
 * Dependencies: db/connection, redis.service, audit.service,
 *               backup-dump.service, lib/backupSchedule, lib/backupCrypto
 */
import cron from 'node-cron';
import { randomUUID } from 'crypto';
import { createReadStream, readFileSync } from 'fs';
import { chmod, mkdir, readdir, rename, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { db } from '../db/connection';
import { redis } from './redis.service';
import { writeAuditLog } from './audit.service';
import { logger } from '../lib/logger';
import { errCode, errMessage } from '../lib/errMessage';
import { readBackupKey } from '../lib/backupCrypto';
import {
  BackupMode,
  backupFileName,
  isBackupDue,
  isSafeBackupFileName,
  selectRunsToPrune,
} from '../lib/backupSchedule';
import { writeBackupFile } from './backup-dump.service';

const LOCK_KEY = 'backup:lock';
const LOCK_TTL_S = 3600;
const STALE_TMP_MS = 6 * 3_600_000;
const SYSTEM_USER = 'SYSTEM:backup';

export interface BackupSettings {
  enabled: boolean;
  mode: BackupMode;
  dailyTime: string;
  retentionCount: number;
  updatedBy: string | null;
  updatedAt: Date | null;
}

export interface BackupRun {
  id: string;
  startedAt: Date;
  finishedAt: Date;
  trigger: 'SCHEDULED' | 'MANUAL';
  triggeredBy: string | null;
  status: 'SUCCESS' | 'FAILED';
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  encrypted: boolean;
  durationMs: number;
  error: string | null;
  fileDeleted: boolean;
}

interface RunRow {
  id: string;
  started_at: Date;
  finished_at: Date;
  trigger_type: 'SCHEDULED' | 'MANUAL';
  triggered_by: string | null;
  status: 'SUCCESS' | 'FAILED';
  file_name: string | null;
  size_bytes: number | string | null;
  sha256: string | null;
  encrypted: number;
  duration_ms: number;
  error: string | null;
  file_deleted: number;
}

export function backupDir(): string {
  return process.env.BACKUP_DIR || '/backups';
}

/** Message of any thrown value, with the errno code as a fallback. */
function describeError(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message) return message;
  return errCode(err) || 'Unknown error';
}

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function toRun(r: RunRow): BackupRun {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    trigger: r.trigger_type,
    triggeredBy: r.triggered_by,
    status: r.status,
    fileName: r.file_name,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    sha256: r.sha256,
    encrypted: !!r.encrypted,
    durationMs: r.duration_ms,
    error: r.error,
    fileDeleted: !!r.file_deleted,
  };
}

// ---- settings ---------------------------------------------------------------

export async function getSettings(): Promise<BackupSettings> {
  const row = await db('backup_settings').where({ id: 1 }).first();
  return {
    enabled: row ? !!row.enabled : true,
    mode: row?.mode ?? 'DAILY',
    dailyTime: row?.daily_time ?? '02:30',
    retentionCount: row?.retention_count ?? 14,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function updateSettings(
  input: Pick<BackupSettings, 'enabled' | 'mode' | 'dailyTime' | 'retentionCount'>,
  by: string,
  ip?: string,
): Promise<BackupSettings> {
  const before = await getSettings();
  await db('backup_settings')
    .insert({
      id: 1,
      enabled: input.enabled,
      mode: input.mode,
      daily_time: input.dailyTime,
      retention_count: input.retentionCount,
      updated_by: by,
      updated_at: new Date(),
    })
    .onConflict('id')
    .merge();
  await writeAuditLog({
    userEmail: by,
    resourceType: 'BACKUP',
    resourceId: 'settings',
    operation: 'UPDATE',
    diffJson: {
      before: {
        enabled: before.enabled,
        mode: before.mode,
        dailyTime: before.dailyTime,
        retentionCount: before.retentionCount,
      },
      after: input,
    },
    ipAddress: ip,
  });
  return getSettings();
}

// ---- runs -------------------------------------------------------------------

export async function listRuns(limit = 100): Promise<BackupRun[]> {
  const rows: RunRow[] = await db('backup_runs').orderBy('started_at', 'desc').limit(limit);
  return rows.map(toRun);
}

export async function getRun(id: string): Promise<BackupRun | null> {
  const row: RunRow | undefined = await db('backup_runs').where({ id }).first();
  return row ? toRun(row) : null;
}

async function ensureBackupDir(): Promise<string> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
  return dir;
}

async function acquireLock(token: string): Promise<boolean> {
  return (await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_S, 'NX')) === 'OK';
}

async function releaseLock(token: string): Promise<void> {
  const script =
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
  await redis.eval(script, 1, LOCK_KEY, token);
}

export interface RunBackupOptions {
  trigger: 'SCHEDULED' | 'MANUAL';
  userEmail?: string;
  ip?: string;
}

/** Creates a backup now. Throws BACKUP_BUSY when another run holds the lock. */
export async function runBackup(opts: RunBackupOptions): Promise<BackupRun> {
  const token = randomUUID();
  if (!(await acquireLock(token))) throw new Error('BACKUP_BUSY');
  const id = randomUUID();
  const startedAt = new Date();
  const key = readBackupKey();
  const fileName = backupFileName(startedAt, id, !!key);
  let dir = backupDir();
  let tmpPath: string | null = null;
  try {
    dir = await ensureBackupDir();
    tmpPath = join(dir, `.${fileName}.tmp`);
    const dump = await writeBackupFile(tmpPath, { appVersion: appVersion(), encryptionKey: key });
    await chmod(tmpPath, 0o600);
    await rename(tmpPath, join(dir, fileName));
    tmpPath = null;
    const run = await recordRun({
      id,
      startedAt,
      opts,
      status: 'SUCCESS',
      fileName,
      sizeBytes: dump.sizeBytes,
      sha256: dump.fileSha256,
      encrypted: !!key,
    });
    await pruneBackups().catch((err) =>
      logger.error({ err: errMessage(err) }, '[backup] retention pruning failed'),
    );
    return run;
  } catch (err) {
    if (tmpPath) await unlink(tmpPath).catch(() => undefined);
    logger.error({ err: errMessage(err) }, '[backup] backup failed');
    await recordRun({
      id,
      startedAt,
      opts,
      status: 'FAILED',
      encrypted: !!key,
      error: describeError(err),
    }).catch((e) => logger.error({ err: errMessage(e) }, '[backup] could not record failed run'));
    throw err;
  } finally {
    await releaseLock(token).catch(() => undefined);
  }
}

async function recordRun(p: {
  id: string;
  startedAt: Date;
  opts: RunBackupOptions;
  status: 'SUCCESS' | 'FAILED';
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  encrypted: boolean;
  error?: string;
}): Promise<BackupRun> {
  const finishedAt = new Date();
  const row = {
    id: p.id,
    started_at: p.startedAt,
    finished_at: finishedAt,
    trigger_type: p.opts.trigger,
    triggered_by: p.opts.userEmail ?? null,
    status: p.status,
    file_name: p.fileName ?? null,
    size_bytes: p.sizeBytes ?? null,
    sha256: p.sha256 ?? null,
    encrypted: p.encrypted,
    duration_ms: finishedAt.getTime() - p.startedAt.getTime(),
    error: p.error ? p.error.slice(0, 1000) : null,
    file_deleted: false,
  };
  await db('backup_runs').insert(row);
  await writeAuditLog({
    userEmail: p.opts.userEmail ?? SYSTEM_USER,
    resourceType: 'BACKUP',
    resourceId: p.id,
    operation: 'CREATE',
    diffJson: {
      trigger: p.opts.trigger,
      status: p.status,
      fileName: row.file_name,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      error: row.error,
    },
    ipAddress: p.opts.ip,
  });
  return toRun(row as unknown as RunRow);
}

// ---- retention --------------------------------------------------------------

/** Deletes files beyond the retention count and stale temp files; keeps the run rows. */
export async function pruneBackups(): Promise<number> {
  const { retentionCount } = await getSettings();
  const dir = backupDir();
  const rows: Array<{ id: string; file_name: string | null; started_at: Date }> = await db(
    'backup_runs',
  )
    .where({ status: 'SUCCESS', file_deleted: 0 })
    .select('id', 'file_name', 'started_at');
  const stale = selectRunsToPrune(rows, retentionCount);
  for (const run of stale) {
    if (run.file_name && isSafeBackupFileName(run.file_name)) {
      await unlink(join(dir, run.file_name)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
    }
    await db('backup_runs').where({ id: run.id }).update({ file_deleted: true });
  }
  await removeStaleTempFiles(dir);
  return stale.length;
}

async function removeStaleTempFiles(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    if (!/^\.dsf-allowlist-backup-.*\.tmp$/.test(name)) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (info && Date.now() - info.mtimeMs > STALE_TMP_MS)
      await unlink(join(dir, name)).catch(() => undefined);
  }
}

// ---- download ---------------------------------------------------------------

export async function openBackupFile(
  run: BackupRun,
): Promise<{ stream: NodeJS.ReadableStream; size: number; fileName: string } | null> {
  if (run.status !== 'SUCCESS' || run.fileDeleted || !run.fileName) return null;
  if (!isSafeBackupFileName(run.fileName)) return null;
  const path = join(backupDir(), run.fileName);
  const info = await stat(path).catch(() => null);
  if (!info) return null;
  return { stream: createReadStream(path), size: info.size, fileName: run.fileName };
}

// ---- scheduler --------------------------------------------------------------

let tickRunning = false;

/** Runs a scheduled backup when one is due. Called once a minute. */
export async function runScheduledBackupIfDue(now = new Date()): Promise<BackupRun | null> {
  if (tickRunning) return null;
  tickRunning = true;
  try {
    const settings = await getSettings();
    if (!settings.enabled) return null;
    const success = await db('backup_runs')
      .where({ status: 'SUCCESS' })
      .max({ at: 'started_at' })
      .first();
    const failure = await db('backup_runs')
      .where({ status: 'FAILED' })
      .max({ at: 'finished_at' })
      .first();
    const lastSuccess = success?.at ? new Date(success.at) : null;
    const lastFailureRaw = failure?.at ? new Date(failure.at) : null;
    const lastFailure =
      lastFailureRaw && (!lastSuccess || lastFailureRaw > lastSuccess) ? lastFailureRaw : null;
    if (!isBackupDue(settings, lastSuccess, lastFailure, now)) return null;
    try {
      return await runBackup({ trigger: 'SCHEDULED' });
    } catch (err) {
      if (errMessage(err) !== 'BACKUP_BUSY') {
        logger.error({ err: errMessage(err) }, '[backup] scheduled backup failed');
      }
      return null;
    }
  } finally {
    tickRunning = false;
  }
}

export function startBackupScheduler(): void {
  // The tick runs every minute; due times (Europe/Berlin) are computed in
  // lib/backupSchedule, so the cron timezone only matches the other jobs.
  cron.schedule(
    '* * * * *',
    () => {
      runScheduledBackupIfDue().catch((err) =>
        logger.error({ err: errMessage(err) }, '[backup] scheduler tick failed'),
      );
    },
    { timezone: 'UTC' },
  );
}
