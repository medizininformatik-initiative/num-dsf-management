/**
 * loginCertificates.api.ts – Which certificates may log in as an organization.
 * Reading is open to the instance's users (badges in the certificates card);
 * enabling/removing is admin-only and carries the TOTP step-up code in OTP
 * sessions (cert sessions omit it; the backend re-verifies the client
 * certificate instead).
 * Dependencies: axios, auth.store
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type LoginCertificateSource = 'ONBOARDING' | 'ADMIN' | 'MIGRATED';

export interface LoginCertificate {
  /** SHA-512 of the certificate DER, 128 lower-case hex. */
  fingerprint: string;
  /** The uploaded certificate it was enabled from; null for fingerprint-only entries. */
  certificateId: string | null;
  source: LoginCertificateSource;
  createdBy: string | null;
  createdAt: string;
}

export const loginCertificatesApi = {
  list: (instanceId: string) =>
    axios.get<{ data: LoginCertificate[] }>(
      `${BASE}/instances/${instanceId}/certificates/login-certificates`,
      { headers: authHeader() },
    ),
  enable: (organization: string, certificateId: string, totpCode?: string) =>
    axios.post<{ data: LoginCertificate }>(
      `${BASE}/admin/organizations/${encodeURIComponent(organization)}/login-certificates`,
      totpCode !== undefined ? { certificateId, totpCode } : { certificateId },
      { headers: authHeader() },
    ),
  remove: (organization: string, fingerprint: string, totpCode?: string) =>
    axios.delete<{ data: { deleted: true } }>(
      `${BASE}/admin/organizations/${encodeURIComponent(organization)}/login-certificates/${fingerprint}`,
      { headers: authHeader(), data: totpCode !== undefined ? { totpCode } : {} },
    ),
};
