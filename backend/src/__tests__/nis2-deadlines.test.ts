/**
 * nis2-deadlines.test.ts – NIS2 deadlines: 24 h and 72 h after the "became
 * aware" time, the final report one calendar month after the notification
 * tick (provisionally after the 72 h deadline), clamped to the end of a
 * shorter month.
 * Pure test: no database.
 * Dependencies: lib/nis2Deadlines
 */
import { addCalendarMonth, isFinalReportProvisional, nis2DueAt } from '../lib/nis2Deadlines';

const at = (iso: string) => new Date(iso);

describe('nis2DueAt', () => {
  const detected = at('2026-11-10T08:30:00.000Z');

  it('puts the early warning 24 hours after becoming aware', () => {
    expect(nis2DueAt('EARLY_WARNING', detected).toISOString()).toBe('2026-11-11T08:30:00.000Z');
  });

  it('puts the notification 72 hours after becoming aware', () => {
    expect(nis2DueAt('NOTIFICATION', detected).toISOString()).toBe('2026-11-13T08:30:00.000Z');
  });

  it('puts the final report one calendar month after the notification tick', () => {
    const notified = at('2026-11-12T09:15:00.000Z');
    expect(nis2DueAt('FINAL_REPORT', detected, notified).toISOString()).toBe(
      '2026-12-12T09:15:00.000Z',
    );
  });

  it('counts the provisional final report from the 72 h deadline until the notification is ticked', () => {
    expect(nis2DueAt('FINAL_REPORT', detected).toISOString()).toBe('2026-12-13T08:30:00.000Z');
    expect(nis2DueAt('FINAL_REPORT', detected, null).toISOString()).toBe(
      '2026-12-13T08:30:00.000Z',
    );
    expect(isFinalReportProvisional(null)).toBe(true);
    expect(isFinalReportProvisional(new Date())).toBe(false);
  });

  it('keeps the notification deadline independent of the notification tick', () => {
    const late = at('2026-11-14T00:00:00.000Z');
    expect(nis2DueAt('NOTIFICATION', detected, late).toISOString()).toBe(
      '2026-11-13T08:30:00.000Z',
    );
  });

  it('clamps the final report to the last day of a shorter month', () => {
    expect(nis2DueAt('FINAL_REPORT', detected, at('2027-01-31T10:00:00.000Z')).toISOString()).toBe(
      '2027-02-28T10:00:00.000Z',
    );
    expect(addCalendarMonth(at('2028-01-31T10:00:00.000Z')).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
  });
});
