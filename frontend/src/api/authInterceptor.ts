/**
 * authInterceptor.ts – axios response interceptor: silent token refresh on 401
 * (single-flight), session end when the refresh fails, and the global toasts
 * for 429, 5xx and network errors. A 401 that is a failed step-up (wrong or
 * missing TOTP code, failed certificate re-verification) is NOT a session
 * expiry: it is passed on untouched and published to the step-up error store
 * so the open dialog can explain it, instead of logging the admin out.
 * Dependencies: axios, jwt-decode, auth.api, auth/i18n/stepUpError stores,
 * lib/authMode, lib/getErrorMessage, lib/stepUpErrors, sonner.
 */
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import { authApi } from './auth.api';
import { useAuthStore } from '../stores/auth.store';
import { useI18n } from '../stores/i18n.store';
import { useStepUpErrorStore } from '../stores/stepUpError.store';
import { getErrorCode, getRetryAfterSeconds } from '../lib/getErrorMessage';
import { reauthRedirect } from '../lib/authMode';
import { isStepUpErrorCode } from '../lib/stepUpErrors';

// Single-flight token refresh: when several requests 401 at once, only the
// first triggers POST /auth/refresh; the rest await the same promise. The
// backend rotates the refresh cookie on every call, so concurrent refreshes
// would invalidate each other and log the user out mid-session.
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = authApi
      .refresh()
      .then((res) => {
        const accessToken = res.data.data.accessToken;
        const decoded = jwtDecode<{ sub: string; email: string }>(accessToken);
        useAuthStore.getState().setTokens(accessToken, { id: decoded.sub, email: decoded.email });
        return accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Login-flow routes under /auth/ must not trigger a refresh; /auth/me may.
function refreshable(url: string | undefined): boolean {
  if (!url) return true;
  return !url.includes('/auth/') || /\/auth\/me(\?|$)/.test(url);
}

// Axios interceptors – token refresh + global error handling
export function installAuthInterceptor(): void {
  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const status = error.response?.status;

      // A wrong step-up code is a 401 too, but the session is fine: no
      // refresh, no retry (the code is replay-guarded) and no logout.
      const stepUpCode = getErrorCode(error);
      if (status === 401 && isStepUpErrorCode(stepUpCode)) {
        useStepUpErrorStore.getState().setError(stepUpCode!);
        return Promise.reject(error);
      }

      // 401 – silent token refresh. /auth/* is excluded so the refresh call
      // itself, and login-flow 401s (bad OTP/TOTP), never re-enter the refresh
      // path; /auth/me is session data and refreshes like any API call.
      // _retried bails a request that 401s again after one retry.
      if (status === 401 && !originalRequest._retried && refreshable(originalRequest.url)) {
        originalRequest._retried = true;
        try {
          const accessToken = await refreshAccessToken();
          originalRequest.headers['Authorization'] = `Bearer ${accessToken}`;
          return axios(originalRequest);
        } catch {
          useAuthStore.getState().clearAuth();
          reauthRedirect();
        }
      } else if (status === 401 && originalRequest._retried && refreshable(originalRequest.url)) {
        // Refresh succeeded but the fresh token is still rejected (revoked or a
        // permission 401). Without _retried we'd loop on refresh forever; instead
        // end the session so the user isn't stuck authenticated-but-broken.
        useAuthStore.getState().clearAuth();
        reauthRedirect();
      }

      // 403 TOTP_NOT_CONFIGURED is no session problem either; the dialog explains it.
      if (status === 403 && isStepUpErrorCode(stepUpCode)) {
        useStepUpErrorStore.getState().setError(stepUpCode!);
      }
      // An admin certificate session that has not set up TOTP yet: keep the
      // session and let the router send it to the enrolment page.
      if (status === 403 && stepUpCode === 'TOTP_ENROLMENT_REQUIRED') {
        useAuthStore.getState().setTotpEnrolmentRequired(true);
      }

      // Global error toasts (avoid duplicates with _handled flag)
      if (!error._handled) {
        const { toast } = await import('sonner');
        const t = useI18n.getState().t;
        if (status === 429) {
          // One deduplicated toast (fixed id) however many requests 429 at once.
          // A 429 never touches the session: it is not an auth failure.
          const seconds = getRetryAfterSeconds(error);
          toast.error(seconds ? t('rateLimitedRetry', { seconds }) : t('rateLimited'), {
            id: 'rate-limited',
          });
          error._handled = true;
        } else if (status >= 500) {
          toast.error(t('serverError'));
          error._handled = true;
        } else if (!error.response) {
          toast.error(t('networkError'));
          error._handled = true;
        }
      }

      return Promise.reject(error);
    },
  );
}
