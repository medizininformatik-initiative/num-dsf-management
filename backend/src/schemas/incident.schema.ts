/**
 * incident.schema.ts – Zod validation for the incident register (report,
 * admin updates and actions). Lengths are capped; links must be https;
 * single-line fields (title, organization) refuse control characters; the
 * detection time lies between one year before now and now (it starts the
 * NIS2 deadlines, so an older or future value is a typo, not an incident).
 */
import { z } from 'zod';
import { stepUpCode } from './stepUpCode';

const escalationLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const ONE_YEAR_MS = 366 * 86_400_000;

const detectionTime = z
  .string()
  .datetime({ offset: true })
  .refine((v) => new Date(v).getTime() <= Date.now() + 60_000, 'detectedAt lies in the future')
  .refine(
    (v) => new Date(v).getTime() >= Date.now() - ONE_YEAR_MS,
    'detectedAt lies more than a year back',
  );

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const singleLine = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !CONTROL_CHARS.test(v), 'Control characters are not allowed');

const httpsUrl = z
  .string()
  .max(500)
  .url()
  .refine((v) => v.startsWith('https://'), 'Only https links are allowed');

const totpCode = stepUpCode;

export const reportIncidentSchema = z.object({
  organizationId: singleLine(1, 255).nullable().optional(),
  title: singleLine(3, 200),
  description: z.string().trim().min(1).max(5000),
  escalationLevel,
  detectedAt: detectionTime.optional(),
  dpoInformed: z.boolean().optional(),
  zulipUrl: httpsUrl.optional(),
});

export const updateIncidentSchema = z
  .object({
    escalationLevel: escalationLevel.optional(),
    detectedAt: detectionTime.optional(),
    zulipUrl: httpsUrl.nullable().optional(),
    totpCode,
  })
  .refine(
    ({ totpCode: _code, ...v }) => Object.values(v).some((x) => x !== undefined),
    'Nothing to update',
  );

export const incidentStepUpSchema = z.object({ totpCode });

// Four-eyes lift of the certificate blocks of a false alarm (migration 041).
export const requestBlockLiftSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  totpCode,
});

export const INCIDENT_MEASURES = [
  'BLOCK_CERTIFICATES',
  'REMOVE_LOGINS',
  'WITHDRAW',
  'MAIL_SITES',
] as const;
export type IncidentMeasure = (typeof INCIDENT_MEASURES)[number];

export const suspendIncidentSchema = z.object({
  measures: z.array(z.enum(INCIDENT_MEASURES)).min(1),
  confirm: z.boolean().optional(),
  totpCode,
});

export const liftSuspensionSchema = z.object({
  causeFixed: z.literal(true),
  fixTested: z.literal(true),
  releasedByTechBoard: z.literal(true),
  note: z.string().trim().min(1).max(2000),
  totpCode,
});

export const closeIncidentSchema = z.object({
  outcome: z.enum(['CLOSED', 'FALSE_ALARM']),
  note: z.string().trim().min(1).max(5000),
  totpCode,
});

export const commentIncidentSchema = z.object({
  text: z.string().trim().min(1).max(5000),
});

export const exportIncidentQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
});
