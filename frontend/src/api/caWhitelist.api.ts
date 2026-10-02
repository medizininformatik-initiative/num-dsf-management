/**
 * caWhitelist.api.ts – Admin CRUD for the CA whitelist: the certificate
 * authorities DSF accepts in production, seeded at init with the DSF 2.1.1
 * defaults (CLIENT: CAs that issue DSF client certificates, SERVER: roots a
 * DSF BPE trusts) plus manual additions. Writes carry the TOTP step-up code
 * in OTP sessions; cert sessions omit it (the backend re-verifies the client
 * certificate instead). Mirrors caBlacklist.api.ts.
 * Dependencies: axios, auth.store
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type CaWhitelistKind = 'CLIENT' | 'SERVER';

export interface CaWhitelistRow {
  id: string;
  subject_dn: string;
  /** SHA-256 of the CA certificate DER as 64 upper-case hex; null for DN-only entries. */
  fingerprint: string | null;
  kind: CaWhitelistKind;
  /** Expiry date of the CA certificate; null when unknown. */
  not_after: string | null;
  /** 'dsf-2.1.1' for the seeded DSF defaults, 'manual' for admin additions. */
  source: string;
  reason: string | null;
  added_by: string;
  added_at: string;
}

export interface CaWhitelistData {
  whitelist: CaWhitelistRow[];
  /** CA_WHITELIST_ENFORCE: uploads from CAs outside the list are rejected. */
  enforced: boolean;
}

export interface CaWhitelistAddBody {
  subjectDn: string;
  kind?: CaWhitelistKind;
  /** 64 hex characters (SHA-256). */
  fingerprint?: string;
  reason?: string;
  totpCode?: string;
}

export const caWhitelistApi = {
  list: () =>
    axios.get<{ data: CaWhitelistData }>(`${BASE}/admin/ca-whitelist`, {
      headers: authHeader(),
    }),
  add: (body: CaWhitelistAddBody) => {
    // Send only the keys the caller set, so a cert-mode request never carries
    // a stray totpCode and optional fields stay absent instead of empty.
    const payload: Record<string, string> = { subjectDn: body.subjectDn };
    if (body.kind !== undefined) payload.kind = body.kind;
    if (body.fingerprint !== undefined) payload.fingerprint = body.fingerprint;
    if (body.reason !== undefined) payload.reason = body.reason;
    if (body.totpCode !== undefined) payload.totpCode = body.totpCode;
    return axios.post<{ data: { id: string } }>(`${BASE}/admin/ca-whitelist`, payload, {
      headers: authHeader(),
    });
  },
  remove: (id: string, totpCode?: string) =>
    axios.delete<{ data: { deleted: true } }>(
      `${BASE}/admin/ca-whitelist/${encodeURIComponent(id)}`,
      { headers: authHeader(), data: totpCode !== undefined ? { totpCode } : {} },
    ),
};
