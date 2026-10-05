/**
 * onboarding.api.ts – API client for the admin bulk onboarding endpoints:
 * import (CSV / JSON / XLSX file, or rows typed into the in-tool editor),
 * the same with ?dryRun=true to validate without writing, and the CSV / XLSX
 * template downloads.
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

async function post(
  body: string | ArrayBuffer,
  contentType: string,
  opts: OnboardingImportOptions,
): Promise<OnboardingImportResult> {
  const res = await axios.post<{ data: OnboardingImportResult }>(
    `${BASE}/admin/onboarding/import`,
    body,
    {
      headers: { ...authHeader(), 'Content-Type': contentType },
      params: opts.dryRun ? { dryRun: 'true' } : undefined,
      // axios would JSON-encode a string body for application/json; send raw.
      transformRequest: [(data: unknown) => data],
    },
  );
  return res.data.data;
}

/**
 * Uploads a CSV, JSON or XLSX onboarding file with the Content-Type the
 * backend uses to pick a parser (text as-is for CSV/JSON, raw bytes for XLSX)
 * and returns the unwrapped import (or dry-run) result.
 */
export async function importOnboarding(
  file: File,
  opts: OnboardingImportOptions = {},
): Promise<OnboardingImportResult> {
  if (isXlsxFile(file)) return post(await readAsArrayBuffer(file), XLSX_MIME, opts);
  const text = await file.text();
  return post(text, isJsonFile(file) ? 'application/json' : 'text/csv', opts);
}

/** Submits rows typed into the in-tool editor (as a JSON array). */
export function importOnboardingRows(
  rows: OnboardingRowInput[],
  opts: OnboardingImportOptions = {},
): Promise<OnboardingImportResult> {
  return post(JSON.stringify(rows), 'application/json', opts);
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
