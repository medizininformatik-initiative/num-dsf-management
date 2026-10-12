/**
 * adminCertificates.api.ts – Admin login certificates: the caller's own list
 * and successor upload, and recovery for a colleague (a four-eyes request that
 * a third admin approves via adminCertRequestsApi). Writes carry the TOTP
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

export type AdminCertRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** A four-eyes request for a colleague's admin certificate (never contains the PEM). */
export interface AdminCertRequest {
  id: string;
  targetEmail: string;
  /** SHA-512 of the certificate DER, 128 lower-case hex. */
  fingerprint: string;
  subject: string | null;
  validUntil: string | null;
  label: string | null;
  requestedBy: string;
  status: AdminCertRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
}

export const adminCertRequestsApi = {
  list: async (): Promise<AdminCertRequest[]> =>
    (
      await axios.get<{ data: AdminCertRequest[] }>(`${BASE}/admin/admin-cert-requests`, {
        headers: authHeader(),
      })
    ).data.data,
  approve: (id: string, totpCode?: string) =>
    axios.post(`${BASE}/admin/admin-cert-requests/${id}/approve`, withTotp(totpCode), {
      headers: authHeader(),
    }),
  reject: (id: string, comment: string, totpCode?: string) =>
    axios.post(
      `${BASE}/admin/admin-cert-requests/${id}/reject`,
      { comment, ...withTotp(totpCode) },
      { headers: authHeader() },
    ),
  cancel: (id: string, totpCode?: string) =>
    axios.post(`${BASE}/admin/admin-cert-requests/${id}/cancel`, withTotp(totpCode), {
      headers: authHeader(),
    }),
};

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
  /** Opens a four-eyes request; the certificate only becomes active once a third admin approves. */
  addFor: (email: string, pem: string, label: string | null, totpCode?: string) =>
    axios.post<{ data: { id: string; status: AdminCertRequestStatus } }>(
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
