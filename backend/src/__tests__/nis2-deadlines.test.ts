/**
 * nis2-deadlines.test.ts – NIS2 deadlines from the detection time: 24 h, 72 h
 * and one calendar month, clamped to the end of a shorter month.
 * Pure test: no database.
 * Dependencies: lib/nis2Deadlines
 */
import { nis2DueAt } from '../lib/nis2Deadlines';

const at = (iso: string) => new Date(iso);

describe('nis2DueAt', () => {
  const detected = at('2026-11-10T08:30:00.000Z');

  it('puts the early warning 24 hours after detection', () => {
    expect(nis2DueAt('EARLY_WARNING', detected).toISOString()).toBe('2026-11-11T08:30:00.000Z');
  });

  it('puts the notification 72 hours after detection', () => {
    expect(nis2DueAt('NOTIFICATION', detected).toISOString()).toBe('2026-11-13T08:30:00.000Z');
  });

  it('puts the final report one calendar month after detection', () => {
    expect(nis2DueAt('FINAL_REPORT', detected).toISOString()).toBe('2026-12-10T08:30:00.000Z');
    expect(nis2DueAt('FINAL_REPORT', at('2026-12-15T10:00:00.000Z')).toISOString()).toBe(
      '2027-01-15T10:00:00.000Z',
    );
  });

  it('clamps the final report to the last day of a shorter month', () => {
    expect(nis2DueAt('FINAL_REPORT', at('2027-01-31T10:00:00.000Z')).toISOString()).toBe(
      '2027-02-28T10:00:00.000Z',
    );
  });
});
