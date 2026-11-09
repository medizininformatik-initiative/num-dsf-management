/**
 * onboarding.api.ts – API client for the admin bulk onboarding endpoints:
 * import (CSV / JSON / XLSX file, or rows typed into the in-tool editor),
 * the same with ?dryRun=true to validate without writing, a parse-only call
 * that turns one file into rows (so many files can be merged before a single
 * check / import), and the CSV / XLSX template downloads. A real import of an
 * OTP session carries its TOTP step-up code in the X-Totp-Code header.
 * Dependencies: axios, auth.store
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface OnboardingImportRow {
  identifier: string;
  action: 'created' | 'updated' | 'failed';
  ok: boolean;
  issue?: string;
  /** 1-based data-row number in the submitted file / editor (header excluded). */
  row?: number;
}

export interface OnboardingImportSummary {
  created: number;
  updated: number;
  failed: number;
}

export interface OnboardingImportResult {
  /** True when nothing was written (the dry-run validation). */
  dryRun?: boolean;
  summary: OnboardingImportSummary;
  rows: OnboardingImportRow[];
  parseErrors: { row: number; issue: string }[];
}

/** One site as the import expects it (the editor sends these as JSON). */
export interface OnboardingRowInput {
  organizationIdentifier: string;
  organizationName: string;
  contactEmail: string;
  clientCertFingerprint: string;
  city?: string;
  countryCode?: string;
}

export interface OnboardingImportOptions {
  dryRun?: boolean;
  /** Step-up code of an OTP session for a real import (sent as X-Totp-Code). */
  totpCode?: string;
}

/** One validated row of a parsed file, with its 1-based data-row number in that file. */
export type OnboardingParsedRow = OnboardingRowInput & { row: number };

export interface OnboardingParseResult {
  rows: OnboardingParsedRow[];
  parseErrors: { row: number; issue: string }[];
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isJsonFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.type.includes('json');
}

export function isXlsxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.xlsx') || file.type === XLSX_MIME;
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function send<T>(
  path: 'import' | 'parse',
  body: string | ArrayBuffer,
  contentType: string,
  opts: OnboardingImportOptions = {},
): Promise<T> {
  const res = await axios.post<{ data: T }>(`${BASE}/admin/onboarding/${path}`, body, {
    headers: {
      ...authHeader(),
      'Content-Type': contentType,
      ...(opts.totpCode ? { 'X-Totp-Code': opts.totpCode } : {}),
    },
    params: opts.dryRun ? { dryRun: 'true' } : undefined,
    // axios would JSON-encode a string body for application/json; send raw.
    transformRequest: [(data: unknown) => data],
  });
  return res.data.data;
}

// Body and Content-Type the backend uses to pick a parser: text as-is for
// CSV / JSON, raw bytes for XLSX.
async function encodeFile(file: File): Promise<[string | ArrayBuffer, string]> {
  if (isXlsxFile(file)) return [await readAsArrayBuffer(file), XLSX_MIME];
  return [await file.text(), isJsonFile(file) ? 'application/json' : 'text/csv'];
}

/**
 * Uploads a CSV, JSON or XLSX onboarding file and returns the unwrapped
 * import (or dry-run) result.
 */
export async function importOnboarding(
  file: File,
  opts: OnboardingImportOptions = {},
): Promise<OnboardingImportResult> {
  const [body, type] = await encodeFile(file);
  return send('import', body, type, opts);
}

/** Parses one file on the server without touching the database or writing anything. */
export async function parseOnboardingFile(file: File): Promise<OnboardingParseResult> {
  const [body, type] = await encodeFile(file);
  return send('parse', body, type);
}

/** Submits rows typed into the in-tool editor (as a JSON array). */
export function importOnboardingRows(
  rows: OnboardingRowInput[],
  opts: OnboardingImportOptions = {},
): Promise<OnboardingImportResult> {
  return send('import', JSON.stringify(rows), 'application/json', opts);
}

export type OnboardingTemplateKind = 'csv' | 'xlsx';

/** Downloads a template through the authenticated API and hands it to the browser as a file. */
export async function downloadOnboardingTemplate(kind: OnboardingTemplateKind): Promise<void> {
  const res = await axios.get<Blob>(`${BASE}/admin/onboarding/template.${kind}`, {
    headers: authHeader(),
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dsf-onboarding-template.${kind}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
