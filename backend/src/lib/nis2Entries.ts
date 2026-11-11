/**
 * nis2Entries.ts – The NIS2 stages of an incident as the API shows them, in
 * the order of BSIG § 32: due date (null for the interim report, which the BSI
 * requests, and for a final report that waits for the closure), "provisional"
 * flag, who reported when, and the structured report fields for callers who
 * may see them. The progress report only appears once it is due.
 * Pure: no database. Dependencies: lib/nis2Deadlines, schemas/nis2Report.schema (types).
 */
import {
  NIS2_COLUMNS,
  NIS2_STAGES,
  finalReportSchedule,
  nis2DueAt,
  type Nis2Stage,
} from './nis2Deadlines';
import { NIS2_DATA_KEY, type Nis2Data, type Nis2FieldStage } from '../schemas/nis2Report.schema';

/** The incident columns the stages are built from. */
export interface Nis2Row {
  detected_at: Date;
  closed_at: Date | null;
  bsi_notification_at: Date | null;
  bsi_progress_at: Date | null;
  bsi_interim_requested_at: Date | null;
  bsi_interim_requested_by: string | null;
  nis2_data: unknown;
}

export interface Nis2Entry {
  stage: Nis2Stage;
  dueAt: Date | null;
  /** Final report only: counted from the 72 h deadline until the notification is ticked. */
  provisional: boolean;
  reportedAt: Date | null;
  reportedBy: string | null;
  /** Interim report only: when the BSI asked for it, and who recorded the request. */
  requestedAt?: Date | null;
  requestedBy?: string | null;
  /** Report fields; null for callers who may not see them and for stages without fields. */
  fields: Record<string, string> | null;
}

/** The stage whose fields a stage shows (the progress report shares the final report's). */
export const FIELD_STAGE: Partial<Record<Nis2Stage, Nis2FieldStage>> = {
  EARLY_WARNING: 'EARLY_WARNING',
  NOTIFICATION: 'NOTIFICATION',
  PROGRESS_REPORT: 'FINAL_REPORT',
  FINAL_REPORT: 'FINAL_REPORT',
};

/** incidents.nis2_data as an object (the driver returns JSON columns parsed or as text). */
export function parseNis2Data(raw: unknown): Nis2Data {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Nis2Data) : {};
}

export function stageFields(raw: unknown, stage: Nis2FieldStage): Record<string, string> {
  return { ...(parseNis2Data(raw)[NIS2_DATA_KEY[stage]] ?? {}) } as Record<string, string>;
}

/** Final report / progress report schedule of an incident row at `now`. */
export function nis2ScheduleOf(row: Nis2Row, now: Date) {
  return finalReportSchedule({
    detectedAt: new Date(row.detected_at),
    notificationAt: row.bsi_notification_at,
    progressAt: row.bsi_progress_at,
    closedAt: row.closed_at,
    now,
  });
}

export function buildNis2Entries(
  row: Nis2Row & Record<string, unknown>,
  opts: { now: Date; canSeeFields: boolean; actor: (email: string | null) => string | null },
): Nis2Entry[] {
  const detectedAt = new Date(row.detected_at);
  const schedule = nis2ScheduleOf(row, opts.now);
  const dueOf = (stage: Nis2Stage): Date | null => {
    if (stage === 'EARLY_WARNING' || stage === 'NOTIFICATION') return nis2DueAt(stage, detectedAt);
    if (stage === 'PROGRESS_REPORT') return schedule.progressDueAt;
    if (stage === 'FINAL_REPORT') return schedule.dueAt;
    return null;
  };
  return NIS2_STAGES.filter((s) => s !== 'PROGRESS_REPORT' || schedule.progressVisible).map(
    (stage) => {
      const cols = NIS2_COLUMNS[stage];
      const fieldStage = FIELD_STAGE[stage];
      return {
        stage,
        dueAt: dueOf(stage),
        provisional: stage === 'FINAL_REPORT' && schedule.provisional,
        reportedAt: (row[cols.at] as Date | null) ?? null,
        reportedBy: opts.actor((row[cols.by] as string | null) ?? null),
        ...(stage === 'INTERIM_REPORT'
          ? {
              requestedAt: row.bsi_interim_requested_at,
              requestedBy: opts.actor(row.bsi_interim_requested_by),
            }
          : {}),
        fields: opts.canSeeFields && fieldStage ? stageFields(row.nis2_data, fieldStage) : null,
      };
    },
  );
}
