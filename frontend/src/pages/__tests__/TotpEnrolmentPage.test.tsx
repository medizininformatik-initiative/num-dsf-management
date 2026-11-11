/**
 * TotpEnrolmentPage.test.tsx — the forced TOTP setup of a certificate admin:
 * the intro says who needs TOTP and what the TAN list is, then QR code + secret
 * and the first code, then the TAN list with download and print; Continue
 * stays disabled until "I have stored the TAN list" is checked and then clears
 * the enrolment state and goes to /app. meTotpApi and sonner are mocked;
 * URL.createObjectURL and window.open are stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';

const { setup, confirm } = vi.hoisted(() => ({ setup: vi.fn(), confirm: vi.fn() }));
vi.mock('../../api/meTotp.api', () => ({ meTotpApi: { setup, confirm } }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { TotpEnrolmentPage } from '../TotpEnrolmentPage';
import { TAN_LIST_FILENAME } from '../../components/auth/TanListPanel';
import { useAuthStore } from '../../stores/auth.store';

function apiError(status: number, code: string) {
  return { response: { status, data: { error: { code } } } };
}

const TANS = ['AAAA1111', 'BBBB2222', 'CCCC3333'];
const createObjectURL = vi.fn(() => 'blob:tans');

beforeAll(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
});

beforeEach(() => {
  setup
    .mockReset()
    .mockResolvedValue({ qrCodeUrl: 'data:image/png;base64,AAA', secret: 'JBSWY3DP' });
  confirm.mockReset().mockResolvedValue(TANS);
  toast.success.mockReset();
  toast.error.mockReset();
  navigate.mockReset();
  createObjectURL.mockClear();
  useAuthStore.setState({ totpEnrolmentRequired: true });
});

async function toTanList() {
  renderWithProviders(<TotpEnrolmentPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));
  fireEvent.change(await screen.findByLabelText('Authenticator code'), {
    target: { value: '654321' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }));
  await screen.findByRole('list', { name: 'Your TAN list' });
}

describe('TotpEnrolmentPage', () => {
  it('explains who needs TOTP and what the TAN list is before starting', () => {
    renderWithProviders(<TotpEnrolmentPage />);
    expect(screen.getByText(/Only administrators need an authenticator app/)).toBeInTheDocument();
    expect(screen.getByText(/Sites do not need TOTP/)).toBeInTheDocument();
    expect(screen.getByText(/ten single-use codes/)).toBeInTheDocument();
    expect(setup).not.toHaveBeenCalled();
  });

  it('explains it in German too', () => {
    renderWithProviders(<TotpEnrolmentPage />, { lang: 'de' });
    expect(
      screen.getByText(/Nur Administratoren brauchen eine Authenticator-App/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Standorte brauchen kein TOTP/)).toBeInTheDocument();
  });

  it('shows the QR code and the secret as text after Start', async () => {
    renderWithProviders(<TotpEnrolmentPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));
    expect(await screen.findByAltText('QR code for your authenticator app')).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DP')).toBeInTheDocument();
    expect(setup).toHaveBeenCalledWith(undefined);
  });

  it('keeps the setup open and says so when the code is wrong', async () => {
    confirm.mockRejectedValueOnce(apiError(401, 'TOTP_INVALID'));
    renderWithProviders(<TotpEnrolmentPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }));
    fireEvent.change(await screen.findByLabelText('Authenticator code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code');
    expect(screen.queryByRole('list', { name: 'Your TAN list' })).not.toBeInTheDocument();
  });

  it('shows the TAN list; Continue needs the stored confirmation, then leaves the enrolment', async () => {
    await toTanList();
    TANS.forEach((c) => expect(screen.getByText(c)).toBeInTheDocument());
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I have stored the TAN list in a safe place.'));
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(useAuthStore.getState().totpEnrolmentRequired).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/app', { replace: true });
  });

  it('downloads the list as a .txt file and prints it', async () => {
    await toTanList();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /Download \.txt/ }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalled();
    expect(TAN_LIST_FILENAME).toBe('dsf-tan-list.txt');

    const print = vi.fn();
    const printWin = document.implementation.createHTMLDocument('');
    vi.spyOn(window, 'open').mockReturnValue({
      document: printWin,
      focus: vi.fn(),
      print,
    } as unknown as Window);
    fireEvent.click(screen.getByRole('button', { name: /Print/ }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(printWin.body.textContent).toContain('AAAA1111');
    click.mockRestore();
  });
});
