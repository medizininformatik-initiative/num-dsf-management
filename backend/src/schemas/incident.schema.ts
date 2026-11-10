/**
 * incident.schema.ts – Zod validation for the incident register (report,
 * admin updates and actions). Lengths are capped; links must be https.
 */
import { z } from 'zod';

const escalationLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const notInFuture = z
  .string()
  .datetime({ offset: true })
  .refine((v) => new Date(v).getTime() <= Date.now() + 60_000, 'detectedAt lies in the future');

const httpsUrl = z
  .string()
  .max(500)
  .url()
  .refine((v) => v.startsWith('https://'), 'Only https links are allowed');

const totpCode = z.string().length(6).optional();

export const reportIncidentSchema = z.object({
  organizationId: z.string().min(1).max(255).nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(5000),
  escalationLevel,
  detectedAt: notInFuture.optional(),
  dpoInformed: z.boolean().optional(),
  zulipUrl: httpsUrl.optional(),
});

export const updateIncidentSchema = z
  .object({
    escalationLevel: escalationLevel.optional(),
    detectedAt: notInFuture.optional(),
    zulipUrl: httpsUrl.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

export const incidentStepUpSchema = z.object({ totpCode });

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
