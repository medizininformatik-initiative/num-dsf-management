/**
 * TotpSetupPage.backup.test.tsx — the backup-codes step after a confirmed
 * TOTP setup, which the codes are never shown again after: Continue stays
 * disabled until "I have stored these codes" is checked, "Copy all" copies
 * every code (one per line), and "Download .txt" saves a text file with the
 * account, the codes and a note through a temporary <a download>. authApi,
 * jwt-decode and sonner are mocked; URL.createObjectURL (absent in jsdom) is
 * stubbed and the anchor click intercepted.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';

const { setupTotp, confirmTotp } = vi.hoisted(() => ({
  setupTotp: vi.fn(),
  confirmTotp: vi.fn(),
}));
vi.mock('../../api/auth.api', () => ({ authApi: { setupTotp, confirmTotp } }));

vi.mock('jwt-decode', () => ({
  jwtDecode: () => ({ sub: 'user-1', email: 'admin@example.org' }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { TotpSetupPage, BACKUP_CODES_FILENAME } from '../TotpSetupPage';

const CODES = ['AAAA1111', 'BBBB2222', 'CCCC3333'];
const ROUTE = {
  pathname: '/totp-setup',
  state: { tempToken: 'temp-123', email: 'admin@example.org' },
};

const createObjectURL = vi.fn((blob: Blob) => (blob ? 'blob:backup-codes' : ''));
const revokeObjectURL = vi.fn();

beforeAll(() => {
  // jsdom implements neither; keep the stubs for the whole file so the delayed
  // revoke never hits an undefined function.
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

beforeEach(() => {
  setupTotp.mockResolvedValue({ data: { data: { qrCodeUrl: 'data:image/png;base64,AAA' } } });
  confirmTotp.mockResolvedValue({ data: { data: { accessToken: 'jwt', backupCodes: CODES } } });
  createObjectURL.mockClear();
  toast.success.mockReset();
  toast.error.mockReset();
  navigate.mockReset();
});

async function gotoBackupStep() {
  renderWithProviders(<TotpSetupPage />, { route: ROUTE });
  fireEvent.click(await screen.findByRole('button', { name: "I've scanned the QR code →" }));
  fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '654321' } });
  fireEvent.click(screen.getByRole('button', { name: 'Complete setup →' }));
  await screen.findByText('Save your backup codes');
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

describe('TotpSetupPage — backup codes', () => {
  it('lists the codes and enables Continue only after the codes are confirmed as stored', async () => {
    await gotoBackupStep();
    const list = screen.getByRole('list', { name: 'Backup codes' });
    CODES.forEach((c) => expect(list).toHaveTextContent(c));

    const continueBtn = screen.getByRole('button', { name: 'Continue →' });
    expect(continueBtn).toBeDisabled();
    fireEvent.click(continueBtn);
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I have stored these codes in a safe place.' }),
    );
    expect(continueBtn).toBeEnabled();
    fireEvent.click(continueBtn);
    expect(navigate).toHaveBeenCalledWith('/app', { replace: true });
  });

  it('copies all codes, one per line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await gotoBackupStep();

    fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('AAAA1111\nBBBB2222\nCCCC3333'));
    expect(toast.success).toHaveBeenCalledWith('Backup codes copied to the clipboard.');
  });

  it('explains a refused clipboard', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await gotoBackupStep();
    fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Could not copy. Download the codes or write them down instead.',
      ),
    );
  });

  it('downloads the codes as a .txt file through a temporary link', async () => {
    let clicked: { download: string; href: string } | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = { download: this.download, href: this.href };
    });
    await gotoBackupStep();

    fireEvent.click(screen.getByRole('button', { name: 'Download .txt' }));

    expect(clicked).toEqual({ download: BACKUP_CODES_FILENAME, href: 'blob:backup-codes' });
    // The temporary link is removed again.
    expect(document.querySelector('a[download]')).toBeNull();
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toContain('text/plain');
    const text = await readBlob(blob);
    expect(text).toContain('two-factor backup codes');
    expect(text).toContain('Account: admin@example.org');
    expect(text).toContain('AAAA1111\nBBBB2222\nCCCC3333');
    expect(text).toContain('Each code can be used once.');
    click.mockRestore();
  });
});
