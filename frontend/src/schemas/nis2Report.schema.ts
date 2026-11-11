/**
 * nis2Report.schema.ts – Zod schema of the NIS2 report fields form and the
 * conversion of a form into the request body. One form shape for all stages
 * (a stage renders only its own fields; the rest stay empty). Lengths mirror
 * the backend; error messages are i18n keys resolved by FormField. Saving is a
 * draft: nothing is required here (completeness gates the tick, see
 * lib/nis2Fields); choices left empty are not sent, texts left empty clear the
 * stored value.
 * Dependencies: zod, incidents.api types, lib/nis2Fields.
 */
import { z } from 'zod';
import type { Nis2FieldStage, Nis2FieldValues } from '../api/incidents.api';
import { NIS2_FIELD_DEFS } from '../lib/nis2Fields';

const text = (max: number) => z.string().max(max, 'incidentNis2TextTooLong');

export const nis2FieldsFormSchema = z.object({
  suspectedMalicious: z.string(),
  crossBorder: z.string(),
  affectedServices: text(500),
  severity: z.string(),
  impact: text(3000),
  iocs: text(3000),
  rootCause: text(3000),
  mitigation: text(3000),
  crossBorderFinal: z.string(),
});

export type Nis2FieldsForm = z.infer<typeof nis2FieldsFormSchema>;

/** Form values of a stage from the stored fields (unset ones are empty strings). */
export function toFormValues(values: Record<string, string> | null | undefined): Nis2FieldsForm {
  const v = values ?? {};
  return {
    suspectedMalicious: v.suspectedMalicious ?? '',
    crossBorder: v.crossBorder ?? '',
    affectedServices: v.affectedServices ?? '',
    severity: v.severity ?? '',
    impact: v.impact ?? '',
    iocs: v.iocs ?? '',
    rootCause: v.rootCause ?? '',
    mitigation: v.mitigation ?? '',
    crossBorderFinal: v.crossBorderFinal ?? '',
  };
}

/** Request body of a stage: its fields only, choices only when made, texts trimmed. */
export function toRequestBody(stage: Nis2FieldStage, form: Nis2FieldsForm): Nis2FieldValues {
  const body: Record<string, string> = {};
  for (const def of NIS2_FIELD_DEFS[stage]) {
    const value = form[def.key as keyof Nis2FieldsForm].trim();
    const isChoice = def.kind === 'tri' || def.kind === 'severity';
    if (isChoice && value === '') continue;
    body[def.key] = value;
  }
  return body as Nis2FieldValues;
}
