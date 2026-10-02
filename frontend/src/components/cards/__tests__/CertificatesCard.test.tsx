/**
 * CertificatesCard.test.tsx — renders a certificate row (subject, DSF SHA-512
 * thumbprint), opens the certificate-add modal, and removes a certificate only
 * after a confirmation that warns before the last valid certificate goes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';

const THUMBPRINT_SHA512 = 'a1'.repeat(64);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface Row {
  id: string;
  subject: string;
  thumbprint: string;
  thumbprintSha512: string;
  valid_until: string;
}

const deleteCertificate = vi.hoisted(() => vi.fn());
let rows: Row[] = [];

vi.mock('../../../hooks/useCertificates', () => ({
  useCertificates: () => ({ data: rows, isLoading: false }),
  useDeleteCertificate: () => ({ mutate: vi.fn(), mutateAsync: deleteCertificate }),
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: { identifier: 'ukm.de' }, isLoading: false }),
}));

import { CertificatesCard } from '../CertificatesCard';

const cert: Row = {
  id: 'cert1',
  subject: 'CN=ukm.de',
  thumbprint: 'AB12',
  thumbprintSha512: THUMBPRINT_SHA512,
  valid_until: inDays(200),
};

beforeEach(() => {
  rows = [cert];
  deleteCertificate.mockReset().mockResolvedValue(undefined);
});

describe('CertificatesCard', () => {
  it('renders a certificate row with its subject', () => {
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByText('CN=ukm.de')).toBeInTheDocument();
  });

  it('renders the DSF SHA-512 thumbprint of the certificate', () => {
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByTitle(THUMBPRINT_SHA512)).toBeInTheDocument();
  });

  it('opens the certificate-add modal when Add is clicked', async () => {
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    await userEvent.click(screen.getByText('+ Add'));
    expect(useModals.getState().open).toBe('certificate-add');
  });
});

describe('CertificatesCard removal', () => {
  it('warns before the last valid certificate goes and removes it once confirmed', async () => {
    const user = userEvent.setup();
    rows = [cert, { ...cert, id: 'old', subject: 'CN=old.ukm.de', valid_until: inDays(-5) }];
    renderWithProviders(<CertificatesCard instanceId="i1" />);

    await user.click(screen.getAllByRole('button', { name: /delete|remove/i })[0]);
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove certificate?' });
    expect(dialog).toHaveAccessibleDescription(/CN=ukm\.de, valid until .+, will be removed/);
    expect(
      within(dialog).getByText(/This is the last valid certificate of your organization/),
    ).toBeInTheDocument();
    expect(deleteCertificate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deleteCertificate).toHaveBeenCalledWith('cert1'));
  });

  it('only names the network-wide effect while another valid certificate remains', async () => {
    const user = userEvent.setup();
    rows = [cert, { ...cert, id: 'cert2', subject: 'CN=new.ukm.de', valid_until: inDays(700) }];
    renderWithProviders(<CertificatesCard instanceId="i1" />);

    await user.click(screen.getAllByRole('button', { name: /delete|remove/i })[0]);
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/other DSF instances stop accepting this certificate/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/last valid certificate/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deleteCertificate).not.toHaveBeenCalled();
  });
});
