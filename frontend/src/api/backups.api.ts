/**
 * backups.api.ts – Admin API for application backups: schedule settings, run
 * history, "back up now" and the download of a stored backup file.
 * Writes and the download carry the step-up (TOTP code in OTP sessions; cert
 * sessions omit it). Dependencies: axios, auth store.
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type BackupMode = 'EVERY_6H' | 'EVERY_12H' | 'DAILY';

export interface BackupSettings {
  enabled: boolean;
  mode: BackupMode;
  dailyTime: string;
  retentionCount: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface BackupSettingsResponse {
  settings: BackupSettings;
  encryptionEnabled: boolean;
  directory: string;
}

export interface BackupRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  trigger: 'SCHEDULED' | 'MANUAL';
  triggeredBy: string | null;
  status: 'SUCCESS' | 'FAILED';
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  encrypted: boolean;
  durationMs: number;
  error: string | null;
  fileDeleted: boolean;
}

export type BackupSettingsInput = Pick<
  BackupSettings,
  'enabled' | 'mode' | 'dailyTime' | 'retentionCount'
>;

/** Step-up code as a body fragment; cert sessions send none. */
const stepUp = (totpCode?: string) => (totpCode !== undefined ? { totpCode } : {});

export const backupsApi = {
  getSettings: () =>
    axios.get<{ data: BackupSettingsResponse }>(`${BASE}/admin/backups/settings`, {
      headers: authHeader(),
    }),
  saveSettings: (input: BackupSettingsInput, totpCode?: string) =>
    axios.put<{ data: { settings: BackupSettings } }>(
      `${BASE}/admin/backups/settings`,
      { ...input, ...stepUp(totpCode) },
      { headers: authHeader() },
    ),
  listRuns: () =>
    axios.get<{ data: { runs: BackupRun[] } }>(`${BASE}/admin/backups/runs`, {
      headers: authHeader(),
    }),
  runNow: (totpCode?: string) =>
    axios.post<{ data: { run: BackupRun } }>(`${BASE}/admin/backups/run`, stepUp(totpCode), {
      headers: authHeader(),
    }),
  /** POST (not GET) because the OTP step-up code travels in the body. */
  download: (id: string, totpCode?: string) =>
    axios.post<Blob>(`${BASE}/admin/backups/runs/${id}/download`, stepUp(totpCode), {
      headers: authHeader(),
      responseType: 'blob',
    }),
};
