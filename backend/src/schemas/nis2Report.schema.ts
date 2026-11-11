/**
 * nis2Report.schema.ts – Zod validation of the structured report fields an
 * incident keeps per NIS2 stage (BSIG § 32), used as a form filling aid for
 * the BSI portal:
 *   early warning   suspectedMalicious, crossBorder, affectedServices
 *   notification    severity, impact, iocs (optional)
 *   final/progress  rootCause, mitigation, crossBorderFinal (one set shared by
 *                   the progress report and the final report)
 * A save may be partial (draft); ticking a stage as reported needs the
 * complete set. Texts are trimmed, capped and free of control characters
 * (line breaks and tabs are allowed in the long texts).
 * Dependencies: zod
 */
import { z } from 'zod';

/** Stages that carry fields; the progress report uses the final report's. */
export const NIS2_FIELD_STAGES = ['EARLY_WARNING', 'NOTIFICATION', 'FINAL_REPORT'] as const;
export type Nis2FieldStage = (typeof NIS2_FIELD_STAGES)[number];

/** Key of a stage's fields inside incidents.nis2_data. */
export const NIS2_DATA_KEY = {
  EARLY_WARNING: 'earlyWarning',
  NOTIFICATION: 'notification',
  FINAL_REPORT: 'finalReport',
} as const satisfies Record<Nis2FieldStage, string>;

// eslint-disable-next-line no-control-regex
const SINGLE_LINE_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !SINGLE_LINE_CONTROL.test(v), 'Control characters are not allowed');
const required = (max: number) => text(max).pipe(z.string().min(1));

const triState = z.enum(['yes', 'no', 'unknown']);
export const NIS2_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const shapes = {
  EARLY_WARNING: z.object({
    suspectedMalicious: triState,
    crossBorder: triState,
    affectedServices: required(500),
  }),
  NOTIFICATION: z.object({
    severity: z.enum(NIS2_SEVERITIES),
    impact: required(3000),
    iocs: text(3000).optional(),
  }),
  FINAL_REPORT: z.object({
    rootCause: required(3000),
    mitigation: required(3000),
    crossBorderFinal: triState,
  }),
} as const;

/** Complete field set a stage needs before it can be ticked (iocs stays optional). */
export const nis2CompleteSchema = {
  EARLY_WARNING: shapes.EARLY_WARNING.strict(),
  NOTIFICATION: shapes.NOTIFICATION.strict(),
  FINAL_REPORT: shapes.FINAL_REPORT.strict(),
} as const;

/** A draft save: any subset of the fields; an empty text clears the field. */
export const nis2DraftSchema = {
  EARLY_WARNING: z
    .object({
      suspectedMalicious: triState,
      crossBorder: triState,
      affectedServices: text(500),
    })
    .partial()
    .strict(),
  NOTIFICATION: z
    .object({ severity: z.enum(NIS2_SEVERITIES), impact: text(3000), iocs: text(3000) })
    .partial()
    .strict(),
  FINAL_REPORT: z
    .object({ rootCause: text(3000), mitigation: text(3000), crossBorderFinal: triState })
    .partial()
    .strict(),
} as const;

export type Nis2EarlyWarning = z.infer<typeof nis2DraftSchema.EARLY_WARNING>;
export type Nis2Notification = z.infer<typeof nis2DraftSchema.NOTIFICATION>;
export type Nis2FinalReport = z.infer<typeof nis2DraftSchema.FINAL_REPORT>;

/** Shape of incidents.nis2_data. */
export interface Nis2Data {
  earlyWarning?: Nis2EarlyWarning;
  notification?: Nis2Notification;
  finalReport?: Nis2FinalReport;
}

/** Body of the date a BSI interim report was requested. */
export const interimRequestSchema = z.object({
  requestedAt: z
    .string()
    .datetime({ offset: true })
    .refine((v) => new Date(v).getTime() <= Date.now() + 60_000, 'requestedAt lies in the future')
    .refine(
      (v) => new Date(v).getTime() >= Date.now() - 366 * 86_400_000,
      'requestedAt lies more than a year back',
    ),
});

/** Names of fields a stage still misses for a complete set. */
export function missingNis2Fields(stage: Nis2FieldStage, data: unknown): string[] {
  const result = nis2CompleteSchema[stage].safeParse(data ?? {});
  if (result.success) return [];
  return [...new Set(result.error.issues.map((i) => String(i.path[0] ?? '')))].filter(Boolean);
}
