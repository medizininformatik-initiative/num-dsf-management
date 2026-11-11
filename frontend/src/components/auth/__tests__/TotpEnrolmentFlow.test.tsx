/**
 * TotpEnrolmentFlow.test.tsx — the enrolment explains a failed confirmation by
 * its backend error code (wrong code with the two usual causes, code already
 * used, expired setup with a "Restart setup" that shows the NEW QR code, rate
 * limit, anything else with a support code), keeps the typed code on network
 * and server errors, and is immune to a /auth/me refetch (no remount, no second
 * setup call). meTotpApi and authApi are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../../test/renderWithProviders';

const { setup, confirm } = vi.hoisted(() => ({ setup: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../api/meTotp.api', () => ({ meTotpApi: { setup, confirm } }));

const getMe = vi.hoisted(() => vi.fn());
vi.mock('../../../api/auth.api', () => ({ authApi: { getMe } }));

import { TotpEnrolmentFlow } from '../TotpEnrolmentFlow';
import { confirmErrorKind } from '../../../lib/totpConfirmError';
import { RequireAuth } from '../../../router';
import { TotpEnrolmentPage } from '../../../pages/TotpEnrolmentPage';
import { useAuthStore } from '../../../stores/auth.store';
import { useI18n } from '../../../stores/i18n.store';

function apiError(status: number, code: string) {
  return { response: { status, data: { error: { code } } } };
}

const QR_A = 'data:image/png;base64,AAA';
const QR_B = 'data:image/png;base64,BBB';

beforeEach(() => {
  setup.mockReset().mockResolvedValue({ qrCodeUrl: QR_A, secret: 'SECRETAAA' });
  confirm.mockReset();
  getMe.mockReset().mockResolvedValue({ data: { data: { email: 'a@b.de', isAdmin: true } } });
  useAuthStore.getState().setTokens('t', { id: 'u', email: 'a@b.de' });
});

async function openScan(lang: 'en' | 'de' = 'en') {
  renderWithProviders(<TotpEnrolmentFlow continueLabel="Go" onFinished={() => {}} />, { lang });
  await screen.findByAltText(/QR|Code/);
}

async function submit(code = '123456') {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /Complete setup|Einrichtung abschließen/ }));
  return input as HTMLInputElement;
}

describe('confirmErrorKind', () => {
  it('maps the backend codes and the 429 status', () => {
    expect(confirmErrorKind(apiError(401, 'TOTP_INVALID'))).toBe('invalid');
    expect(confirmErrorKind(apiError(401, 'TOTP_CODE_USED'))).toBe('used');
    expect(confirmErrorKind(apiError(409, 'TOTP_ENROLMENT_EXPIRED'))).toBe('expired');
    expect(confirmErrorKind({ response: { status: 429, data: {} } })).toBe('rate');
    expect(confirmErrorKind(new Error('Network Error'))).toBe('other');
  });
});

describe('TotpEnrolmentFlow confirm errors', () => {
  it('tells the user to delete old entries on the scan step', async () => {
    await openScan();
    expect(screen.getByText(/Delete older 'DSF' entries/)).toBeInTheDocument();
  });

  it('wrong code: says so, names the two usual causes and clears the field', async () => {
    confirm.mockRejectedValueOnce(apiError(401, 'TOTP_INVALID'));
    await openScan();
    const input = await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code');
    expect(screen.getByText(/older entry in your app/)).toBeInTheDocument();
    expect(screen.getByText(/clock of your phone/)).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  it('code already used: has its own message', async () => {
    confirm.mockRejectedValueOnce(apiError(401, 'TOTP_CODE_USED'));
    await openScan();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('already used');
  });

  it('rate limited: asks to wait, keeps the code', async () => {
    confirm.mockRejectedValueOnce({ response: { status: 429, data: {} } });
    await openScan();
    const input = await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
    expect(input.value).toBe('123456');
  });

  it('network or server error: generic text with the code for support, keeps the code', async () => {
    confirm.mockRejectedValueOnce(apiError(500, 'INTERNAL_ERROR'));
    await openScan();
    const input = await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be checked');
    expect(screen.getByText('Error code for support: INTERNAL_ERROR')).toBeInTheDocument();
    expect(input.value).toBe('123456');

    confirm.mockRejectedValueOnce(new Error('Network Error'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }));
    expect(await screen.findByText('Error code for support: NETWORK')).toBeInTheDocument();
  });

  it('is translated to German', async () => {
    confirm.mockRejectedValueOnce(apiError(401, 'TOTP_CODE_USED'));
    await openScan('de');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('bereits verwendet');
  });

  it('expired setup: offers a restart that shows the NEW QR code and the delete-old-entry note', async () => {
    confirm.mockRejectedValueOnce(apiError(409, 'TOTP_ENROLMENT_EXPIRED'));
    await openScan();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    setup.mockResolvedValueOnce({ qrCodeUrl: QR_B, secret: 'SECRETBBB' });
    fireEvent.click(screen.getByRole('button', { name: 'Restart setup' }));
    expect(await screen.findByText('SECRETBBB')).toBeInTheDocument();
    expect(setup).toHaveBeenLastCalledWith(undefined, true);
    expect(screen.getByText(/Delete the old entry in your app/)).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', QR_B);
    expect(screen.queryByRole('button', { name: 'Restart setup' })).not.toBeInTheDocument();
  });

  it('marks the code field against password-manager autofill', async () => {
    await openScan();
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('data-1p-ignore');
    expect(input).toHaveAttribute('data-lpignore', 'true');
    expect(input).toHaveAttribute('data-bwignore');
  });
});

describe('TotpEnrolmentPage under RequireAuth', () => {
  it('survives an /auth/me refetch: same QR, typed code kept, setup called once', async () => {
    useI18n.getState().setLang('en');
    getMe.mockResolvedValue({
      data: { data: { email: 'a@b.de', isAdmin: true, totpEnrolmentRequired: true } },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/totp-enrolment']}>
          <Routes>
            <Route
              path="/totp-enrolment"
              element={
                <RequireAuth allowUnenrolled>
                  <TotpEnrolmentPage />
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start setup' }));
    const input = (await screen.findByLabelText('Authenticator code')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });

    getMe.mockClear();
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    await waitFor(() => expect(getMe).toHaveBeenCalled());

    expect((screen.getByLabelText('Authenticator code') as HTMLInputElement).value).toBe('12');
    expect(screen.getByText('SECRETAAA')).toBeInTheDocument();
    expect(setup).toHaveBeenCalledTimes(1);
  });

  function renderRouted(route: string, queryClient: QueryClient) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route
              path="/totp-enrolment"
              element={
                <RequireAuth allowUnenrolled>
                  <TotpEnrolmentPage />
                </RequireAuth>
              }
            />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <p>app page</p>
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('finishing the enrolment lands on /app even while /auth/me is still cached as required', async () => {
    useI18n.getState().setLang('en');
    useAuthStore.setState({ totpEnrolmentRequired: true });
    // The refetch after finishing never resolves in time: only the cache decides.
    const required = { email: 'a@b.de', isAdmin: true, totpEnrolmentRequired: true };
    getMe.mockResolvedValueOnce({ data: { data: required } });
    confirm.mockResolvedValue(['AAAA1111', 'BBBB2222']);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderRouted('/totp-enrolment', queryClient);
    fireEvent.click(await screen.findByRole('button', { name: 'Start setup' }));
    fireEvent.change(await screen.findByLabelText('Authenticator code'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }));
    await screen.findByRole('list', { name: 'Your TAN list' });
    getMe.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByLabelText('I have stored the TAN list in a safe place.'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('app page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start setup' })).not.toBeInTheDocument();
  });

  it('sends an already enrolled user from /totp-enrolment to /app', async () => {
    useI18n.getState().setLang('en');
    useAuthStore.setState({ totpEnrolmentRequired: false });
    getMe.mockResolvedValue({
      data: { data: { email: 'a@b.de', isAdmin: true, totpEnrolmentRequired: false } },
    });
    renderRouted(
      '/totp-enrolment',
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    expect(await screen.findByText('app page')).toBeInTheDocument();
    expect(setup).not.toHaveBeenCalled();
  });

  it('keeps the TAN list open when /auth/me turns not-required during the enrolment', async () => {
    useI18n.getState().setLang('en');
    useAuthStore.setState({ totpEnrolmentRequired: false });
    getMe.mockResolvedValueOnce({
      data: { data: { email: 'a@b.de', isAdmin: true, totpEnrolmentRequired: true } },
    });
    confirm.mockResolvedValue(['AAAA1111']);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderRouted('/totp-enrolment', queryClient);
    fireEvent.click(await screen.findByRole('button', { name: 'Start setup' }));
    fireEvent.change(await screen.findByLabelText('Authenticator code'), {
      target: { value: '654321' },
    });
    getMe.mockResolvedValue({
      data: { data: { email: 'a@b.de', isAdmin: true, totpEnrolmentRequired: false } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }));
    await screen.findByRole('list', { name: 'Your TAN list' });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    expect(screen.getByRole('list', { name: 'Your TAN list' })).toBeInTheDocument();
  });
});

describe('TotpEnrolmentFlow start on an enrolled account', () => {
  it.each([
    ['en', 'TOTP is already set up', 'Continue to the app'],
    ['de', 'TOTP ist bereits eingerichtet', 'Weiter zur Anwendung'],
  ] as const)('explains TOTP_REQUIRED (%s) and links to the app', async (lang, msg, link) => {
    setup.mockRejectedValueOnce(apiError(400, 'TOTP_REQUIRED'));
    renderWithProviders(<TotpEnrolmentFlow showIntro continueLabel="Go" onFinished={() => {}} />, {
      lang,
    });
    fireEvent.click(
      screen.getByRole('button', { name: lang === 'en' ? 'Start setup' : 'Einrichtung starten' }),
    );
    expect(await screen.findByText(new RegExp(msg))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: link })).toHaveAttribute('href', '/app');
  });
});
