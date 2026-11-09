/**
 * onboardingFiles.ts – the multi-file model of the bulk onboarding upload:
 * limits, the per-file pre-check (type, size), mapping of server error codes
 * to messages, and detection of identifier / fingerprint conflicts between
 * the rows merged from different files.
 * Dependencies: onboardingColumns (row model), i18n TranslationKey type.
 */
import type { TranslationKey } from '../../../i18n/en';
import type { OnboardingImportResult } from '../../../api/onboarding.api';
import { isBlankCells, type EditorRow } from './onboardingColumns';

export const MAX_ONBOARDING_FILES = 50;
export const MAX_ONBOARDING_FILE_BYTES = 1_000_000;
export const MAX_ONBOARDING_TOTAL_BYTES = 10_000_000;

export type OnboardingFileKind = 'csv' | 'xlsx' | 'json';

export interface OnboardingFileEntry {
  id: string;
  name: string;
  size: number;
  kind: OnboardingFileKind | null;
  status: 'queued' | 'parsing' | 'done' | 'error';
  /** Valid rows this file contributed to the table. */
  rowCount: number;
  /** Rows of the file the server skipped while parsing, with the reason. */
  skipped: { row: number; issue: string }[];
  errorKey?: TranslationKey;
}

export function fileKindOf(name: string): OnboardingFileKind | null {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'csv' || ext === 'xlsx' || ext === 'json' ? ext : null;
}

/** i18n key of the reason a file cannot be read at all, or null when it can be sent. */
export function preCheckFile(file: File): TranslationKey | null {
  if (!fileKindOf(file.name)) return 'onbFileErrType';
  if (file.size === 0) return 'adminOnboardingErrorEmptyBody';
  if (file.size > MAX_ONBOARDING_FILE_BYTES) return 'adminOnboardingErrorFileTooLarge';
  return null;
}

const ERROR_CODE_KEY: Record<string, TranslationKey> = {
  FILE_TOO_LARGE: 'adminOnboardingErrorFileTooLarge',
  PEM_NOT_ALLOWED: 'adminOnboardingErrorPemNotAllowed',
  UNSUPPORTED_FORMAT: 'adminOnboardingErrorUnsupportedFormat',
  TOO_MANY_ROWS: 'adminOnboardingErrorTooManyRows',
  EMPTY_BODY: 'adminOnboardingErrorEmptyBody',
  TOTP_INVALID: 'totpInvalidCode',
  TOTP_REQUIRED: 'totpDigitsRequired',
};

/** Translation key for a server rejection of a file, from its error code. */
export function onboardingErrorKey(err: unknown): TranslationKey | undefined {
  const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
    ?.error?.code;
  return code ? ERROR_CODE_KEY[code] : undefined;
}

export interface RowConflict {
  kind: 'identifier' | 'fingerprint';
  /** 1-based editor row numbers of the other rows involved, with their file. */
  others: { row: number; file?: string }[];
}

const idOf = (v: string) => v.trim().toLowerCase();
const fpOf = (v: string) => v.replace(/[^0-9a-fA-F]/g, '').toLowerCase();

/**
 * Finds rows that claim the same identifier, or the same certificate
 * fingerprint under different identifiers. Every involved row is reported
 * (both sides of a conflict), keyed by 0-based editor row index.
 */
export function findConflicts(rows: EditorRow[]): Record<number, RowConflict> {
  const byId = new Map<string, number[]>();
  const byFp = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (isBlankCells(r.cells)) return;
    const id = idOf(r.cells.organizationIdentifier);
    const fp = fpOf(r.cells.clientCertFingerprint);
    if (id) byId.set(id, [...(byId.get(id) ?? []), i]);
    if (fp) byFp.set(fp, [...(byFp.get(fp) ?? []), i]);
  });

  const out: Record<number, RowConflict> = {};
  const flag = (group: number[], kind: RowConflict['kind']) => {
    for (const i of group) {
      if (out[i]) continue;
      out[i] = {
        kind,
        others: group
          .filter((j) => j !== i)
          .map((j) => ({ row: j + 1, file: rows[j].source?.name })),
      };
    }
  };
  byId.forEach((group) => group.length > 1 && flag(group, 'identifier'));
  byFp.forEach((group) => {
    const ids = new Set(group.map((i) => idOf(rows[i].cells.organizationIdentifier)));
    if (group.length > 1 && ids.size > 1) flag(group, 'fingerprint');
  });
  return out;
}

export interface FileSummaryItem {
  id: string;
  name: string;
  created: number;
  updated: number;
  failed: number;
}

/**
 * Splits an import result per source file. `sources` is aligned with the
 * submitted rows (result row numbers are 1-based positions in that array);
 * rows typed in directly have no source and are left out.
 */
export function summarizeByFile(
  result: Pick<OnboardingImportResult, 'rows' | 'parseErrors'>,
  sources: (EditorRow['source'] | undefined)[],
): FileSummaryItem[] {
  const items = new Map<string, FileSummaryItem>();
  const bump = (rowNo: number | undefined, key: 'created' | 'updated' | 'failed') => {
    const src = rowNo ? sources[rowNo - 1] : undefined;
    if (!src) return;
    const item = items.get(src.id) ?? {
      id: src.id,
      name: src.name,
      created: 0,
      updated: 0,
      failed: 0,
    };
    item[key] += 1;
    items.set(src.id, item);
  };
  result.rows.forEach((r) => bump(r.row, r.action));
  result.parseErrors.forEach((pe) => bump(pe.row, 'failed'));
  return [...items.values()];
}
