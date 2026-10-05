/**
 * bundleVersions.api.ts – Admin API for the bundle version history and its
 * four-eyes restore requests.
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface BundleVersionListRow {
  id: string;
  version_number: number;
  created_at: string;
  triggered_by: 'APPROVAL' | 'MANUAL' | 'RESTORE';
  triggered_by_email: string;
  content_hash: string;
  notes: string | null;
  approval_request_id: string | null;
  /** The version DSF currently serves; absent on older backends. */
  isCurrent?: boolean;
  /** Whether the version can be restored; absent on older backends. */
  restorable?: boolean;
}

export interface BundleVersionListPage {
  data: BundleVersionListRow[];
  meta: { page: number; limit: number; total: number; pages: number };
}

export interface BundleVersionDetail extends BundleVersionListRow {
  bundle_json: string;
  signature: string;
  bundle: unknown;
}

export interface BundleVersionDiff {
  added: unknown[];
  removed: unknown[];
  changed: Array<{ before: unknown; after: unknown }>;
}

export type BundleRestoreStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** A four-eyes request to publish an old version again. */
export interface BundleRestoreRequest {
  id: string;
  sourceVersionId: string;
  sourceVersionNumber: number | null;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: BundleRestoreStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  resultingVersionId: string | null;
  resultingVersionNumber: number | null;
}

export const bundleVersionsApi = {
  list: (page = 1, limit = 50) =>
    axios.get<BundleVersionListPage>(`${BASE}/admin/bundle-versions`, {
      params: { page, limit },
      headers: authHeader(),
    }),
  get: (id: string) =>
    axios.get<{ data: BundleVersionDetail }>(`${BASE}/admin/bundle-versions/${id}`, {
      headers: authHeader(),
    }),
  diff: (idA: string, idB: string) =>
    axios.get<{ data: BundleVersionDiff }>(`${BASE}/admin/bundle-versions/${idA}/diff/${idB}`, {
      headers: authHeader(),
    }),
  /** Requests the restore; a second admin of another site has to approve it. */
  restore: (id: string, body: { reason: string; totpCode?: string }) =>
    axios.post<{ data: { id: string; sourceVersionNumber: number } }>(
      `${BASE}/admin/bundle-versions/${id}/restore`,
      body,
      { headers: authHeader() },
    ),
  listRestores: () =>
    axios.get<{ data: BundleRestoreRequest[] }>(`${BASE}/admin/bundle-restores`, {
      headers: authHeader(),
    }),
  approveRestore: (rid: string, totpCode?: string) =>
    axios.post<{ data: { id: string; versionNumber: number; restoredFromVersion: number } }>(
      `${BASE}/admin/bundle-restores/${rid}/approve`,
      { totpCode },
      { headers: authHeader() },
    ),
  rejectRestore: (rid: string, comment: string, totpCode?: string) =>
    axios.post<{ data: { ok: true } }>(
      `${BASE}/admin/bundle-restores/${rid}/reject`,
      { comment, totpCode },
      { headers: authHeader() },
    ),
  cancelRestore: (rid: string, totpCode?: string) =>
    axios.post<{ data: { ok: true } }>(
      `${BASE}/admin/bundle-restores/${rid}/cancel`,
      { totpCode },
      { headers: authHeader() },
    ),
  downloadUrl: (id: string) => `${BASE}/admin/bundle-versions/${id}/download`,
};
