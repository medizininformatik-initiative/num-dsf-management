/**
 * marketplace.schema.ts – Zod schemas for marketplace forms
 * Dependencies: zod
 */
import { z } from 'zod';
import { isStepUpCodeComplete } from '../lib/stepUpCode';
import { needsTotpStepUp } from '../lib/authMode';

// Cert-mode sessions prove possession via the client certificate instead of a
// TOTP code, so the field itself is always optional; the "must be 6 digits"
// requirement only applies when the current session needs a step-up code.
// The check runs inside the refine callback (not at module load) so it always
// reflects the auth mode at validation time.
const totpStepUpRefine = (data: { totpCode?: string }) =>
  !needsTotpStepUp() || (data.totpCode !== undefined && isStepUpCodeComplete(data.totpCode));

export const marketplaceAddFormSchema = z
  .object({
    gitUrl: z
      .string()
      .regex(
        /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?\/?$/,
        'marketplaceInvalidUrl',
      ),
    status: z.enum(['APPROVED', 'EXPERIMENTAL', 'DEPRECATED']).default('APPROVED'),
    totpCode: z.string().optional(),
  })
  .refine(totpStepUpRefine, { message: 'totpDigitsRequired', path: ['totpCode'] });

export type MarketplaceAddForm = z.infer<typeof marketplaceAddFormSchema>;

// The edit modal carries the DSF/trust fields as plain text inputs (array
// fields comma-separated); they are split into arrays on submit. Only status
// and totpCode are constrained here — the backend validates the rest strictly.
export const marketplaceEditFormSchema = z
  .object({
    status: z.enum(['APPROVED', 'EXPERIMENTAL', 'DEPRECATED']),
    verified: z.boolean().optional(),
    advisoryText: z.string().optional(),
    advisorySeverity: z.enum(['', 'INFO', 'WARNING', 'CRITICAL']).optional(),
    supersededBy: z.string().optional(),
    processIdentifiers: z.string().optional(),
    dsfVersionMin: z.string().optional(),
    requiredRoles: z.string().optional(),
    messageNames: z.string().optional(),
    artifactUrl: z.string().optional(),
    totpCode: z.string().optional(),
  })
  .refine(totpStepUpRefine, { message: 'totpDigitsRequired', path: ['totpCode'] });

export type MarketplaceEditForm = z.infer<typeof marketplaceEditFormSchema>;
