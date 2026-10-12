/**
 * adminCertificates.api.ts – Admin login certificates: the caller's own list
 * and successor upload, and recovery for a colleague. Writes carry the TOTP
 * step-up code in OTP sessions; cert sessions omit it (the backend re-verifies
 * the presented client certificate instead).
 * Dependencies: axios, auth.store
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function withTotp(totpCode?: string): { totpCode: string } | Record<string, never> {
  return totpCode !== undefined ? { totpCode } : {};
}

export interface AdminCertificate {
  id: string;
  email: string;
  label: string | null;
  subject: string | null;
  /** SHA-512 of the certificate DER, 128 lower-case hex. */
  fingerprint: string;
  validUntil: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface MyAdminCertificate extends AdminCertificate {
  /** The certificate presented by this very session. */
  current: boolean;
}

export interface AdminCertificatePreview {
  subject: string;
  issuerDn: string;
  validFrom: string;
  validUntil: string;
  thumbprintSha512: string;
  issuerTrusted: boolean;
  issuerBlacklisted: boolean;
  whitelistEnforced: boolean;
}

export const adminCertificatesApi = {
  mine: async (): Promise<MyAdminCertificate[]> =>
    (
      await axios.get<{ data: MyAdminCertificate[] }>(`${BASE}/admin/me/certificates`, {
        headers: authHeader(),
      })
    ).data.data,
  all: async (): Promise<AdminCertificate[]> =>
    (
      await axios.get<{ data: AdminCertificate[] }>(`${BASE}/admin/admin-certificates`, {
        headers: authHeader(),
      })
    ).data.data,
  preview: async (pem: string): Promise<AdminCertificatePreview> =>
    (
      await axios.post<{ data: AdminCertificatePreview }>(
        `${BASE}/admin/me/certificates/preview`,
        { pem },
        { headers: authHeader() },
      )
    ).data.data,
  addMine: (pem: string, label: string | null, totpCode?: string) =>
    axios.post<{ data: AdminCertificate }>(
      `${BASE}/admin/me/certificates`,
      { pem, label, ...withTotp(totpCode) },
      { headers: authHeader() },
    ),
  setLabel: (id: string, label: string | null) =>
    axios.patch<{ data: AdminCertificate }>(
      `${BASE}/admin/me/certificates/${id}`,
      { label },
      { headers: authHeader() },
    ),
  removeMine: (id: string, totpCode?: string) =>
    axios.request({
      method: 'DELETE',
      url: `${BASE}/admin/me/certificates/${id}`,
      headers: authHeader(),
      data: withTotp(totpCode),
    }),
  addFor: (email: string, pem: string, label: string | null, totpCode?: string) =>
    axios.post<{ data: AdminCertificate }>(
      `${BASE}/admin/users/${encodeURIComponent(email)}/certificates`,
      { pem, label, ...withTotp(totpCode) },
      { headers: authHeader() },
    ),
  removeFor: (email: string, id: string, totpCode?: string) =>
    axios.request({
      method: 'DELETE',
      url: `${BASE}/admin/users/${encodeURIComponent(email)}/certificates/${id}`,
      headers: authHeader(),
      data: withTotp(totpCode),
    }),
};
