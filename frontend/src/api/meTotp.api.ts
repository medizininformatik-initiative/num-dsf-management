/**
 * meTotp.api.ts – TOTP and TAN management of the signed-in user
 * (/api/v1/me/totp): status, enrolment (setup + confirm) and a new TAN list.
 * Dependencies: axios, auth store.
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface TotpStatus {
  enabled: boolean;
  remainingTans: number;
  enrolmentRequired: boolean;
}

export const meTotpApi = {
  status: (): Promise<TotpStatus> =>
    axios
      .get<{ data: TotpStatus }>(`${BASE}/me/totp/status`, { headers: authHeader() })
      .then((r) => r.data.data),

  /** `code` (TOTP code or TAN) is needed only when TOTP is already enrolled. */
  setup: (code?: string): Promise<{ qrCodeUrl: string; secret: string }> =>
    axios
      .post<{ data: { qrCodeUrl: string; secret: string } }>(
        `${BASE}/me/totp/setup`,
        code ? { code } : {},
        { headers: authHeader() },
      )
      .then((r) => r.data.data),

  /** Confirms the pending secret; returns the TAN list (shown once). */
  confirm: (code: string): Promise<string[]> =>
    axios
      .post<{ data: { backupCodes: string[] } }>(
        `${BASE}/me/totp/confirm`,
        { code },
        { headers: authHeader() },
      )
      .then((r) => r.data.data.backupCodes),

  /** Step-up protected: a new TAN list; the old one stops working. */
  regenerateTans: (totpCode?: string): Promise<string[]> =>
    axios
      .post<{ data: { backupCodes: string[] } }>(
        `${BASE}/me/totp/backup-codes`,
        totpCode ? { totpCode } : {},
        { headers: authHeader() },
      )
      .then((r) => r.data.data.backupCodes),
};
