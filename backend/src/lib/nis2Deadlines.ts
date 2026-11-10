/**
 * nis2Deadlines.ts – NIS2 reporting deadlines of an incident, counted from the
 * time it was detected: early warning after 24 h, notification after 72 h,
 * final report after one calendar month. The portal only shows them and
 * records who ticked "reported to BSI"; the reporting duty stays with the site.
 * Pure: no database. Dependencies: lib/time.
 */
import { HOUR_MS } from './time';

export const NIS2_STAGES = ['EARLY_WARNING', 'NOTIFICATION', 'FINAL_REPORT'] as const;
export type Nis2Stage = (typeof NIS2_STAGES)[number];

/** incidents columns that record the BSI acknowledgement per stage. */
export const NIS2_COLUMNS: Record<Nis2Stage, { at: string; by: string }> = {
  EARLY_WARNING: { at: 'bsi_early_warning_at', by: 'bsi_early_warning_by' },
  NOTIFICATION: { at: 'bsi_notification_at', by: 'bsi_notification_by' },
  FINAL_REPORT: { at: 'bsi_final_report_at', by: 'bsi_final_report_by' },
};

export function nis2DueAt(stage: Nis2Stage, detectedAt: Date): Date {
  if (stage === 'EARLY_WARNING') return new Date(detectedAt.getTime() + 24 * HOUR_MS);
  if (stage === 'NOTIFICATION') return new Date(detectedAt.getTime() + 72 * HOUR_MS);
  const due = new Date(detectedAt.getTime());
  const day = due.getUTCDate();
  due.setUTCDate(1);
  due.setUTCMonth(due.getUTCMonth() + 1);
  // Clamp to the last day of the next month (31 Jan -> 28/29 Feb).
  const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
  due.setUTCDate(Math.min(day, lastDay));
  return due;
}
