/**
 * incident.schema.ts – Zod schemas of the incident register forms: the report
 * form (affected site, title, description, escalation level, detection time,
 * DPO informed) and the admin's Zulip link. Lengths mirror the backend; error
 * messages are i18n keys resolved by FormField. `detectedAt` is the value of a
 * datetime-local input (local time) and must not lie in the future.
 * Dependencies: zod.
 */
import { z } from 'zod';

export const INCIDENT_TITLE_MAX = 200;
export const INCIDENT_TEXT_MAX = 5000;
export const INCIDENT_NOTE_MAX = 2000;
export const ZULIP_URL_MAX = 500;

/** "YYYY-MM-DDTHH:mm" in local time, as a datetime-local input expects it. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

// A minute of slack: the default value is "now" rounded down, and the clock
// keeps running while the form is open.
const notInFuture = (value: string) => {
  const t = new Date(value).getTime();
  return !Number.isNaN(t) && t <= Date.now() + 60_000;
};

export const detectedAtSchema = z
  .string()
  .min(1, 'incidentDetectedAtRequired')
  .refine(notInFuture, 'incidentDetectedAtFuture');

export const reportIncidentSchema = z.object({
  organizationId: z.string(),
  title: z
    .string()
    .trim()
    .min(3, 'incidentTitleTooShort')
    .max(INCIDENT_TITLE_MAX, 'incidentTitleTooLong'),
  description: z
    .string()
    .trim()
    .min(1, 'incidentDescriptionRequired')
    .max(INCIDENT_TEXT_MAX, 'incidentTextTooLong'),
  escalationLevel: z.enum(['1', '2', '3']),
  detectedAt: detectedAtSchema,
  dpoInformed: z.boolean(),
});

export type ReportIncidentForm = z.infer<typeof reportIncidentSchema>;

export const zulipUrlSchema = z
  .string()
  .trim()
  .max(ZULIP_URL_MAX, 'incidentZulipTooLong')
  .refine((v) => v === '' || /^https:\/\/[^\s/]+\.[^\s]+$/i.test(v), 'incidentZulipHttps');
