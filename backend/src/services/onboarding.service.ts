/**
 * onboarding.service.ts – parses and validates an admin bulk cert-onboarding
 * upload (CSV or JSON), then imports the validated rows. This is the
 * input-hardening core of the bulk onboarding feature: file-level problems
 * (oversized upload, a pasted PEM, an unparseable body, too many rows) throw,
 * so the route can reject the whole request outright; a bad individual row
 * is never thrown on — it is collected in `errors` so the admin can fix just
 * that row and resubmit. `importSites` then writes each valid row to the DB
 * in its own transaction, so one bad row can fail without rolling back the
 * rest of the import.
 * Dependencies: lib/csv (parseCsv), lib/certFingerprint (normalize/validate),
 * db/connection, services/audit.service (writeAuditLog), lib/errMessage
 * (errCode/errMessage), uuid, zod.
 */
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { parseCsv } from '../lib/csv';
import { normalizeFingerprint, isValidSha512Fingerprint } from '../lib/certFingerprint';
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { errCode, errMessage } from '../lib/errMessage';

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

export interface ImportRowResult {
  identifier: string;
  action: 'created' | 'updated' | 'failed';
  ok: boolean;
  issue?: string;
}

export interface ImportResult {
  summary: { created: number; updated: number; failed: number };
  rows: ImportRowResult[];
}

/**
 * Import validated onboarding rows: each row is written in its own DB
 * transaction (per-row atomicity), so a failing row is rolled back and
 * reported without affecting the other rows in the same import.
 * Per row: rejects a fingerprint already used by a different organization,
 * idempotently ensures the contact has a user + whitelist row (same pattern
 * as auth.service's resolveCertLogin), reuses the existing instance on an
 * update or creates a new one, upserts the organization, then writes a
 * CREATE/UPDATE audit log (only a fingerprint prefix is logged, never the
 * full value).
 * @returns Per-row outcomes and a created/updated/failed summary.
 */
export async function importSites(
  rows: OnboardingRow[],
  actorEmail: string,
  ip: string,
): Promise<ImportResult> {
  const rowResults: ImportRowResult[] = [];

  for (const row of rows) {
    const identifier = row.organizationIdentifier;
    try {
      const action = await db.transaction(async (trx) => {
        // 1. The fingerprint must not already belong to a different org.
        // The uq_org_cert_fp unique index enforces this too; the insert/
        // update below catches that race as a backstop.
        const fingerprintOwner = await trx('organizations')
          .where({ client_cert_fingerprint: row.clientCertFingerprint })
          .whereNot({ identifier })
          .first();
        if (fingerprintOwner) throw new Error('FINGERPRINT_IN_USE');

        // 2. Idempotently ensure the contact has a user + whitelist row.
        await trx('users')
          .insert({
            id: uuidv4(),
            email: row.contactEmail,
            totp_enabled: false,
            created_at: new Date(),
          })
          .onConflict('email')
          .ignore();
        await trx('email_whitelist')
          .insert({
            id: uuidv4(),
            email: row.contactEmail,
            created_by: actorEmail,
            created_at: new Date(),
          })
          .onConflict('email')
          .ignore();
        const user = await trx('users').where({ email: row.contactEmail }).first();

        // 3. A known identifier reuses its instance; a new one gets a fresh instance.
        const existingOrg = await trx('organizations').where({ identifier }).first();
        let instanceId: string;
        let rowAction: 'created' | 'updated';
        if (existingOrg) {
          instanceId = existingOrg.instance_id;
          rowAction = 'updated';
        } else {
          instanceId = uuidv4();
          await trx('instances').insert({
            id: instanceId,
            user_id: user.id,
            label: identifier,
            created_at: new Date(),
          });
          rowAction = 'created';
        }

        // 4. Upsert the organization row.
        const now = new Date();
        try {
          if (existingOrg) {
            await trx('organizations')
              .where({ identifier })
              .update({
                name: row.organizationName,
                email: row.contactEmail,
                city: row.city ?? null,
                country_code: row.countryCode || null,
                client_cert_fingerprint: row.clientCertFingerprint,
                instance_id: instanceId,
                updated_at: now,
              });
          } else {
            await trx('organizations').insert({
              identifier,
              instance_id: instanceId,
              name: row.organizationName,
              email: row.contactEmail,
              active: 1,
              city: row.city ?? null,
              country_code: row.countryCode || null,
              client_cert_fingerprint: row.clientCertFingerprint,
              created_at: now,
              updated_at: now,
            });
          }
        } catch (err: unknown) {
          if (errCode(err) === 'ER_DUP_ENTRY') throw new Error('FINGERPRINT_IN_USE');
          throw err;
        }

        // 5. Audit — only a fingerprint prefix is logged, never the full value.
        await writeAuditLog({
          userEmail: actorEmail,
          instanceId,
          resourceType: 'ORGANIZATION',
          resourceId: identifier,
          operation: rowAction === 'created' ? 'CREATE' : 'UPDATE',
          diffJson: {
            identifier,
            fingerprintPrefix: row.clientCertFingerprint.slice(0, 16),
          },
          ipAddress: ip,
        });

        return rowAction;
      });

      rowResults.push({ identifier, action, ok: true });
    } catch (err: unknown) {
      rowResults.push({
        identifier,
        action: 'failed',
        ok: false,
        issue: errMessage(err) || 'IMPORT_FAILED',
      });
    }
  }

  const summary = rowResults.reduce(
    (acc, r) => {
      if (r.action === 'created') acc.created += 1;
      else if (r.action === 'updated') acc.updated += 1;
      else acc.failed += 1;
      return acc;
    },
    { created: 0, updated: 0, failed: 0 },
  );

  return { summary, rows: rowResults };
}
