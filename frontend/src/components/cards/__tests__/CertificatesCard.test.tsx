/**
 * CertificatesCard.test.tsx — renders certificate rows (subject, row target, full DSF
 * fingerprint, SHA-256 disclosure, validity state, issuer trust), the load-error state with
 * retry, opens the certificate-add modal, and removes a certificate only after a confirmation
 * that warns before the last valid certificate goes.
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
  issuerDn: string;
  issuerTrusted: boolean;
}

const deleteCertificate = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
let rows: Row[] | undefined = [];
let isError = false;

vi.mock('../../../hooks/useCertificates', () => ({
  useCertificates: () => ({ data: rows, isLoading: false, isError, refetch }),
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
  issuerDn: 'C=GR,O=Hellenic Academic and Research Institutions CA,CN=GEANT TLS RSA 1',
  issuerTrusted: true,
};

beforeEach(() => {
  rows = [cert];
  isError = false;
  refetch.mockReset();
  deleteCertificate.mockReset().mockResolvedValue(undefined);
});

describe('CertificatesCard', () => {
  it('renders a certificate row with its subject', () => {
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByText('CN=ukm.de')).toBeInTheDocument();
  });

  it('tags each row as a relation target and staggers the rows in', () => {
    rows = [cert, { ...cert, id: 'cert2', subject: 'CN=new.ukm.de' }];
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.dataset.entityRow)).toEqual([
      'certificates:cert1',
      'certificates:cert2',
    ]);
    expect(items[1]).toHaveClass('animate-list-item-in');
    expect(items[1].style.getPropertyValue('--stagger-index')).toBe('1');
  });

  it('shows a load error with a retry instead of the empty state', async () => {
    rows = undefined;
    isError = true;
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this data.');
    expect(screen.queryByText(/No certificates yet/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the complete DSF fingerprint (SHA-512) of the certificate', () => {
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    const fingerprint = screen.getByRole('group', { name: 'DSF fingerprint (SHA-512)' });
    expect(fingerprint).toHaveTextContent(THUMBPRINT_SHA512);
    expect(
      within(fingerprint).getByRole('button', { name: 'Copy DSF fingerprint' }),
    ).toBeInTheDocument();
  });

  it('keeps the SHA-256 fingerprint in a collapsed disclosure with its own copy button', async () => {
    const user = userEvent.setup();
    rows = [{ ...cert, thumbprint: 'AB12'.repeat(16) }];
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    const details = screen.getByText('More fingerprints').closest('details') as HTMLElement;
    expect(details).not.toHaveAttribute('open');

    await user.click(screen.getByText('More fingerprints'));
    expect(details).toHaveAttribute('open');
    await user.click(within(details).getByRole('button', { name: 'Copy SHA-256 fingerprint' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('ab12'.repeat(16));
  });

  it('opens the certificate-add modal when Add is clicked', async () => {
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    await userEvent.click(screen.getByText('+ Add'));
    expect(useModals.getState().open).toBe('certificate-add');
  });
});

describe('CertificatesCard status', () => {
  it.each([
    [200, 'Valid', 'text-success-fg'],
    [60, 'Expiring', 'text-warning-fg'],
    [10, 'Renew now', 'text-danger-fg'],
    [-5, 'Expired', 'text-danger-fg'],
  ])('labels a certificate valid for %i days as "%s"', (days, label, toneClass) => {
    rows = [{ ...cert, valid_until: inDays(days) }];
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByText(label).closest('.pill')).toHaveClass(toneClass);
  });

  it('says how long ago an expired certificate expired instead of a negative count', () => {
    rows = [{ ...cert, valid_until: inDays(-5) }];
    const { container } = renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByText(/^Expired \d+d ago$/)).toHaveClass('text-danger-fg');
    expect(container).not.toHaveTextContent(/-\d+d/);
    expect(container.querySelector('.bg-danger-fg')).not.toBeNull();
  });

  it('binds the header lock to the worst certificate and stresses Renew', () => {
    rows = [cert, { ...cert, id: 'old', subject: 'CN=old.ukm.de', valid_until: inDays(-5) }];
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByRole('img', { name: 'A certificate has expired' })).toHaveTextContent(
      'lock_open',
    );
    expect(screen.getByRole('button', { name: 'Renew' })).toHaveClass('btn-primary');
  });

  it('shows a closed lock and a secondary Renew while every certificate is valid', () => {
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByRole('img', { name: 'All certificates are valid' })).toHaveTextContent(
      /^lock$/,
    );
    expect(screen.getByRole('button', { name: 'Renew' })).toHaveClass('btn-secondary');
  });

  it('hides Renew and the lock when there is no certificate', () => {
    rows = [];
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.queryByRole('button', { name: 'Renew' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
  });
});

describe('CertificatesCard issuer', () => {
  it('marks a certificate from a CA that DSF trusts and names the issuer on hover or focus', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    const pill = screen.getByText('DSF-CA').closest('.pill') as HTMLElement;
    expect(pill).toHaveClass('text-success-fg');
    expect(pill).toHaveAccessibleDescription('Issued by GEANT TLS RSA 1, a CA that DSF trusts.');
    const tooltip = screen.getByText('GEANT TLS RSA 1').parentElement as HTMLElement;
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');

    pill.focus();
    expect(tooltip).not.toHaveClass('!invisible');
    await user.keyboard('{Escape}');
    expect(tooltip).toHaveClass('!invisible');
  });

  it('warns about other CAs, which production DSF instances refuse, and shows the issuer DN', () => {
    rows = [{ ...cert, issuerDn: 'CN=Example Test CA,O=Example', issuerTrusted: false }];
    renderWithProviders(<CertificatesCard instanceId="i1" />);
    expect(screen.getByText('No DSF CA').closest('.pill')).toHaveClass('text-warning-fg');
    expect(
      screen.getByText(
        /Production DSF instances only accept certificates from CAs that DSF trusts/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('CN=Example Test CA,O=Example')).toBeInTheDocument();
    expect(screen.queryByText('DSF-CA')).not.toBeInTheDocument();
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
