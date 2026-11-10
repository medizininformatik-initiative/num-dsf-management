/**
 * query.schema.ts – Zod validation for query parameters (audit, admin)
 */
import { z } from 'zod';

const RESOURCES = [
  'ORGANIZATION',
  'CONTACT',
  'ENDPOINT',
  'CERTIFICATE',
  'MEMBERSHIP',
  'AUTH',
  'APPROVAL',
  'MARKETPLACE',
  'AUDIT',
  'BACKUP',
  'INCIDENT',
] as const;

const OPERATIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'APPROVE',
  'REJECT',
  'LOGIN',
  'LOGOUT',
  'OTP_REQUEST',
  'OTP_VERIFY',
  'TOTP_SETUP',
  'TOTP_VERIFY',
  'FAILED_LOGIN',
  'WITHDRAW',
  'DENIED',
  'STEP_UP_FAILED',
  'RATE_LIMITED',
  'EXPORT',
  'DOWNLOAD',
] as const;

// Query-string booleans arrive as 'true' / 'false'.
const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Filters shared by the audit list and the audit export. */
const auditFilterShape = {
  resource: z.enum(RESOURCES).optional(),
  operation: z.enum(OPERATIONS).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  actor: z.string().trim().min(1).max(255).optional(),
  instanceId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  flaggedOnly: queryBoolean.optional(),
};

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  ...auditFilterShape,
});

export const auditExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  ...auditFilterShape,
});
