/**
 * CaBlacklistPanel.test.tsx — the CA blacklist tab content. caBlacklistApi
 * and sonner are mocked. Covers the entry details, the empty state, the
 * inline explanation when the CA is whitelisted (409 CA_WHITELISTED) with its
 * shortcut to the whitelist, and removal, which was one click in cert mode:
 * it now asks for confirmation there (useConfirm, cancel keeps the entry) and
 * asks for the TOTP code in a step-up dialog in OTP mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { CaBlacklistRow } from '../../../api/caBlacklist.api';

const { addMock, removeMock } = vi.hoisted(() => ({ addMock: vi.fn(), removeMock: vi.fn() }));
vi.mock('../../../api/caBlacklist.api', () => ({
  caBlacklistApi: { list: vi.fn(), add: addMock, remove: removeMock },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const authMode = vi.hoisted(() => ({ cert: false }));
vi.mock('../../../lib/authMode', () => ({
  isCertMode: () => authMode.cert,
  needsTotpStepUp: () => !authMode.cert,
}));

import { CaBlacklistPanel } from '../CaBlacklistPanel';

const ROW: CaBlacklistRow = {
  id: 'b1',
  subject_dn: 'CN=Compromised Example CA,O=Example,C=DE',
  fingerprint: null,
  reason: 'key compromise',
  added_by: 'admin@imi.example.de',
  added_at: '2026-01-15T00:00:00Z',
};

const onShowInWhitelist = vi.fn();

function renderPanel(blacklist: CaBlacklistRow[] = [ROW]) {
  return renderWithProviders(
    <CaBlacklistPanel
      blacklist={blacklist}
      knownCas={[]}
      isLoading={false}
      isError={false}
      onShowInWhitelist={onShowInWhitelist}
    />,
  );
}

beforeEach(() => {
  authMode.cert = false;
  removeMock.mockReset();
  removeMock.mockResolvedValue({ data: { data: { deleted: true } } });
  addMock.mockReset();
  onShowInWhitelist.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('CaBlacklistPanel', () => {
  it('shows the common name, DN, reason and who added the entry', () => {
    renderPanel();
    expect(screen.getByText('Compromised Example CA')).toBeInTheDocument();
    expect(screen.getByText('CN=Compromised Example CA,O=Example,C=DE')).toBeInTheDocument();
    expect(
      screen.getByText('Added by admin@imi.example.de on 15 Jan 2026 · key compromise'),
    ).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    renderPanel([]);
    expect(screen.getByText('No CAs are currently blacklisted.')).toBeInTheDocument();
  });

  it('explains why a whitelisted CA cannot be blacklisted and links to its entry', async () => {
    addMock.mockRejectedValue({
      response: { status: 409, data: { error: { code: 'CA_WHITELISTED', message: 'x' } } },
    });
    renderPanel();
    const dn = 'C=DE,O=Example Research Network,CN=Example Issuing CA 2022';
    fireEvent.change(screen.getByTestId('ca-blacklist-subject-input'), { target: { value: dn } });
    fireEvent.change(screen.getByTestId('ca-blacklist-totp-input'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByTestId('ca-blacklist-add-btn'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This CA is on the CA whitelist and cannot be blacklisted.');
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole('button', { name: 'Show in whitelist' }));
    expect(onShowInWhitelist).toHaveBeenCalledWith(dn);

    // Editing the DN dismisses the explanation.
    fireEvent.change(screen.getByTestId('ca-blacklist-subject-input'), {
      target: { value: 'CN=Other CA' },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('CaBlacklistPanel removal (cert mode)', () => {
  beforeEach(() => {
    authMode.cert = true;
  });

  it('confirms before removing and sends no TOTP code', async () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Compromised Example CA from the blacklist' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove CA from the blacklist?')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Certificates issued by this CA can be uploaded again.'),
    ).toBeInTheDocument();
    expect(removeMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('b1', undefined));
    expect(toast.success).toHaveBeenCalledWith('CA removed from blacklist.');
  });

  it('keeps the entry when the confirmation is cancelled', async () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Compromised Example CA from the blacklist' }),
    );
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(removeMock).not.toHaveBeenCalled();
  });
});

describe('CaBlacklistPanel removal (OTP mode)', () => {
  it('asks for the TOTP code in the confirmation dialog', async () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Compromised Example CA from the blacklist' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove CA from the blacklist?' });
    fireEvent.change(within(dialog).getByLabelText('TOTP Code'), { target: { value: '654321' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('b1', '654321'));
  });
});
