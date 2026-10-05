/**
 * backupSchedule.ts – pure scheduling helpers for the application backup:
 * when is the next scheduled dump due, which stored files to prune, and the
 * safe file-name scheme. No I/O. The schedule never allows less than a daily
 * backup (modes: every 6 h, every 12 h, daily at HH:MM Europe/Berlin).
 */

export type BackupMode = 'EVERY_6H' | 'EVERY_12H' | 'DAILY';

export interface BackupScheduleSettings {
  enabled: boolean;
  mode: BackupMode;
  /** HH:MM, Europe/Berlin, used when mode is DAILY. */
  dailyTime: string;
}

export const MIN_RETENTION = 7;
export const MAX_RETENTION = 365;
/** A failed scheduled run is retried after this long. */
export const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

const HOUR_MS = 3_600_000;
const TZ = 'Europe/Berlin';

const berlinFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function berlinFields(utcMs: number): { y: number; m: number; d: number; offsetMs: number } {
  const p: Record<string, number> = {};
  for (const part of berlinFormat.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return { y: p.year, m: p.month, d: p.day, offsetMs: asUtc - Math.floor(utcMs / 1000) * 1000 };
}

/** UTC instant (ms) of the given wall-clock time in Europe/Berlin. */
function berlinWallClockToUtc(y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - berlinFields(guess).offsetMs;
  return guess - berlinFields(first).offsetMs;
}

export function isValidDailyTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The most recent HH:MM Berlin slot at or before `now` (UTC ms). */
export function latestDailySlot(now: Date, dailyTime: string): number {
  const [hh, mm] = dailyTime.split(':').map(Number);
  const today = berlinFields(now.getTime());
  const slot = berlinWallClockToUtc(today.y, today.m, today.d, hh, mm);
  if (slot <= now.getTime()) return slot;
  const yesterday = new Date(Date.UTC(today.y, today.m - 1, today.d - 1));
  return berlinWallClockToUtc(
    yesterday.getUTCFullYear(),
    yesterday.getUTCMonth() + 1,
    yesterday.getUTCDate(),
    hh,
    mm,
  );
}

/**
 * True when a scheduled backup must run now. `lastSuccess` is the start of the
 * newest successful run, `lastFailure` the start of a failure newer than that
 * (a failed run is retried after RETRY_AFTER_FAILURE_MS, not every minute).
 * A slot missed during downtime is caught up as soon as the process is back.
 */
export function isBackupDue(
  settings: BackupScheduleSettings,
  lastSuccess: Date | null,
  lastFailure: Date | null,
  now: Date,
): boolean {
  if (!settings.enabled) return false;
  if (lastFailure && now.getTime() - lastFailure.getTime() < RETRY_AFTER_FAILURE_MS) return false;
  if (!lastSuccess) return true;
  if (settings.mode === 'DAILY') {
    return lastSuccess.getTime() < latestDailySlot(now, settings.dailyTime);
  }
  const interval = (settings.mode === 'EVERY_6H' ? 6 : 12) * HOUR_MS;
  return now.getTime() - lastSuccess.getTime() >= interval;
}

/** IDs of runs beyond the newest `keep` (input in any order). */
export function selectRunsToPrune<T extends { id: string; started_at: Date }>(
  runs: T[],
  keep: number,
): T[] {
  return [...runs]
    .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
    .slice(Math.max(keep, MIN_RETENTION));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** dsf-allowlist-backup-20261005-023000-<id8>.json.gz[.enc] (UTC timestamp). */
export function backupFileName(at: Date, runId: string, encrypted: boolean): string {
  const stamp =
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
  return `dsf-allowlist-backup-${stamp}-${runId.slice(0, 8)}.json.gz${encrypted ? '.enc' : ''}`;
}

const SAFE_NAME = /^dsf-allowlist-backup-\d{8}-\d{6}-[0-9a-f]{8}\.json\.gz(\.enc)?$/;

/** Guards the download/prune paths against traversal: only our own names pass. */
export function isSafeBackupFileName(name: string): boolean {
  return SAFE_NAME.test(name);
}
