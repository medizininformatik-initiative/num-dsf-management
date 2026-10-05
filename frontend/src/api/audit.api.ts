/**
 * audit.api.ts – Axios client for the cross-instance audit endpoint (list with
 * filters + anomaly flags, CSV/JSON export) and the site list used by the site filter.
 * Dependencies: axios, useAuthStore
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type AuditFlagSeverity = 'info' | 'warning' | 'critical';

export interface AuditFlag {
  code: string;
  severity: AuditFlagSeverity;
}

export interface AuditSummary {
  info: number;
  warning: number;
  critical: number;
  /** Entries carrying at least one flag. */
  flagged: number;
  /** Entries the rules were evaluated over. */
  scanned: number;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  user_email: string | null;
  instance_id: string | null;
  resource_type: string;
  resource_id: string | null;
  operation: string;
  diff_json: object | null;
  ip_address: string | null;
  instance_label: string | null;
  organization_identifier: string | null;
  organization_name: string | null;
  flags?: AuditFlag[];
}

export interface AuditResponse {
  data: AuditEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    isAdmin: boolean;
    summary?: AuditSummary;
  };
}

/** Filters shared by the list and the export. Empty values are not sent. */
export interface AuditFilters {
  /** ISO timestamps. */
  from?: string;
  to?: string;
  actor?: string;
  instanceId?: string;
  resource?: string;
  operation?: string;
  q?: string;
  flaggedOnly?: boolean;
}

export interface AuditSite {
  id: string;
  label: string | null;
  org_identifier: string | null;
  org_name: string | null;
}

function filterParams(filters: AuditFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === false) continue;
    out[key] = String(value);
  }
  return out;
}

export async function getCrossInstanceAudit(
  params: { page?: number; limit?: number } & AuditFilters,
): Promise<AuditResponse> {
  const { page, limit, ...filters } = params;
  const res = await axios.get<AuditResponse>(`${BASE}/audit`, {
    params: { page, limit, ...filterParams(filters) },
    headers: authHeader(),
  });
  return res.data;
}

/** Download the current filter set as CSV or JSON through the authenticated request. */
export async function exportCrossInstanceAudit(
  format: 'csv' | 'json',
  filters: AuditFilters,
): Promise<{ blob: Blob; filename: string }> {
  const res = await axios.get<Blob>(`${BASE}/audit/export`, {
    params: { format, ...filterParams(filters) },
    headers: authHeader(),
    responseType: 'blob',
  });
  const disposition = String(
    (res.headers as Record<string, unknown>)?.['content-disposition'] ?? '',
  );
  const filename =
    /filename="?([^";]+)"?/.exec(disposition)?.[1] ??
    `audit-all-${new Date().toISOString().slice(0, 10)}.${format}`;
  return { blob: res.data, filename };
}

export async function getAuditSites(): Promise<AuditSite[]> {
  const res = await axios.get<{ data: AuditSite[] }>(`${BASE}/admin/instances`, {
    headers: authHeader(),
  });
  return res.data.data;
}
