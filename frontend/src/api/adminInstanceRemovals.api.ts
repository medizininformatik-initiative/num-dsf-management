/**
 * adminInstanceRemovals.api.ts – Admin API for removing a whole site with two
 * admins (/admin/instance-removals) and the instance list the requests are
 * made from. Writes carry the TOTP step-up code in OTP sessions; cert sessions
 * omit it (the backend re-verifies the presented client certificate instead).
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

export type InstanceRemovalStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface InstanceRemoval {
  id: string;
  instanceId: string;
  organizationId: string | null;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: InstanceRemovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  versionNumber: number | null;
}

export interface InstanceRemovalResult {
  removal: InstanceRemoval;
  versionNumber: number | null;
  published: boolean;
}

/** One row of the cross-tenant instance list (admins only). */
export interface AdminInstance {
  id: string;
  label: string;
  user_email: string;
  org_identifier: string | null;
  org_name: string | null;
  removed_at: string | null;
}

export const adminInstanceRemovalsApi = {
  list: async (): Promise<InstanceRemoval[]> =>
    (
      await axios.get<{ data: InstanceRemoval[] }>(`${BASE}/admin/instance-removals`, {
        headers: authHeader(),
      })
    ).data.data,
  instances: async (): Promise<AdminInstance[]> =>
    (
      await axios.get<{ data: AdminInstance[] }>(`${BASE}/admin/instances`, {
        headers: authHeader(),
      })
    ).data.data,
  request: (instanceId: string, reason: string, totpCode?: string) =>
    axios.post(
      `${BASE}/admin/instance-removals`,
      { instanceId, reason, ...withTotp(totpCode) },
      { headers: authHeader() },
    ),
  confirm: async (id: string, totpCode?: string): Promise<InstanceRemovalResult> =>
    (
      await axios.post<{ data: InstanceRemovalResult }>(
        `${BASE}/admin/instance-removals/${id}/confirm`,
        withTotp(totpCode),
        { headers: authHeader() },
      )
    ).data.data,
  cancel: (id: string, totpCode?: string) =>
    axios.post(`${BASE}/admin/instance-removals/${id}/cancel`, withTotp(totpCode), {
      headers: authHeader(),
    }),
};
