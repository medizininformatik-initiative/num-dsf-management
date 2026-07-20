/**
 * onboarding.service.ts – parses and validates an admin bulk cert-onboarding
 * upload (CSV or JSON). This is the input-hardening core of the bulk
 * onboarding feature: file-level problems (oversized upload, a pasted PEM,
 * an unparseable body, too many rows) throw, so the route can reject the
 * whole request outright; a bad individual row is never thrown on — it is
 * collected in `errors` so the admin can fix just that row and resubmit.
 * Dependencies: lib/csv (parseCsv), lib/certFingerprint (normalize/validate), zod.
 */
import { z } from 'zod';
import { parseCsv } from '../lib/csv';
import { normalizeFingerprint, isValidSha512Fingerprint } from '../lib/certFingerprint';

const MAX_FILE_BYTES = 1_000_000;
const MAX_ROWS = 1000;

// A leading =, +, -, @, tab, or CR is how a spreadsheet cell turns into a
// formula when the file is opened in Excel/Sheets (CSV/Excel formula
// injection). Tab/CR are rejected as their own prefix - not only as a
// bypass of the =/+/-/@ check - so this must run on the RAW value before
// any trimming, otherwise a leading tab/CR would be stripped before this
// check ever saw it.
const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/;
const FORMULA_INJECTION_MESSAGE =
  'Must not start with a formula character (= + - @) or a leading tab/CR';

function hasNoFormulaInjectionPrefix(val: string): boolean {
  return !FORMULA_INJECTION_PREFIX.test(val);
}

export const onboardingRowSchema = z.object({
  organizationIdentifier: z
    .string()
    .regex(/^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i, 'Must be a valid FQDN')
    .transform((v) => v.toLowerCase()),

  organizationName: z
    .string()
    .refine(hasNoFormulaInjectionPrefix, { message: FORMULA_INJECTION_MESSAGE })
    .transform((v) => v.trim())
    .refine((v) => v.length >= 1 && v.length <= 255, {
      message: 'Must be between 1 and 255 characters',
    }),

  contactEmail: z
    .string()
    .email()
    .transform((v) => v.toLowerCase()),

  clientCertFingerprint: z
    .string()
    .transform(normalizeFingerprint)
    .refine(isValidSha512Fingerprint, 'invalid SHA-512 fingerprint'),

  city: z
    .string()
    .max(100)
    .refine(hasNoFormulaInjectionPrefix, { message: FORMULA_INJECTION_MESSAGE })
    .optional(),

  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'Must be exactly 2 letters')
    .transform((v) => v.toUpperCase())
    .optional()
    .or(z.literal('')),
});

export type OnboardingRow = z.infer<typeof onboardingRowSchema>;

export function parseOnboardingFile(
  buf: Buffer,
  contentType: string | undefined,
): { valid: OnboardingRow[]; errors: { row: number; issue: string }[] } {
  if (buf.length > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');

  const text = buf.toString('utf-8');
  if (text.includes('-----BEGIN')) throw new Error('PEM_NOT_ALLOWED');

  const trimmed = text.trim();
  const contentTypeIsJson = contentType !== undefined && contentType.includes('application/json');
  const isJson = contentTypeIsJson || trimmed.startsWith('[') || trimmed.startsWith('{');

  let rawRows: unknown[];
  if (isJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('UNSUPPORTED_FORMAT');
    }
    if (Array.isArray(parsed)) {
      rawRows = parsed;
    } else if (parsed !== null && typeof parsed === 'object') {
      rawRows = [parsed];
    } else {
      throw new Error('UNSUPPORTED_FORMAT');
    }
  } else {
    rawRows = parseCsv(text);
  }

  if (rawRows.length > MAX_ROWS) throw new Error('TOO_MANY_ROWS');

  const valid: OnboardingRow[] = [];
  const errors: { row: number; issue: string }[] = [];
  rawRows.forEach((raw, idx) => {
    const result = onboardingRowSchema.safeParse(raw);
    if (result.success) {
      valid.push(result.data);
    } else {
      errors.push({ row: idx + 1, issue: result.error.issues[0]?.message ?? 'Invalid row' });
    }
  });

  return { valid, errors };
}
