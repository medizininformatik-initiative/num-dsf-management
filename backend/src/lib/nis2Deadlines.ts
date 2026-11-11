/**
 * nis2Deadlines.ts – NIS2 reporting deadlines of an incident, counted from the
 * time the site became aware of it (column detected_at): early warning after
 * 24 h, notification after 72 h, final report one calendar month after the
 * notification (BSIG § 32); if it falls due while the incident is still being
 * handled, a progress report is due and the final report follows one month
 * after the closure. The portal only shows them and records who ticked
 * "reported to BSI"; the reporting duty stays with the site.
 * Pure: no database. Dependencies: lib/time.
 */
import { HOUR_MS } from './time';

/** Stages in the order of BSIG § 32. */
export const NIS2_STAGES = [
  'EARLY_WARNING',
  'NOTIFICATION',
  'INTERIM_REPORT',
  'PROGRESS_REPORT',
  'FINAL_REPORT',
] as const;
export type Nis2Stage = (typeof NIS2_STAGES)[number];

/** incidents columns that record the BSI acknowledgement per stage. */
export const NIS2_COLUMNS: Record<Nis2Stage, { at: string; by: string }> = {
  EARLY_WARNING: { at: 'bsi_early_warning_at', by: 'bsi_early_warning_by' },
  NOTIFICATION: { at: 'bsi_notification_at', by: 'bsi_notification_by' },
  INTERIM_REPORT: { at: 'bsi_interim_at', by: 'bsi_interim_by' },
  PROGRESS_REPORT: { at: 'bsi_progress_at', by: 'bsi_progress_by' },
  FINAL_REPORT: { at: 'bsi_final_report_at', by: 'bsi_final_report_by' },
};

/** The same day of the next calendar month, clamped (31 Jan -> 28/29 Feb). */
export function addCalendarMonth(from: Date): Date {
  const due = new Date(from.getTime());
  const day = due.getUTCDate();
  due.setUTCDate(1);
  due.setUTCMonth(due.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
  due.setUTCDate(Math.min(day, lastDay));
  return due;
}

/**
 * Deadline of a stage. The final report is due one calendar month after the
 * 72 h notification: counted from the actual notification tick, provisionally
 * from the 72 h deadline while the notification is still open.
 */
export function nis2DueAt(
  stage: 'EARLY_WARNING' | 'NOTIFICATION' | 'FINAL_REPORT',
  detectedAt: Date,
  notificationAt?: Date | null,
): Date {
  const notificationDue = new Date(detectedAt.getTime() + 72 * HOUR_MS);
  if (stage === 'EARLY_WARNING') return new Date(detectedAt.getTime() + 24 * HOUR_MS);
  if (stage === 'NOTIFICATION') return notificationDue;
  return addCalendarMonth(notificationAt ?? notificationDue);
}

/** The final report date is a forecast until the notification has been ticked. */
export const isFinalReportProvisional = (notificationAt: Date | null | undefined): boolean =>
  !notificationAt;

export interface FinalScheduleInput {
  detectedAt: Date;
  notificationAt: Date | null;
  progressAt: Date | null;
  /** Set when the incident is closed or marked as a false alarm. */
  closedAt: Date | null;
  now: Date;
}

export interface FinalSchedule {
  /** Final report deadline; null while it waits for the incident to be closed. */
  dueAt: Date | null;
  /** True while the date rests on the 72 h deadline, not on a ticked notification. */
  provisional: boolean;
  /** A progress report is due (or was made): the final report fell due while the incident was open. */
  progressVisible: boolean;
  progressDueAt: Date;
}

/**
 * The final report is due one month after the notification. If it falls due
 * while the incident is still being handled, a progress report is due instead
 * and the final report follows one month after the incident is closed.
 */
export function finalReportSchedule(input: FinalScheduleInput): FinalSchedule {
  const { detectedAt, notificationAt, progressAt, closedAt, now } = input;
  const baseDue = nis2DueAt('FINAL_REPORT', detectedAt, notificationAt);
  const closedAfterDue = closedAt !== null && closedAt.getTime() > baseDue.getTime();
  const progressDue = progressAt !== null || closedAfterDue || (!closedAt && now >= baseDue);
  const progressVisible = progressAt !== null || (!closedAt && now >= baseDue);
  if (!progressDue) {
    return {
      dueAt: baseDue,
      provisional: isFinalReportProvisional(notificationAt),
      progressVisible,
      progressDueAt: baseDue,
    };
  }
  return {
    dueAt: closedAt ? addCalendarMonth(closedAt) : null,
    provisional: false,
    progressVisible,
    progressDueAt: baseDue,
  };
}
