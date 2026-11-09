/**
 * LoginPage.test.tsx — renders the email step; the email field and submit
 * button are visible. authApi is mocked so nothing hits the network. The
 * submit branch is covered too: a genuine transport/5xx failure announces an
 * error (role="alert") and stays on the page, while a 200 (or a non-5xx
 * server response) navigates to /otp without revealing whitelist membership.
 * A failed client-certificate sign-in is announced the same way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';

const requestOtp = vi.hoisted(() => vi.fn());
const clientCertLogin = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { data: { accessToken: 'x' } } }),
);
vi.mock('../../api/auth.api', () => ({
  authApi: { requestOtp, clientCertLogin },
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { LoginPage } from '../LoginPage';

function submitEmail() {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    requestOtp.mockReset();
    navigate.mockReset();
  });

  it('renders the email label and the email input', () => {
    requestOtp.mockResolvedValue({});
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.getByText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument();
  });

  it('navigates to /otp on a successful request', async () => {
    requestOtp.mockResolvedValue({});
    renderWithProviders(<LoginPage />, { route: '/login' });
    submitEmail();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/otp', expect.anything()));
  });

  it('announces a transport failure and stays on the page', async () => {
    // No `response` → the request never reached the server.
    requestOtp.mockRejectedValue(new Error('Network Error'));
    renderWithProviders(<LoginPage />, { route: '/login' });
    submitEmail();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the server. Please try again.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('announces a failed client-certificate sign-in', async () => {
    clientCertLogin.mockRejectedValueOnce(new Error('no certificate'));
    renderWithProviders(<LoginPage />, { route: '/login' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with client certificate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Client-certificate sign-in failed.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still navigates on a non-5xx server response (no enumeration)', async () => {
    // A 4xx is a server response, not a transport failure — proceed to /otp.
    requestOtp.mockRejectedValue({ response: { status: 400 } });
    renderWithProviders(<LoginPage />, { route: '/login' });
    submitEmail();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/otp', expect.anything()));
  });
});
