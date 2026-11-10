/**
 * RequireAuth.test.tsx — the router guard: an unauthenticated visitor goes to
 * /login; an admin certificate session that still has to set up TOTP (the
 * /auth/me flag or the flag set by the interceptor) goes to /totp-enrolment;
 * everyone else sees the app. useMe is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';

const me = vi.hoisted(() => ({
  data: undefined as undefined | { totpEnrolmentRequired?: boolean },
}));
vi.mock('../hooks/useMe', () => ({ useMe: () => ({ data: me.data, isPending: false }) }));

import { RequireAuth } from '../router';

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route path="/app" element={<RequireAuth>app</RequireAuth>} />
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/totp-enrolment" element={<p>enrolment page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  me.data = undefined;
  useAuthStore.getState().clearAuth();
});

describe('RequireAuth', () => {
  it('sends an unauthenticated visitor to the login page', () => {
    renderGuard();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('shows the app to an enrolled, signed-in user', () => {
    useAuthStore.getState().setTokens('t', { id: 'u', email: 'a@b.de' });
    renderGuard();
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('sends a session that must enrol (me flag) to the enrolment page', () => {
    useAuthStore.getState().setTokens('t', { id: 'u', email: 'a@b.de' });
    me.data = { totpEnrolmentRequired: true };
    renderGuard();
    expect(screen.getByText('enrolment page')).toBeInTheDocument();
  });

  it('sends a session to the enrolment page when the interceptor flagged it', () => {
    useAuthStore.getState().setTokens('t', { id: 'u', email: 'a@b.de' });
    useAuthStore.getState().setTotpEnrolmentRequired(true);
    renderGuard();
    expect(screen.getByText('enrolment page')).toBeInTheDocument();
  });
});
