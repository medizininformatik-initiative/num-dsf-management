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
 * (errCode/errMessage), services/org-login-certificates.service
 * (recordSystemLoginChange), uuid, zod.
 */
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import { parseCsv } from '../lib/csv';
import { normalizeFingerprint, isValidSha512Fingerprint } from '../lib/certFingerprint';
import { db } from '../db/connection';
import { writeAuditLog } from './audit.service';
import { errCode, errMessage } from '../lib/errMessage';
import { isAdminEmail } from '../lib/isAdmin';
import { recordSystemLoginChange } from './org-login-certificates.service';

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

export const ONBOARDING_COLUMNS = [
  'organizationIdentifier',
  'organizationName',
  'contactEmail',
  'clientCertFingerprint',
  'city',
  'countryCode',
] as const;

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ParsedOnboarding {
  valid: OnboardingRow[];
  /** 1-based data-row number (header excluded) of each entry in `valid`. */
  validRows: number[];
  errors: { row: number; issue: string }[];
}

// A row whose identifier cell starts with "#" is a comment (the template's
// example row), never data.
function isCommentRow(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false;
  const id = (raw as Record<string, unknown>).organizationIdentifier;
  return typeof id === 'string' && id.trimStart().startsWith('#');
}

function validateRows(rawRows: { raw: unknown; row: number }[]): ParsedOnboarding {
  if (rawRows.length > MAX_ROWS) throw new Error('TOO_MANY_ROWS');
  const valid: OnboardingRow[] = [];
  const validRows: number[] = [];
  const errors: { row: number; issue: string }[] = [];
  for (const { raw, row } of rawRows) {
    if (isCommentRow(raw)) continue;
    const result = onboardingRowSchema.safeParse(raw);
    if (result.success) {
      valid.push(result.data);
      validRows.push(row);
    } else {
      errors.push({ row, issue: result.error.issues[0]?.message ?? 'Invalid row' });
    }
  }
  return { valid, validRows, errors };
}

// Flattens an exceljs cell value to the plain text a CSV cell would hold. A
// formula cell becomes "=<formula>" so the formula-injection guard rejects it.
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if ('formula' in value || 'sharedFormula' in value) {
    return `=${(value as { formula?: string }).formula ?? ''}`;
  }
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('text' in value) return String(value.text);
  return '';
}

/**
 * Parses an .xlsx onboarding upload (first sheet that is not "Help", header in
 * row 1) into the same validated shape as parseOnboardingFile. Async because
 * exceljs reads the workbook asynchronously.
 */
export async function parseOnboardingXlsx(buf: Buffer): Promise<ParsedOnboarding> {
  if (buf.length > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error('UNSUPPORTED_FORMAT');
  }
  const sheet = wb.worksheets.find((w) => w.name.toLowerCase() !== 'help') ?? wb.worksheets[0];
  if (!sheet) throw new Error('UNSUPPORTED_FORMAT');
  if (sheet.rowCount > MAX_ROWS + 50) throw new Error('TOO_MANY_ROWS');

  const header: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    header[col] = cellText(cell.value).trim();
  });

  const rawRows: { raw: Record<string, string>; row: number }[] = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const raw: Record<string, string> = {};
    let any = false;
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const key = header[col];
      if (!key) return;
      const v = cellText(cell.value);
      if (v.trim() !== '') any = true;
      raw[key] = v;
    });
    if (!any) continue;
    for (const key of ONBOARDING_COLUMNS) raw[key] ??= '';
    rawRows.push({ raw, row: r - 1 });
  }
  if (JSON.stringify(rawRows).includes('-----BEGIN')) throw new Error('PEM_NOT_ALLOWED');
  return validateRows(rawRows);
}

/** True when the upload is an Excel workbook (content type or ZIP magic bytes). */
export function isXlsxUpload(buf: Buffer, contentType: string | undefined): boolean {
  if (contentType?.includes('spreadsheetml')) return true;
  return buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03;
}

export function parseOnboardingFile(
  buf: Buffer,
  contentType: string | undefined,
): ParsedOnboarding {
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

  return validateRows(rawRows.map((raw, idx) => ({ raw, row: idx + 1 })));
}

/**
 * Dry run of importSites: reports per row what an import would do (created /
 * updated / failed) without writing anything. Mirrors the import's checks,
 * including conflicts between rows of the same payload (a later row that reuses
 * an earlier row's identifier, or its fingerprint under another identifier,
 * would fail).
 */
export async function previewSites(rows: OnboardingRow[]): Promise<ImportResult> {
  const results: ImportRowResult[] = [];
  const seenIds = new Set<string>();
  const fileFingerprintOwner = new Map<string, string>();

  for (const row of rows) {
    const identifier = row.organizationIdentifier;
    const fp = row.clientCertFingerprint;
    const owner = await db('org_login_certificates')
      .where({ fingerprint: fp })
      .whereNot({ organization_id: identifier })
      .first();
    if (seenIds.has(identifier)) {
      results.push({ identifier, action: 'failed', ok: false, issue: 'DUPLICATE_IDENTIFIER' });
      continue;
    }
    if (await db('admin_cert_fingerprints').where({ fingerprint: fp }).first()) {
      results.push({ identifier, action: 'failed', ok: false, issue: 'ADMIN_CERTIFICATE' });
      continue;
    }
    const fileOwner = fileFingerprintOwner.get(fp);
    if (owner || (fileOwner && fileOwner !== identifier)) {
      results.push({ identifier, action: 'failed', ok: false, issue: 'FINGERPRINT_IN_USE' });
      continue;
    }
    fileFingerprintOwner.set(fp, identifier);
    const exists = !!(await db('organizations').where({ identifier }).first());
    seenIds.add(identifier);
    results.push({ identifier, action: exists ? 'updated' : 'created', ok: true });
  }

  return { summary: summarize(results), rows: results };
}

