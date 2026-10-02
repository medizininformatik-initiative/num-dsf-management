/**
 * CaBlacklistPanel.test.tsx — the CA blacklist tab content. caBlacklistApi
 * and sonner are mocked. Covers the entry details, the empty state, and
 * removal, which was one click in cert mode: it now asks for confirmation
 * there (useConfirm, cancel keeps the entry) and asks for the TOTP code in a
 * step-up dialog in OTP mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { CaBlacklistRow } from '../../../api/caBlacklist.api';

const removeMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api/caBlacklist.api', () => ({
  caBlacklistApi: { list: vi.fn(), add: vi.fn(), remove: removeMock },
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

function renderPanel(blacklist: CaBlacklistRow[] = [ROW]) {
  return renderWithProviders(
    <CaBlacklistPanel blacklist={blacklist} knownCas={[]} isLoading={false} isError={false} />,
  );
}

beforeEach(() => {
  authMode.cert = false;
  removeMock.mockReset();
  removeMock.mockResolvedValue({ data: { data: { deleted: true } } });
  toast.success.mockReset();
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
