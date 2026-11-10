/**
 * nis2.test.ts — the NIS2 deadline state (reported, overdue, due soon, open)
 * and the day/hour/minute split used by the countdown.
 */
import { describe, it, expect } from 'vitest';
import { nis2State, splitDuration, NIS2_SOON_MS } from '../nis2';
import type { Nis2Entry } from '../../api/incidents.api';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const entry = (dueAt: string, reportedAt: string | null = null): Nis2Entry => ({
  stage: 'EARLY_WARNING',
  dueAt,
  reportedAt,
  reportedBy: reportedAt ? 'site@example.org' : null,
});

describe('nis2State', () => {
  it('is reported once a report time is set, even after the deadline', () => {
    expect(nis2State(entry('2026-11-09T12:00:00Z', '2026-11-10T08:00:00Z'), NOW)).toEqual({
      kind: 'reported',
      at: '2026-11-10T08:00:00Z',
      by: 'site@example.org',
    });
  });

  it('is overdue after the deadline, with the time past it', () => {
    expect(nis2State(entry('2026-11-10T11:00:00Z'), NOW)).toEqual({
      kind: 'overdue',
      ms: 3_600_000,
    });
  });

  it('is due soon inside the last six hours', () => {
    const state = nis2State(entry(new Date(NOW + NIS2_SOON_MS - 1).toISOString()), NOW);
    expect(state.kind).toBe('soon');
  });

  it('is open with more than six hours left', () => {
    const state = nis2State(entry('2026-11-12T12:00:00Z'), NOW);
    expect(state).toEqual({ kind: 'open', ms: 2 * 86_400_000 });
  });
});

describe('splitDuration', () => {
  it('splits into days, hours and minutes, rounding minutes up', () => {
    expect(splitDuration(86_400_000 + 2 * 3_600_000 + 30_001)).toEqual({
      days: 1,
      hours: 2,
      minutes: 1,
    });
  });

  it('never shows zero minutes for a running deadline', () => {
    expect(splitDuration(0)).toEqual({ days: 0, hours: 0, minutes: 1 });
  });
});
