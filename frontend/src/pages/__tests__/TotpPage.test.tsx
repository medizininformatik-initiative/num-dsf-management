/**
 * TotpPage.test.tsx — the TOTP code step for subsequent logins. tempToken
 * comes from router location state; authApi is mocked while its real error
 * helpers run. Covers the labelled code input, the switch to backup codes,
 * and the announced errors (role="alert"): a wrong code and a rate limit
 * with its retry time. A successful code shows the success check (status),
 * stores the session, drops the previous session's query cache and then
 * redirects to /app.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';

const verifyTotp = vi.hoisted(() => vi.fn());
vi.mock('../../api/auth.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/auth.api')>();
  return { ...actual, authApi: { verifyTotp } };
});

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('jwt-decode', () => ({
  jwtDecode: () => ({ sub: 'u-1', email: 'admin@imi-test.example.de' }),
}));

import { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { TotpPage } from '../TotpPage';

const ROUTE = { pathname: '/totp', state: { tempToken: 'temp-123' } };

function submit(code: string) {
  fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in →' }));
}

beforeEach(() => {
  verifyTotp.mockReset();
  navigate.mockReset();
  useAuthStore.getState().clearAuth();
});

describe('TotpPage', () => {
  it('renders the two-factor heading and a labelled code input', () => {
    renderWithProviders(<TotpPage />, { route: ROUTE });
    expect(screen.getByText('Two-factor authentication')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Authenticator code' })).toBeInTheDocument();
  });

  it('switches to backup codes', () => {
    renderWithProviders(<TotpPage />, { route: ROUTE });
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    expect(screen.getByRole('textbox', { name: 'Backup code' })).toHaveAttribute('maxlength', '8');
  });

  it('announces a wrong code', async () => {
    verifyTotp.mockRejectedValue({ response: { status: 401, data: {} } });
    renderWithProviders(<TotpPage />, { route: ROUTE });
    submit('123456');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code. Please try again.');
    expect(verifyTotp).toHaveBeenCalledWith('temp-123', '123456');
    expect(screen.getByLabelText('Authenticator code')).toHaveAttribute('aria-invalid', 'true');
  });

  it('announces a rate limit with its retry time', async () => {
    verifyTotp.mockRejectedValue({ response: { status: 429, headers: { 'retry-after': '40' } } });
    renderWithProviders(<TotpPage />, { route: ROUTE });
    submit('123456');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please try again in 40 s.',
    );
  });

  it('shows the success check, drops the old cache, then opens the app', async () => {
    verifyTotp.mockResolvedValue({ data: { data: { accessToken: 'new.token' } } });
    const clear = vi.spyOn(QueryClient.prototype, 'clear');
    renderWithProviders(<TotpPage />, { route: ROUTE });
    submit('123456');

    expect(await screen.findByRole('status')).toHaveTextContent('Signed in. Opening the portal');
    expect(screen.getByTestId('auth-check')).toBeInTheDocument();
    expect(clear).toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      accessToken: 'new.token',
      user: { id: 'u-1', email: 'admin@imi-test.example.de' },
    });
    // The redirect waits for the check to play.
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app', { replace: true }), {
      timeout: 3000,
    });
    clear.mockRestore();
  });
});
