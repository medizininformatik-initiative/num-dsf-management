/**
 * TotpPage.test.tsx — the TOTP code step for subsequent logins. tempToken
 * comes from router location state; authApi is mocked while its real error
 * helpers run. Covers the labelled code input, the switch to backup codes,
 * and the announced errors (role="alert"): a wrong code and a rate limit
 * with its retry time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';

const verifyTotp = vi.hoisted(() => vi.fn());
vi.mock('../../api/auth.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/auth.api')>();
  return { ...actual, authApi: { verifyTotp } };
});

import { TotpPage } from '../TotpPage';

const ROUTE = { pathname: '/totp', state: { tempToken: 'temp-123' } };

function submit(code: string) {
  fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in →' }));
}

beforeEach(() => {
  verifyTotp.mockReset();
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
  });

  it('announces a rate limit with its retry time', async () => {
    verifyTotp.mockRejectedValue({ response: { status: 429, headers: { 'retry-after': '40' } } });
    renderWithProviders(<TotpPage />, { route: ROUTE });
    submit('123456');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please try again in 40 s.',
    );
  });
});
