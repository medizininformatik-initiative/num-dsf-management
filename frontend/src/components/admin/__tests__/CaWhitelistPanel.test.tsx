/**
 * CaWhitelistPanel.test.tsx — the CA whitelist tab content. caWhitelistApi
 * and sonner are mocked; the real i18n, useConfirm (via renderWithProviders)
 * and Modal run. Covers the grouping by kind, each entry's common name, full
 * DN, grouped SHA-256 fingerprint (copied raw), source pill and expiry, both
 * enforcement states, and removal: a useConfirm dialog in cert mode (cancel
 * keeps the entry) and the step-up dialog with the TOTP code in OTP mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { CaWhitelistData, CaWhitelistRow } from '../../../api/caWhitelist.api';

const removeMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api/caWhitelist.api', () => ({
  caWhitelistApi: { list: vi.fn(), add: vi.fn(), remove: removeMock },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const authMode = vi.hoisted(() => ({ cert: false }));
vi.mock('../../../lib/authMode', () => ({
  isCertMode: () => authMode.cert,
  needsTotpStepUp: () => !authMode.cert,
}));

import { CaWhitelistPanel } from '../CaWhitelistPanel';

const CLIENT_FP = '0123456789ABCDEF'.repeat(4);

function row(over: Partial<CaWhitelistRow>): CaWhitelistRow {
  return {
    id: 'w1',
    subject_dn: 'C=DE,O=Example Research Network,CN=Example Issuing CA 2022',
    fingerprint: CLIENT_FP,
    kind: 'CLIENT',
    not_after: '2042-01-21',
    source: 'dsf-2.1.1',
    reason: null,
    added_by: 'SYSTEM:init',
    added_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const ROWS: CaWhitelistRow[] = [
  row({}),
  row({
    id: 'w2',
    subject_dn: 'C=US,O=Example Trust Network,CN=Example RSA Root',
    fingerprint: 'AB12'.repeat(16),
    kind: 'SERVER',
    not_after: '2020-01-01',
  }),
  row({
    id: 'w3',
    subject_dn: 'CN=Hackathon Test CA,O=Example Lab,C=DE',
    fingerprint: null,
    not_after: null,
    source: 'manual',
    reason: 'test federation',
    added_by: 'admin@imi.example.de',
    added_at: '2026-09-30T10:00:00Z',
  }),
];

function renderPanel(data: Partial<CaWhitelistData> = {}) {
  return renderWithProviders(
    <CaWhitelistPanel
      data={{ whitelist: ROWS, enforced: false, ...data }}
      isLoading={false}
      isError={false}
      knownCas={[]}
      query=""
      kind="ALL"
    />,
  );
}

beforeEach(() => {
  authMode.cert = false;
  removeMock.mockReset();
  removeMock.mockResolvedValue({ data: { data: { deleted: true } } });
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('CaWhitelistPanel', () => {
  it('groups the entries by kind and shows name, DN, fingerprint, source and expiry', () => {
    renderPanel();

    const client = screen.getByRole('region', { name: /Client CAs/ });
    const server = screen.getByRole('region', { name: /Server roots/ });
    expect(within(client).getAllByTestId('ca-whitelist-row')).toHaveLength(2);
    expect(within(server).getAllByTestId('ca-whitelist-row')).toHaveLength(1);

    const [dsfRow, manualRow] = within(client).getAllByTestId('ca-whitelist-row');
    expect(within(dsfRow).getByText('Example Issuing CA 2022')).toBeInTheDocument();
    expect(
      within(dsfRow).getByText('C=DE,O=Example Research Network,CN=Example Issuing CA 2022'),
    ).toBeInTheDocument();
    expect(within(dsfRow).getByText('DSF 2.1.1')).toBeInTheDocument();
    expect(within(dsfRow).getByText('Valid until 21 Jan 2042')).toBeInTheDocument();
    // The fingerprint is shown in groups of four.
    expect(within(dsfRow).getAllByText('0123')).toHaveLength(4);
    expect(within(dsfRow).getAllByText('CDEF')).toHaveLength(4);

    expect(within(manualRow).getByText('Manual')).toBeInTheDocument();
    expect(
      within(manualRow).getByText(
        /Added by admin@imi\.example\.de on 30 Sept? 2026 · test federation/,
      ),
    ).toBeInTheDocument();

    const serverRow = within(server).getByTestId('ca-whitelist-row');
    expect(within(serverRow).getByText('Expired 1 Jan 2020')).toBeInTheDocument();
  });

  it('copies the raw fingerprint', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel();

    const dsfRow = screen.getAllByTestId('ca-whitelist-row')[0];
    fireEvent.click(within(dsfRow).getByRole('button', { name: 'Copy SHA-256 fingerprint' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CLIENT_FP));
    expect(toast.success).toHaveBeenCalledWith('Fingerprint copied to the clipboard.');
  });

  it('says when the whitelist is not enforced and how to enforce it', () => {
    renderPanel({ enforced: false });
    const banner = screen.getByTestId('ca-whitelist-enforcement');
    expect(banner).toHaveTextContent(
      'Not enforced: other CAs are accepted and flagged (set CA_WHITELIST_ENFORCE=true to enforce).',
    );
  });

  it('says when the whitelist is enforced', () => {
    renderPanel({ enforced: true });
    expect(screen.getByTestId('ca-whitelist-enforcement')).toHaveTextContent(
      'Enforced: uploads from other CAs are rejected.',
    );
  });
});

describe('CaWhitelistPanel removal (cert mode)', () => {
  beforeEach(() => {
    authMode.cert = true;
  });

  it('asks for confirmation with a summary, then removes without a TOTP code', async () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Example Issuing CA 2022 from the whitelist' }),
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove CA from the whitelist?')).toBeInTheDocument();
    expect(
      within(dialog).getByText('C=DE,O=Example Research Network,CN=Example Issuing CA 2022'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Site certificates issued by this CA will be flagged as not accepted by DSF.',
      ),
    ).toBeInTheDocument();
    expect(removeMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('w1', undefined));
    expect(toast.success).toHaveBeenCalledWith('CA removed from the whitelist.');
  });

  it('keeps the entry when the confirmation is cancelled', async () => {
    renderPanel({ enforced: true });
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Example Issuing CA 2022 from the whitelist' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('Uploads of site certificates issued by this CA will be rejected.'),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(removeMock).not.toHaveBeenCalled();
  });
});

describe('CaWhitelistPanel removal (OTP mode)', () => {
  it('asks for the TOTP code in the confirmation dialog and sends it', async () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Example RSA Root from the whitelist' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Remove CA from the whitelist?' });
    expect(
      within(dialog).getByText('It will no longer be listed among the roots a DSF BPE trusts.'),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Remove' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('TOTP Code'), { target: { value: '12345' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('TOTP Code'), { target: { value: '123456' } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('w2', '123456'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open and clears the spent code when the removal fails', async () => {
    removeMock.mockRejectedValue({
      response: {
        status: 401,
        data: { error: { code: 'TOTP_INVALID', message: 'Invalid TOTP code' } },
      },
    });
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Example RSA Root from the whitelist' }),
    );
    const dialog = await screen.findByRole('dialog');
    const code = within(dialog).getByLabelText('TOTP Code');
    fireEvent.change(code, { target: { value: '000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid TOTP code'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(code).toHaveValue('');
  });
});
