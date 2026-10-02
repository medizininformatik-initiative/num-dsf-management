/**
 * CaWhitelistAddForm.test.tsx — the collapsible "add a CA to the whitelist"
 * form. caWhitelistApi and sonner are mocked. Covers the disclosure toggle,
 * the backend-mirroring validation (DN length, 64-hex fingerprint with
 * colons allowed, 6-digit TOTP in OTP mode), the request body (kind,
 * normalised fingerprint, reason, code), filling the fingerprint from a known
 * CA, the inline duplicate message (409 CONFLICT), and cert mode, where no
 * TOTP field renders and the body carries no totpCode or empty optional keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { KnownCaRow } from '../../../api/caBlacklist.api';

const addMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api/caWhitelist.api', () => ({
  caWhitelistApi: { list: vi.fn(), add: addMock, remove: vi.fn() },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const authMode = vi.hoisted(() => ({ cert: false }));
vi.mock('../../../lib/authMode', () => ({
  isCertMode: () => authMode.cert,
  needsTotpStepUp: () => !authMode.cert,
}));

import { CaWhitelistAddForm } from '../CaWhitelistAddForm';

const KNOWN: KnownCaRow[] = [
  {
    fingerprint: 'AB12'.repeat(16),
    subject_dn: 'C=US,O=Example Trust Network,CN=Example RSA Root',
    source: 'mozilla',
    synced_at: '2026-10-01T00:00:00Z',
  },
];

function open() {
  renderWithProviders(<CaWhitelistAddForm knownCas={KNOWN} />);
  const toggle = screen.getByRole('button', { name: 'Add a CA to the whitelist' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

beforeEach(() => {
  authMode.cert = false;
  addMock.mockReset();
  addMock.mockResolvedValue({ data: { data: { id: 'new' } } });
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('CaWhitelistAddForm', () => {
  it('starts collapsed', () => {
    renderWithProviders(<CaWhitelistAddForm knownCas={[]} />);
    expect(screen.getByTestId('ca-whitelist-subject-input')).not.toBeVisible();
  });

  it('validates the fingerprint and sends kind, normalised fingerprint, reason and code', async () => {
    open();
    const add = screen.getByTestId('ca-whitelist-add-btn');
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByTestId('ca-whitelist-subject-input'), {
      target: { value: '  C=DE,O=Example Lab,CN=Example Federation Root  ' },
    });
    fireEvent.click(screen.getByLabelText('Server root'));

    const fp = screen.getByTestId('ca-whitelist-fingerprint-input');
    fireEvent.change(fp, { target: { value: 'AB:CD' } });
    fireEvent.blur(fp);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter the 64 hex characters of the SHA-256 fingerprint.',
    );

    const hex = 'ABCD'.repeat(16);
    fireEvent.change(fp, { target: { value: hex.match(/.{2}/g)!.join(':') } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'new federation root' } });
    // Still disabled: the TOTP code is missing.
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByTestId('ca-whitelist-totp-input'), {
      target: { value: '123456' },
    });
    expect(add).toBeEnabled();

    fireEvent.click(add);
    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1));
    expect(addMock.mock.calls[0][0]).toEqual({
      subjectDn: 'C=DE,O=Example Lab,CN=Example Federation Root',
      kind: 'SERVER',
      fingerprint: 'abcd'.repeat(16),
      reason: 'new federation root',
      totpCode: '123456',
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('CA added to the whitelist.'));
    expect(screen.getByTestId('ca-whitelist-subject-input')).toHaveValue('');
  });

  it('fills in the fingerprint when a known CA is picked', () => {
    open();
    fireEvent.change(screen.getByTestId('ca-whitelist-subject-input'), {
      target: { value: 'C=US,O=Example Trust Network,CN=Example RSA Root' },
    });
    expect(screen.getByTestId('ca-whitelist-fingerprint-input')).toHaveValue('AB12'.repeat(16));
  });

  it('reports a CA that is already on the whitelist inline', async () => {
    addMock.mockRejectedValue({
      response: { status: 409, data: { error: { code: 'CONFLICT', message: 'duplicate' } } },
    });
    open();
    fireEvent.change(screen.getByTestId('ca-whitelist-subject-input'), {
      target: { value: 'CN=Example Issuing CA 2022' },
    });
    fireEvent.change(screen.getByTestId('ca-whitelist-totp-input'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByTestId('ca-whitelist-add-btn'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This CA is already on the whitelist.',
    );
    expect(toast.error).not.toHaveBeenCalled();
    // The spent code is cleared for the next attempt.
    expect(screen.getByTestId('ca-whitelist-totp-input')).toHaveValue('');
  });
});

describe('CaWhitelistAddForm (cert mode)', () => {
  beforeEach(() => {
    authMode.cert = true;
  });

  it('renders no TOTP field and sends neither totpCode nor empty optional fields', async () => {
    open();
    expect(screen.queryByTestId('ca-whitelist-totp-input')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('ca-whitelist-subject-input'), {
      target: { value: 'CN=Example Issuing CA 2022' },
    });
    const add = screen.getByTestId('ca-whitelist-add-btn');
    expect(add).toBeEnabled();
    fireEvent.click(add);

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1));
    expect(addMock.mock.calls[0][0]).toEqual({
      subjectDn: 'CN=Example Issuing CA 2022',
      kind: 'CLIENT',
    });
  });
});
