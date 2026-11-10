/**
 * auth.store.ts – Zustand store for auth state
 * accessToken kept in memory (never localStorage/sessionStorage – XSS protection)
 * Refresh token lives as httpOnly cookie – not accessible from JS
 * totpEnrolmentRequired is raised when the backend answers 403
 * TOTP_ENROLMENT_REQUIRED (a certificate admin who has not set up TOTP yet);
 * the router then sends the session to the enrolment page.
 */
import { create } from 'zustand';

interface AuthUser {
  email: string;
  id: string;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  totpEnrolmentRequired: boolean;

  setTokens: (accessToken: string, user: AuthUser) => void;
  setTotpEnrolmentRequired: (required: boolean) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  totpEnrolmentRequired: false,

  setTokens: (accessToken, user) => set({ accessToken, user, isAuthenticated: true }),

  setTotpEnrolmentRequired: (required) => set({ totpEnrolmentRequired: required }),

  clearAuth: () =>
    set({ accessToken: null, user: null, isAuthenticated: false, totpEnrolmentRequired: false }),
}));
