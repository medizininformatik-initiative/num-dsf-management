/**
 * entities.api.ts – Axios client for all entity endpoints
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

// VITE_API_URL already includes /api/v1 (e.g. http://localhost/api/v1)
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

/** One published version of an endpoint's allow list, from GET /bundle-history. */
export interface BundleHistoryEntry {
  versionNumber: number;
  createdAt: string;
  triggeredBy: 'APPROVAL' | 'MANUAL' | 'RESTORE';
  notes: string | null;
  isCurrent: boolean;
}

/** A certificate as the certificates API returns it (never the PEM). */
export interface ApiCertificate {
  id: string;
  organization_id: string;
  subject: string;
  /** SHA-256 of the DER, upper-case hex (portal-internal matching). */
  thumbprint: string;
  /** DSF thumbprint: SHA-512 of the DER, 128 lower-case hex, as published in the allow list. */
  thumbprintSha512: string;
  valid_until: string;
  created_at: string;
  /** Issuer DN in certificate order, e.g. "C=GR,O=...,CN=GEANT TLS RSA 1". */
  issuerDn: string;
  /** True when the issuer is a CA the DSF accepts in production (CA whitelist). */
  issuerTrusted: boolean;
}

/** What an upload would register, from POST /certificates/preview (nothing is stored). */
export interface CertificatePreview {
  subject: string;
  validUntil: string;
  thumbprint: string;
  thumbprintSha512: string;
  issuerDn: string;
  issuerTrusted: boolean;
  /** The upload would be refused with CA_BLACKLISTED. */
  issuerBlacklisted: boolean;
  /** Uploads from issuers outside the CA whitelist are refused (CA_NOT_WHITELISTED). */
  whitelistEnforced: boolean;
}

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function api(instanceId: string) {
  const base = `${BASE}/instances/${instanceId}`;
  return {
    getInstances: () =>
      axios.get(`${BASE}/instances`, { headers: authHeader() }),
    createInstance: (data: { label: string }) =>
      axios.post(`${BASE}/instances`, data, { headers: authHeader() }),
    getInstance: (id: string) =>
      axios.get(`${BASE}/instances/${id}`, { headers: authHeader() }),

    getOrganization: () =>
      axios.get(`${base}/organization`, { headers: authHeader() }),
    updateOrganization: (data: object) =>
      axios.put(`${base}/organization`, data, { headers: authHeader() }),

    getContacts: () =>
      axios.get(`${base}/contacts`, { headers: authHeader() }),
    createContact: (data: object) =>
      axios.post(`${base}/contacts`, data, { headers: authHeader() }),
    updateContact: (id: string, data: object) =>
      axios.put(`${base}/contacts/${id}`, data, { headers: authHeader() }),
    deleteContact: (id: string) =>
      axios.delete(`${base}/contacts/${id}`, { headers: authHeader() }),

    getEndpoints: () =>
      axios.get(`${base}/endpoints`, { headers: authHeader() }),
    createEndpoint: (data: object) =>
      axios.post(`${base}/endpoints`, data, { headers: authHeader() }),
    updateEndpoint: (id: string, data: object) =>
      axios.put(`${base}/endpoints/${id}`, data, { headers: authHeader() }),
    deleteEndpoint: (id: string) =>
      axios.delete(`${base}/endpoints/${id}`, { headers: authHeader() }),

    getCertificates: () =>
      axios.get(`${base}/certificates`, { headers: authHeader() }),
    createCertificate: (pem: string) =>
      axios.post(`${base}/certificates`, { pem }, { headers: authHeader() }),
    previewCertificate: (pem: string) =>
      axios.post(`${base}/certificates/preview`, { pem }, { headers: authHeader() }),
    deleteCertificate: (id: string) =>
      axios.delete(`${base}/certificates/${id}`, { headers: authHeader() }),
    renewCertificate: (certId: string, pem: string) =>
      axios.post(`${base}/certificates/${certId}/renew`, { pem }, { headers: authHeader() }),

    getMemberships: () =>
      axios.get(`${base}/memberships`, { headers: authHeader() }),
    createMembership: (data: object) =>
      axios.post(`${base}/memberships`, data, { headers: authHeader() }),
    updateMembership: (id: string, data: object) =>
      axios.put(`${base}/memberships/${id}`, data, { headers: authHeader() }),
    deleteMembership: (id: string) =>
      axios.delete(`${base}/memberships/${id}`, { headers: authHeader() }),

    getApprovalStatus: () =>
      axios.get(`${base}/approval/status`, { headers: authHeader() }),
    getApprovalHistory: () =>
      axios.get(`${base}/approval/history`, { headers: authHeader() }),
    submitApproval: () =>
      axios.post(`${base}/approval/submit`, {}, { headers: authHeader() }),

    downloadBundle: (endpointId: string, version?: number) =>
      axios.get(
        `${base}/download/bundle?endpointId=${encodeURIComponent(endpointId)}` +
          (version === undefined ? '' : `&version=${version}`),
        { headers: authHeader(), responseType: 'blob' },
      ),
    getBundleHistory: (endpointId: string) =>
      axios.get<{ data: BundleHistoryEntry[] }>(
        `${base}/bundle-history?endpointId=${encodeURIComponent(endpointId)}`,
        { headers: authHeader() },
      ),
    downloadIpList: () =>
      axios.get(`${BASE}/download/ip-address-list`, {
        headers: authHeader(), responseType: 'blob',
      }),

    getAuditLog: (params: string) =>
      axios.get(`${base}/audit?${params}`, { headers: authHeader() }),

    getExpiringCerts: () =>
      axios.get(`${base}/certificates/expiring`, { headers: authHeader() }),

    resendVerification: (contactId: string) =>
      axios.post(`${base}/contacts/${contactId}/resend-verification`, {}, { headers: authHeader() }),
  };
}

export { api };

export async function downloadFullAllowListBundle() {
  return axios.get(`${BASE}/download/full-bundle`, {
    headers: authHeader(),
    responseType: 'blob',
  });
}
