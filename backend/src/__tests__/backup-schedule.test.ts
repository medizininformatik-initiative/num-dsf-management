/**
 * backup-schedule.test.ts – when a scheduled backup is due (interval modes and
 * the daily Europe/Berlin slot across winter and summer time), retention
 * selection, and the safe file-name scheme. Pure, no database.
 * Dependencies: lib/backupSchedule, lib/backupFormat
 */
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  BackupScheduleSettings,
  RETRY_AFTER_FAILURE_MS,
  backupFileName,
  isBackupDue,
  isSafeBackupFileName,
  isValidDailyTime,
  latestDailySlot,
  selectRunsToPrune,
} from '../lib/backupSchedule';
import { SCHEMA_VERSION } from '../lib/backupFormat';

const daily = (dailyTime = '02:30', enabled = true): BackupScheduleSettings => ({
  enabled,
  mode: 'DAILY',
  dailyTime,
});
const every = (mode: 'EVERY_6H' | 'EVERY_12H'): BackupScheduleSettings => ({
  enabled: true,
  mode,
  dailyTime: '02:30',
});
const at = (iso: string): Date => new Date(iso);

describe('latestDailySlot (Europe/Berlin)', () => {
  it('uses UTC+1 in winter and UTC+2 in summer', () => {
    expect(new Date(latestDailySlot(at('2026-01-15T12:00:00Z'), '02:30')).toISOString()).toBe(
      '2026-01-15T01:30:00.000Z',
    );
    expect(new Date(latestDailySlot(at('2026-07-15T12:00:00Z'), '02:30')).toISOString()).toBe(
      '2026-07-15T00:30:00.000Z',
    );
  });

  it('falls back to yesterday before today’s slot', () => {
    expect(new Date(latestDailySlot(at('2026-07-15T00:00:00Z'), '02:30')).toISOString()).toBe(
      '2026-07-14T00:30:00.000Z',
    );
  });

  it('follows the clock change on the last Sunday of March', () => {
    // 2026-03-29: 02:00 -> 03:00. The day before is still UTC+1, the day after UTC+2.
    expect(new Date(latestDailySlot(at('2026-03-28T12:00:00Z'), '04:00')).toISOString()).toBe(
      '2026-03-28T03:00:00.000Z',
    );
    expect(new Date(latestDailySlot(at('2026-03-30T12:00:00Z'), '04:00')).toISOString()).toBe(
      '2026-03-30T02:00:00.000Z',
    );
  });
});

describe('isBackupDue', () => {
  it('is never due while disabled', () => {
    expect(isBackupDue(daily('02:30', false), null, null, at('2026-10-05T12:00:00Z'))).toBe(false);
  });

  it('is due immediately when no backup exists yet', () => {
    expect(isBackupDue(daily(), null, null, at('2026-10-05T12:00:00Z'))).toBe(true);
    expect(isBackupDue(every('EVERY_6H'), null, null, at('2026-10-05T12:00:00Z'))).toBe(true);
  });

  it('daily: due after the slot, not before the next one', () => {
    const last = at('2026-10-05T00:31:00Z'); // 02:31 Berlin (summer time)
    expect(isBackupDue(daily(), last, null, at('2026-10-05T12:00:00Z'))).toBe(false);
    expect(isBackupDue(daily(), last, null, at('2026-10-06T00:29:00Z'))).toBe(false);
    expect(isBackupDue(daily(), last, null, at('2026-10-06T00:30:00Z'))).toBe(true);
  });

  it('daily: catches up a slot missed during downtime', () => {
    const last = at('2026-10-01T00:31:00Z');
    expect(isBackupDue(daily(), last, null, at('2026-10-05T12:00:00Z'))).toBe(true);
  });

  it('every 6 h / 12 h', () => {
    const last = at('2026-10-05T06:00:00Z');
    expect(isBackupDue(every('EVERY_6H'), last, null, at('2026-10-05T11:59:00Z'))).toBe(false);
    expect(isBackupDue(every('EVERY_6H'), last, null, at('2026-10-05T12:00:00Z'))).toBe(true);
    expect(isBackupDue(every('EVERY_12H'), last, null, at('2026-10-05T17:59:00Z'))).toBe(false);
    expect(isBackupDue(every('EVERY_12H'), last, null, at('2026-10-05T18:00:00Z'))).toBe(true);
  });

  it('retries a failed run only after the retry delay', () => {
    const now = at('2026-10-05T12:00:00Z');
    const failedRecently = new Date(now.getTime() - RETRY_AFTER_FAILURE_MS + 60_000);
    const failedLongAgo = new Date(now.getTime() - RETRY_AFTER_FAILURE_MS - 60_000);
    expect(isBackupDue(daily(), null, failedRecently, now)).toBe(false);
    expect(isBackupDue(daily(), null, failedLongAgo, now)).toBe(true);
  });
});

describe('selectRunsToPrune', () => {
  const runs = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`,
    started_at: new Date(Date.UTC(2026, 0, 1 + i)),
  }));

  it('returns the oldest runs beyond the retention count, in any input order', () => {
    const stale = selectRunsToPrune([...runs].reverse(), 14);
    expect(stale.map((r) => r.id).sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('never keeps fewer than the minimum of 7', () => {
    expect(selectRunsToPrune(runs, 3)).toHaveLength(13);
  });

  it('prunes nothing when within the limit', () => {
    expect(selectRunsToPrune(runs.slice(0, 5), 14)).toEqual([]);
  });
});

describe('file names', () => {
  it('builds a UTC timestamped name and marks encrypted files', () => {
    const when = at('2026-10-05T02:30:09Z');
    const id = 'abcdef12-3456-7890-abcd-ef1234567890';
    expect(backupFileName(when, id, false)).toBe(
      'dsf-allowlist-backup-20261005-023009-abcdef12.json.gz',
    );
    expect(backupFileName(when, id, true)).toBe(
      'dsf-allowlist-backup-20261005-023009-abcdef12.json.gz.enc',
    );
  });

  it('accepts only its own names (path traversal safe)', () => {
    expect(isSafeBackupFileName('dsf-allowlist-backup-20261005-023009-abcdef12.json.gz')).toBe(
      true,
    );
    expect(isSafeBackupFileName('dsf-allowlist-backup-20261005-023009-abcdef12.json.gz.enc')).toBe(
      true,
    );
    for (const bad of [
      '../etc/passwd',
      '..\\x.json.gz',
      'dsf-allowlist-backup-20261005-023009-abcdef12.json.gz/../../x',
      '/backups/dsf-allowlist-backup-20261005-023009-abcdef12.json.gz',
      'other.json.gz',
      '',
    ]) {
      expect(isSafeBackupFileName(bad)).toBe(false);
    }
  });

  it('validates HH:MM times', () => {
    expect(['00:00', '02:30', '23:59'].every(isValidDailyTime)).toBe(true);
    expect(['24:00', '2:30', '02:60', 'ab:cd', ''].some(isValidDailyTime)).toBe(false);
  });
});

describe('SCHEMA_VERSION', () => {
  it('matches the newest file in db/migrations (when the repo is mounted)', () => {
    const dir = join(__dirname, '..', '..', '..', 'db', 'migrations');
    if (!existsSync(dir)) return;
    const newest = Math.max(
      ...readdirSync(dir)
        .map((f) => /^(\d+)_/.exec(f)?.[1])
        .filter((n): n is string => !!n)
        .map(Number),
    );
    expect(SCHEMA_VERSION).toBe(newest);
  });
});
