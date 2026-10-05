/**
 * onboardingColumns.ts – the bulk-onboarding column model shared by the
 * in-tool editor and the review step: column definitions, per-cell validation
 * (a client-side mirror of backend onboarding.service so errors show while
 * typing; the server dry run stays the authority), the clipboard (tab-
 * separated) parser, and row helpers.
 * Dependencies: i18n TranslationKey type.
 */
import type { TranslationKey } from '../../../i18n/en';

export const ONBOARDING_COLUMN_KEYS = [
  'organizationIdentifier',
  'organizationName',
  'contactEmail',
  'clientCertFingerprint',
  'city',
  'countryCode',
] as const;

export type OnboardingColumnKey = (typeof ONBOARDING_COLUMN_KEYS)[number];
export type OnboardingCells = Record<OnboardingColumnKey, string>;

export interface OnboardingColumn {
  key: OnboardingColumnKey;
  required: boolean;
  labelKey: TranslationKey;
  placeholder: string;
  /** Tailwind width class of the column. */
  width: string;
  mono?: boolean;
}

export const ONBOARDING_COLUMNS: OnboardingColumn[] = [
  {
    key: 'organizationIdentifier',
    required: true,
    labelKey: 'onbColIdentifier',
    placeholder: 'klinik.example.de',
    width: 'min-w-[11rem]',
    mono: true,
  },
  {
    key: 'organizationName',
    required: true,
    labelKey: 'onbColName',
    placeholder: 'Klinikum Beispiel',
    width: 'min-w-[12rem]',
  },
  {
    key: 'contactEmail',
    required: true,
    labelKey: 'onbColEmail',
    placeholder: 'dsf@klinik.example.de',
    width: 'min-w-[12rem]',
  },
  {
    key: 'clientCertFingerprint',
    required: true,
    labelKey: 'onbColFingerprint',
    placeholder: 'AB:CD:…',
    width: 'min-w-[14rem]',
    mono: true,
  },
  {
    key: 'city',
    required: false,
    labelKey: 'onbColCity',
    placeholder: 'Muenster',
    width: 'min-w-[8rem]',
  },
  {
    key: 'countryCode',
    required: false,
    labelKey: 'onbColCountry',
    placeholder: 'DE',
    width: 'min-w-[5rem]',
  },
];

export const MAX_ONBOARDING_ROWS = 1000;

const FQDN = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same character set the backend strips before it checks for 128 hex characters.
const normalizeFingerprint = (v: string) => v.replace(/[^0-9a-fA-F]/g, '');
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export const emptyCells = (): OnboardingCells => ({
  organizationIdentifier: '',
  organizationName: '',
  contactEmail: '',
  clientCertFingerprint: '',
  city: '',
  countryCode: '',
});

export interface EditorRow {
  id: string;
  cells: OnboardingCells;
  /** The uploaded file the row came from; absent for rows typed or pasted in. */
  source?: { id: string; name: string };
}

let idCounter = 0;
export const newEditorRow = (
  cells: OnboardingCells = emptyCells(),
  source?: EditorRow['source'],
): EditorRow => ({
  id: `row-${Date.now().toString(36)}-${(idCounter += 1)}`,
  cells,
  ...(source ? { source } : {}),
});

export function isBlankCells(cells: OnboardingCells): boolean {
  return ONBOARDING_COLUMN_KEYS.every((k) => cells[k].trim() === '');
}

/** Returns the i18n key of the problem with one cell, or null when it is fine. */
export function validateCell(key: OnboardingColumnKey, raw: string): TranslationKey | null {
  const value = raw.trim();
  switch (key) {
    case 'organizationIdentifier':
      if (!value) return 'onbErrRequired';
      return FQDN.test(value) ? null : 'onbErrFqdn';
    case 'organizationName':
      if (!value) return 'onbErrRequired';
      if (FORMULA_PREFIX.test(raw)) return 'onbErrFormula';
      return value.length <= 255 ? null : 'onbErrTooLong';
    case 'contactEmail':
      if (!value) return 'onbErrRequired';
      return EMAIL.test(value) ? null : 'onbErrEmail';
    case 'clientCertFingerprint':
      if (!value) return 'onbErrRequired';
      return normalizeFingerprint(value).length === 128 ? null : 'onbErrFingerprint';
    case 'city':
      if (!value) return null;
      if (FORMULA_PREFIX.test(raw)) return 'onbErrFormula';
      return value.length <= 100 ? null : 'onbErrTooLong';
    case 'countryCode':
      return !value || /^[A-Za-z]{2}$/.test(value) ? null : 'onbErrCountry';
  }
}

/** First problem in a row, as the column plus its i18n key. */
export function validateRow(
  cells: OnboardingCells,
): { column: OnboardingColumnKey; error: TranslationKey } | null {
  for (const key of ONBOARDING_COLUMN_KEYS) {
    const error = validateCell(key, cells[key]);
    if (error) return { column: key, error };
  }
  return null;
}

/**
 * Parses clipboard text (Excel/Sheets copy = tab-separated rows) into cell
 * matrices. A leading header line (cells that are column names) is dropped.
 * Returns null for plain single-value text so a normal paste into one cell
 * keeps the browser default.
 */
export function parseClipboardGrid(text: string): string[][] | null {
  if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return null;
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const grid = lines.map((l) => l.split('\t').map((c) => c.trim()));
  const names = new Set<string>(ONBOARDING_COLUMN_KEYS.map((k) => k.toLowerCase()));
  if (grid[0].some((c) => c) && grid[0].every((c) => !c || names.has(c.toLowerCase()))) {
    grid.shift();
  }
  return grid.length ? grid : null;
}

/** Writes a pasted grid into rows starting at (rowIndex, colIndex), appending rows as needed. */
export function applyGrid(
  rows: OnboardingCells[],
  grid: string[][],
  rowIndex: number,
  colIndex: number,
): OnboardingCells[] {
  const next = rows.map((r) => ({ ...r }));
  grid.forEach((line, i) => {
    const target = rowIndex + i;
    if (target >= MAX_ONBOARDING_ROWS) return;
    while (next.length <= target) next.push(emptyCells());
    line.forEach((value, j) => {
      const key = ONBOARDING_COLUMN_KEYS[colIndex + j];
      if (key) next[target][key] = value;
    });
  });
  return next;
}
