/**
 * AuthBootstrap.tsx – Tries to restore session on page load.
 *
 * On mount, calls POST /auth/refresh (browser sends httpOnly cookie automatically).
 * If the refresh token cookie is valid → new access token → user stays logged in.
 * If not → no-op, user sees login page.
 *
 * SECURITY: Access token still only in memory (Zustand). Never localStorage.
 * The refresh token is httpOnly — JS can't read it, browser sends it automatically.
 * While restoring, the sign-in hero is shown on the ambient background: the
 * BrandMark with its intro, an indeterminate gradient bar and a translated
 * status line (role="status"); static under Reduce Motion.
 */
import { useEffect, useState, ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';
import { toast } from 'sonner';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth.api';
import { getRetryAfterSeconds } from '../lib/getErrorMessage';
import { useI18n } from '../stores/i18n.store';
import { useAuthStore } from '../stores/auth.store';
import { isCertMode, reauthRedirect } from '../lib/authMode';
import { CertStatusPage } from '../pages/CertStatusPage';
import { AuthAmbient } from './auth/AuthAmbient';
import { AuthHero } from './auth/AuthHero';

type DevRole = 'admin' | 'member' | 'site';

/** Case-insensitive, whitespace-tolerant ?devRole= parsing. */
export function normalizeDevRole(raw: string | null): DevRole | null {
  const v = raw?.trim().toLowerCase();
  return v === 'admin' || v === 'member' || v === 'site' ? v : null;
}

let devRoleLoginFlight: Promise<void> | null = null;

const DEV_LOGIN_RETRY_MS = 600;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type RefreshResult = Awaited<ReturnType<typeof authApi.refresh>>;
let refreshFlight: Promise<RefreshResult> | null = null;

/**
 * POST /auth/refresh, shared by concurrent callers (StrictMode double effect;
 * the backend rotates the cookie, so parallel refreshes invalidate each other)
 * and retried once on a 429/5xx so a throttle does not look like
 * "no session" and dump the user on the login page.
 */
function refreshWithRetry(): Promise<RefreshResult> {
  refreshFlight ??= (async () => {
    try {
      return await authApi.refresh();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === undefined || (status < 500 && status !== 429)) throw err;
      const wait = Math.min(getRetryAfterSeconds(err) ?? 1, 3) * 1000;
      await sleep(wait);
      return authApi.refresh();
    }
  })().finally(() => {
    refreshFlight = null;
  });
  return refreshFlight;
}

async function devLoginAs(role: DevRole | undefined, queryClient: QueryClient) {
  const dev = await authApi.devLogin(role);
  const accessToken = dev.data.data.accessToken;
  const decoded: any = jwtDecode(accessToken);
  useAuthStore.getState().setTokens(accessToken, {
    id: decoded.sub,
    email: decoded.email,
  });
  // Drop any cache from a prior session (esp. ['me']) so role/admin status
  // refetches with the new token instead of returning stale isAdmin=false.
  queryClient.clear();
  // Seed ['me'] with the new token BEFORE the app mounts, so the Administration
  // entry never depends on a query racing the login.
  try {
    const me = await authApi.getMe();
    queryClient.setQueryData(['me'], me.data.data);
  } catch {
    /* useMe will fetch it itself */
  }
}

