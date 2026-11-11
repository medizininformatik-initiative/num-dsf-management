/**
 * nis2Fields.ts – the report fields each NIS2 stage keeps (BSIG § 32) as the
 * forms need them: field order, input kind, length cap, which are required,
 * which stage shows which fields (the progress report shares the final
 * report's), and whether a stage's fields are complete (the tick is offered
 * only then; the backend checks the same again). Pure functions.
 * Dependencies: incidents.api types.
 */
import type { Nis2FieldStage, Nis2FieldValues, Nis2Stage } from '../api/incidents.api';

export type Nis2FieldKind = 'tri' | 'severity' | 'line' | 'text';

export interface Nis2FieldDef {
  key: keyof Nis2FieldValues;
  kind: Nis2FieldKind;
  required: boolean;
  max: number;
}

export const NIS2_FIELD_DEFS: Record<Nis2FieldStage, readonly Nis2FieldDef[]> = {
  EARLY_WARNING: [
    { key: 'suspectedMalicious', kind: 'tri', required: true, max: 0 },
    { key: 'crossBorder', kind: 'tri', required: true, max: 0 },
    { key: 'affectedServices', kind: 'line', required: true, max: 500 },
  ],
  NOTIFICATION: [
    { key: 'severity', kind: 'severity', required: true, max: 0 },
    { key: 'impact', kind: 'text', required: true, max: 3000 },
    { key: 'iocs', kind: 'text', required: false, max: 3000 },
  ],
  FINAL_REPORT: [
    { key: 'rootCause', kind: 'text', required: true, max: 3000 },
    { key: 'mitigation', kind: 'text', required: true, max: 3000 },
    { key: 'crossBorderFinal', kind: 'tri', required: true, max: 0 },
  ],
};

/** The stage whose fields a stage shows; undefined for the interim report. */
export const FIELD_STAGE_OF: Partial<Record<Nis2Stage, Nis2FieldStage>> = {
  EARLY_WARNING: 'EARLY_WARNING',
  NOTIFICATION: 'NOTIFICATION',
  PROGRESS_REPORT: 'FINAL_REPORT',
  FINAL_REPORT: 'FINAL_REPORT',
};

/** Keys of the required fields that are still empty. */
export function missingNis2Fields(
  stage: Nis2FieldStage,
  values: Record<string, string> | null | undefined,
): string[] {
  return NIS2_FIELD_DEFS[stage]
    .filter((d) => d.required && !(values?.[d.key] ?? '').trim())
    .map((d) => d.key);
}

export const isNis2StageComplete = (
  stage: Nis2FieldStage,
  values: Record<string, string> | null | undefined,
): boolean => missingNis2Fields(stage, values).length === 0;
