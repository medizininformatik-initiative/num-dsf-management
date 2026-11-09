/**
 * organization.schema.ts – Zod validation for organization input
 */
import { z } from 'zod';

export const upsertOrganizationSchema = z.object({
  identifier: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._:-]+$/, 'Invalid identifier characters')
    .regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/, 'Must be a valid FQDN'),
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  active: z.boolean().optional().default(true),
  addressLine: z.string().max(255).optional().default(''),
  postalCode: z.string().max(20).optional().default(''),
  city: z.string().max(100).optional().default(''),
  countryCode: z
    .string()
    .refine((v) => v === '' || v.length === 2, 'Must be empty or a 2-character country code')
    .optional()
    .default(''),
  // SHA-256 of the DSF client certificate (64 hex characters) or empty.
  clientCertThumbprint: z
    .string()
    .regex(/^([0-9a-fA-F]{64})?$/, 'Must be a SHA-256 thumbprint (64 hex characters)')
    .optional()
    .nullable(),
  totpCode: z.string().length(6).optional(),
});
