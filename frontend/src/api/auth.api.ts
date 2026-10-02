/**
 * auth.api.ts – Axios client for all auth endpoints
 * Auth routes live at /auth/* (not under /api/v1/).
 *
 * Uses the default axios singleton — the same instance the rest of the app and
 * the main.tsx interceptors (refresh + error toasts) and the demo mock-adapter
 * hook — so a 401 on /auth/me and global error handling run consistently. The
 * 401-refresh interceptor excludes /auth/*, so these calls never recurse.
 * Also exports the error helpers the sign-in screens use to tell a rate limit
 * (with its retry time) or a transport failure apart from a wrong code.
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

// withCredentials is required so the browser sends the httpOnly refresh cookie
// on /auth/refresh and /auth/logout. Set per-request (not on axios.defaults) so
// the Bearer-only entity APIs on the same singleton are unaffected.
const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
const authConfig = {
  baseURL: baseOrigin,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
};

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface OtpRequestResponse {
  data: { message: string };
}

export interface OtpVerifyResponse {
  data: { tempToken: string; requiresTotpSetup: boolean };
}

export interface TotpSetupResponse {
  data: { qrCodeUrl: string };
}

export interface TotpConfirmResponse {
  data: { accessToken: string; backupCodes: string[] };
}

export interface TotpVerifyResponse {
  data: { accessToken: string };
}

interface HttpErrorLike {
  response?: { status?: number; headers?: Record<string, unknown> };
}

/** True when an auth request was refused by a rate limit (HTTP 429). */
export function isRateLimited(err: unknown): boolean {
  return (err as HttpErrorLike)?.response?.status === 429;
}

/** True when the request never got an HTTP response (offline, DNS, CORS, timeout). */
export function isTransportError(err: unknown): boolean {
  return (err as HttpErrorLike)?.response?.status == null;
}

/**
 * Seconds until a rate-limited (429) auth request may be retried, from the
 * Retry-After header (seconds or HTTP date) or the RateLimit-Reset header that
 * express-rate-limit sends; null when unknown (nginx 429s carry neither) or
 * when the error is not a 429.
 */
export function retryAfterSeconds(err: unknown, now: number = Date.now()): number | null {
  if (!isRateLimited(err)) return null;
  const headers = (err as HttpErrorLike).response?.headers ?? {};
  const read = (name: string): string | null => {
    const value = headers[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : null;
  };
  const retryAfter = read('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - now) / 1000));
  }
  const reset = read('ratelimit-reset');
  if (reset && Number.isFinite(Number(reset))) return Math.max(0, Math.ceil(Number(reset)));
  return null;
}

/** A wait in seconds as "45 s" or, from a minute on, rounded up to "15 min". */
export function formatWait(seconds: number): string {
  return seconds < 60 ? `${Math.max(1, Math.ceil(seconds))} s` : `${Math.ceil(seconds / 60)} min`;
}

export const authApi = {
  requestOtp: (email: string) =>
    axios.post<OtpRequestResponse>('/auth/request-otp', { email }, authConfig),

  verifyOtp: (email: string, code: string) =>
    axios.post<OtpVerifyResponse>('/auth/verify-otp', { email, code }, authConfig),

  setupTotp: (tempToken: string) =>
    axios.post<TotpSetupResponse>('/auth/setup-totp', { tempToken }, authConfig),

  confirmTotp: (tempToken: string, code: string) =>
    axios.post<TotpConfirmResponse>('/auth/confirm-totp', { tempToken, code }, authConfig),

  verifyTotp: (tempToken: string, code: string) =>
    axios.post<TotpVerifyResponse>('/auth/verify-totp', { tempToken, code }, authConfig),

  refresh: () =>
    axios.post<{ data: { accessToken: string } }>('/auth/refresh', undefined, authConfig),

  logout: (email: string) =>
    axios.post('/auth/logout', { email }, authConfig),

  clientCertLogin: () =>
    axios.post<{ data: { accessToken: string; email: string } }>(
      '/auth/client-cert-login',
      undefined,
      authConfig,
    ),

  devLogin: (role?: 'admin' | 'member' | 'site') =>
    axios.post<{ data: { accessToken: string; email: string; role: 'admin' | 'member' | 'site' } }>(
      '/auth/dev-login',
      role ? { role } : {},
      authConfig,
    ),

  getMe: () =>
    axios.get<{ data: { email: string; isAdmin: boolean } }>('/auth/me', {
      ...authConfig,
      headers: { ...authConfig.headers, ...authHeader() },
    }),
};
