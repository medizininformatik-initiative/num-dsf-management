/**
 * authMode.ts — single source of truth for the build-time auth mode.
 * VITE_AUTH_MODE=cert enables the login-screen-free, client-certificate
 * deployment variant (see ADR-005). Absent/anything else = the default OTP flow.
 * Dependencies: auth.store, jwt-decode.
 */
import { jwtDecode } from 'jwt-decode';
import { useAuthStore } from '../stores/auth.store';

export function isCertMode(): boolean {
  return import.meta.env.VITE_AUTH_MODE === 'cert';
}

/**
 * Where to send the browser after a lost/expired session. In cert mode there is
 * no login screen — a full reload to `/` re-runs AuthBootstrap, which re-attempts
 * the client-cert login. In OTP mode, go to the login page.
 */
export function reauthRedirect(): void {
  window.location.replace(isCertMode() ? '/' : '/login');
}

/**
 * Whether a sensitive write (approve/reject, user/promotion management, CA
 * blacklist, marketplace, cert-thumbprint changes, incident actions ...) must
 * be confirmed with a TOTP code or TAN. OTP sessions always do. In the
 * certificate deployment an ADMIN session does too, on top of the client
 * certificate the reverse proxy re-verifies; an organization-scoped site
 * session (token claim kind 'org') confirms with the certificate alone.
 */
export function needsTotpStepUp(): boolean {
  if (!isCertMode()) return true;
  const token = useAuthStore.getState().accessToken;
  if (!token) return false;
  try {
    return jwtDecode<{ kind?: string }>(token).kind !== 'org';
  } catch {
    return false;
  }
}