/** Deterministic ?devRole= login: clear, log in (one retry), drop the param. */
async function runDevRoleLogin(role: DevRole, queryClient: QueryClient) {
  useAuthStore.getState().clearAuth();
  queryClient.clear();
  try {
    try {
      await devLoginAs(role, queryClient);
    } catch {
      // Transient failure (429 from the nginx auth zone, backend restarting).
      await sleep(DEV_LOGIN_RETRY_MS);
      await devLoginAs(role, queryClient);
    }
    // Strip the param so a reload does not re-trigger (and re-clear) the login.
    const url = new URL(window.location.href);
    url.searchParams.delete('devRole');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch {
    toast.error(useI18n.getState().t('devLoginFailed'), { id: 'dev-login-failed' });
  }
}

export function AuthBootstrap({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  // undefined = not in cert-error state; null = checking; string = backend error code
  const [certError, setCertError] = useState<string | null | undefined>(undefined);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Dev-only URL shortcut: ?devRole=admin|member|site (any case) forces a
    // fresh dev-login. Overrides any existing session so you can switch roles
    // by URL.
    const devRole = import.meta.env.DEV
      ? normalizeDevRole(new URLSearchParams(window.location.search).get('devRole'))
      : null;

    if (devRole) {
      // Single-flight: React StrictMode runs this effect twice; both runs must
      // share ONE login, otherwise the second response lands after children
      // mounted and queryClient.clear() wipes their in-flight ['me'] query.
      devRoleLoginFlight ??= runDevRoleLogin(devRole, queryClient).finally(() => {
        devRoleLoginFlight = null;
      });
      devRoleLoginFlight.finally(() => setReady(true));
      return;
    }

    if (useAuthStore.getState().isAuthenticated) {
      setReady(true);
      return;
    }

    // Try to restore session via refresh token cookie.
    // On failure in a Vite dev build, try DEV_AUTO_LOGIN as a last-resort
    // shortcut. The backend refuses unless NODE_ENV !== 'production' AND
    // DEV_AUTO_LOGIN === 'true', so this is a no-op in production.
    refreshWithRetry()
      .then((res) => {
        const accessToken = res.data.data.accessToken;
        const decoded: any = jwtDecode(accessToken);
        useAuthStore.getState().setTokens(accessToken, {
          id: decoded.sub,
          email: decoded.email,
        });
        queryClient.clear();
      })
      .catch(async () => {
        if (isCertMode()) {
          setCertError(null); // show the "checking" state while we try the cert
          try {
            const res = await authApi.clientCertLogin();
            const accessToken = res.data.data.accessToken;
            const decoded: any = jwtDecode(accessToken);
            useAuthStore.getState().setTokens(accessToken, {
              id: decoded.sub,
              email: decoded.email,
            });
            queryClient.clear();
            setCertError(undefined);
          } catch (e: any) {
            setCertError(e?.response?.data?.error?.code ?? 'UNKNOWN');
          }
          return;
        }
        if (!import.meta.env.DEV) return;
        try {
          await devLoginAs(undefined, queryClient);
        } catch {
          /* dev-login disabled — fall through to login page */
        }
      })
      .finally(() => {
        setReady(true);
      });
  }, []);

  // Idle timeout – 30 minutes of inactivity triggers logout
  useEffect(() => {
    if (!isAuthenticated) return;

    const IDLE_MS = 30 * 60 * 1000; // 30 minutes
    const WARNING_MS = 2 * 60 * 1000; // warn 2 min before
    let idleTimer: ReturnType<typeof setTimeout>;
    let warnTimer: ReturnType<typeof setTimeout>;
    let warningShown = false;

    function resetTimers() {
      clearTimeout(idleTimer);
      clearTimeout(warnTimer);
      warningShown = false;

      warnTimer = setTimeout(() => {
        if (!warningShown) {
          warningShown = true;
          toast.warning(useI18n.getState().t('sessionExpiring'));
        }
      }, IDLE_MS - WARNING_MS);

      idleTimer = setTimeout(() => {
        useAuthStore.getState().clearAuth();
        toast.error(useI18n.getState().t('sessionExpired'));
        reauthRedirect();
      }, IDLE_MS);
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((event) => document.addEventListener(event, resetTimers));
    resetTimers();

    return () => {
      clearTimeout(idleTimer);
      clearTimeout(warnTimer);
      events.forEach((event) => document.removeEventListener(event, resetTimers));
    };
  }, [isAuthenticated]);

  // In cert mode the cert-login attempt drives the CertStatusPage (code=null
  // while checking, an error code on failure). Check it before the generic
  // "restoring session" spinner so the cert-specific UX is shown.
  if (certError !== undefined) {
    return <CertStatusPage code={certError} />;
  }

  if (!ready) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-[color:var(--bg-page)] px-4 font-sans">
        <AuthAmbient />
        <div className="relative z-[1] flex flex-col items-center gap-6 text-center">
          <AuthHero />
          <div className="auth-progress" aria-hidden="true">
            <span />
          </div>
          <p role="status" className="m-0 text-xs text-[color:var(--text-secondary)]">
            {t('authRestoringSession')}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