function summarize(rowResults: ImportRowResult[]): ImportResult['summary'] {
  return rowResults.reduce(
    (acc, r) => {
      if (r.action === 'created') acc.created += 1;
      else if (r.action === 'updated') acc.updated += 1;
      else acc.failed += 1;
      return acc;
    },
    { created: 0, updated: 0, failed: 0 },
  );
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
  const seenIds = new Set<string>();

  for (const row of rows) {
    const identifier = row.organizationIdentifier;
    // The same site twice in one payload (e.g. two files) is a conflict, not
    // an update: only the first occurrence is written.
    if (seenIds.has(identifier)) {
      rowResults.push({ identifier, action: 'failed', ok: false, issue: 'DUPLICATE_IDENTIFIER' });
      continue;
    }
    seenIds.add(identifier);
    // Login changes of an existing organization, told to the clinic after commit.
    const loginChanges: { enabled: string[]; disabled: string[] } = { enabled: [], disabled: [] };
    try {
      const action = await db.transaction(async (trx) => {
        // 1. The fingerprint must not already belong to a different org.
        // The uq_org_cert_fp unique index enforces this too; the insert/
        // update below catches that race as a backstop.
        const fingerprintOwner = await trx('org_login_certificates')
          .where({ fingerprint: row.clientCertFingerprint })
          .whereNot({ organization_id: identifier })
          .first();
        if (fingerprintOwner) throw new Error('FINGERPRINT_IN_USE');
        // An admin certificate never becomes a site login (as in enable()).
        if (
          await trx('admin_cert_fingerprints')
            .where({ fingerprint: row.clientCertFingerprint })
            .first()
        ) {
          throw new Error('ADMIN_CERTIFICATE');
        }

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

        // 4b. The login certificate: onboarding owns exactly one ONBOARDING
        // entry per organization (a re-import replaces the previous one);
        // entries an admin added stay. Logins through it are scoped to this
        // organization's instance, so the instance owner no longer matters
        // for the clinic. organizations.client_cert_fingerprint (deprecated,
        // no longer read) is still mirrored above for rollback.
        try {
          const replaced: string[] = await trx('org_login_certificates')
            .where({ organization_id: identifier, source: 'ONBOARDING' })
            .whereNot({ fingerprint: row.clientCertFingerprint })
            .pluck('fingerprint');
          const alreadyLogin = await trx('org_login_certificates')
            .where({ fingerprint: row.clientCertFingerprint })
            .first('fingerprint');
          if (existingOrg) {
            loginChanges.disabled.push(...replaced);
            if (!alreadyLogin) loginChanges.enabled.push(row.clientCertFingerprint);
          }
          await trx('org_login_certificates')
            .where({ organization_id: identifier, source: 'ONBOARDING' })
            .whereNot({ fingerprint: row.clientCertFingerprint })
            .del();
          await trx('org_login_certificates')
            .insert({
              fingerprint: row.clientCertFingerprint,
              organization_id: identifier,
              certificate_id: null,
              source: 'ONBOARDING',
              created_by: actorEmail,
              created_at: now,
            })
            .onConflict('fingerprint')
            .ignore();
        } catch (err: unknown) {
          if (errCode(err) === 'ER_DUP_ENTRY') throw new Error('FINGERPRINT_IN_USE');
          throw err;
        }

        // 4c. Re-onboarding an existing site that an admin created in the GUI:
        // move the instance to the site's contact user, so the admin's
        // instance switcher stops listing the clinic and the clinic's own
        // account owns it. Skipped when the owner is not an admin.
        if (existingOrg) {
          const instance = await trx('instances').where({ id: instanceId }).first();
          if (instance && instance.user_id !== user.id) {
            const previousOwner = await trx('users').where({ id: instance.user_id }).first();
            if (await isAdminEmail(previousOwner?.email)) {
              await trx('instances').where({ id: instanceId }).update({ user_id: user.id });
              await writeAuditLog({
                userEmail: actorEmail,
                instanceId,
                resourceType: 'ORGANIZATION',
                resourceId: identifier,
                operation: 'UPDATE',
                diffJson: {
                  action: 'instance_owner_transfer',
                  from: previousOwner?.email ?? null,
                  to: row.contactEmail,
                },
                ipAddress: ip,
              });
            }
          }
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
      for (const fp of loginChanges.enabled) {
        await recordSystemLoginChange(identifier, 'enable', actorEmail, fp, 'onboarding');
      }
      for (const fp of loginChanges.disabled) {
        await recordSystemLoginChange(identifier, 'disable', actorEmail, fp, 'onboarding');
      }
    } catch (err: unknown) {
      rowResults.push({
        identifier,
        action: 'failed',
        ok: false,
        issue: errMessage(err) || 'IMPORT_FAILED',
      });
    }
  }

  return { summary: summarize(rowResults), rows: rowResults };
}
