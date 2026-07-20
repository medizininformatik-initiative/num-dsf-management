/**
 * onboarding.api.ts – API client for the admin bulk onboarding import endpoint.
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
}

export interface OnboardingImportSummary {
  created: number;
  updated: number;
  failed: number;
}

export interface OnboardingImportResult {
  summary: OnboardingImportSummary;
  rows: OnboardingImportRow[];
  parseErrors: { row: number; issue: string }[];
}

function isJsonFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.type.includes('json');
}

/**
 * Uploads a CSV or JSON onboarding file as its raw text, with the Content-Type
 * the backend uses to pick a parser (application/json for .json files, else
 * text/csv), and returns the unwrapped import result.
 */
export async function importOnboarding(file: File): Promise<OnboardingImportResult> {
  const text = await file.text();
  const contentType = isJsonFile(file) ? 'application/json' : 'text/csv';
  const res = await axios.post<{ data: OnboardingImportResult }>(
    `${BASE}/admin/onboarding/import`,
    text,
    { headers: { ...authHeader(), 'Content-Type': contentType } },
  );
  return res.data.data;
}
