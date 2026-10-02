/**
 * CertRenewalModal.test.tsx — the guided renewal flow: "Step n of 3"
 * indicator, select → upload → confirm with focus moving to each step title,
 * Back returning one step (keeping the entered PEM) and Cancel leaving the
 * flow, the renew mutation receiving { certId, pem }, the shared upload
 * preview blocking Review, and translated renew errors. Certificates and the
 * renew mutation are mocked; the preview runs through the real
 * usePreviewCertificate against a mocked API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const mutateAsync = vi.hoisted(() => vi.fn());
const previewFn = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const certs = vi.hoisted(() => [{ id: 'cert-1', subject: 'CN=ukm.de', valid_until: '2026-07-01' }]);
vi.mock('../../../hooks/useCertificates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useCertificates')>()),
  useCertificates: () => ({ data: certs }),
  useRenewCertificate: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ previewCertificate: previewFn }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { CertRenewalModal } from '../CertRenewalModal';

const PUBLIC_PEM = '-----BEGIN CERTIFICATE-----\nMIIPUBLIC...\n-----END CERTIFICATE-----';

function pemField() {
  return screen.getByPlaceholderText(/paste PEM content/i) as HTMLTextAreaElement;
}

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue(undefined);
  previewFn.mockReset().mockReturnValue(new Promise(() => {}));
  toastError.mockReset();
});

describe('CertRenewalModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <CertRenewalModal open={false} onClose={() => {}} instanceId="i1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('walks select → upload → confirm and renews with { certId, pem }', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<CertRenewalModal open onClose={onClose} instanceId="i1" />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();

    // Step 1: pick the expiring cert (button shows its subject).
    await user.click(screen.getByRole('button', { name: /CN=ukm\.de/ }));
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

    // Step 2: enter a public PEM, then Review.
    fireEvent.change(pemField(), { target: { value: PUBLIC_PEM } });
    await user.click(screen.getByRole('button', { name: /^review$/i }));
    expect(await screen.findByText('Step 3 of 3')).toBeInTheDocument();

    // Step 3: confirm the swap.
    await user.click(screen.getByRole('button', { name: /confirm renewal/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ certId: 'cert-1', pem: PUBLIC_PEM });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('moves focus to the title of each new step', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CertRenewalModal open onClose={() => {}} instanceId="i1" />);
    await user.click(screen.getByRole('button', { name: /CN=ukm\.de/ }));
    const heading = screen.getByRole('heading', { name: /step 2 of 3/i });
    expect(heading).toHaveFocus();
    expect(heading).toHaveTextContent(/add the new certificate/i);
  });

  it('goes one step back with Back, keeps the PEM, and leaves with Cancel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<CertRenewalModal open onClose={onClose} instanceId="i1" />);
    await user.click(screen.getByRole('button', { name: /CN=ukm\.de/ }));
    fireEvent.change(pemField(), { target: { value: PUBLIC_PEM } });
    await user.click(screen.getByRole('button', { name: /^review$/i }));
    await screen.findByText('Step 3 of 3');

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(pemField().value).toBe(PUBLIC_PEM);

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('surfaces a pasted private key and disables Review', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CertRenewalModal open onClose={() => {}} instanceId="i1" />);

    await user.click(screen.getByRole('button', { name: /CN=ukm\.de/ }));
    // Set the value atomically so the warning renders in the same act() flush;
    // a short marker exercises the guard without tripping the secret scanner.
    fireEvent.change(pemField(), { target: { value: 'oops, this still has a PRIVATE KEY' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/never upload a private key/i);
    expect(screen.getByRole('button', { name: /^review$/i })).toBeDisabled();
    expect(previewFn).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('blocks Review when the preview reports a blacklisted CA', async () => {
    previewFn.mockResolvedValue({
      data: {
        data: {
          subject: 'CN=new.ukm.de',
          validUntil: '2028-01-01T00:00:00.000Z',
          thumbprint: 'AB'.repeat(32),
          thumbprintSha512: 'ab'.repeat(64),
          issuerDn: 'CN=Bad CA',
          issuerTrusted: false,
          issuerBlacklisted: true,
          whitelistEnforced: false,
        },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<CertRenewalModal open onClose={() => {}} instanceId="i1" />);
    await user.click(screen.getByRole('button', { name: /CN=ukm\.de/ }));
    fireEvent.change(pemField(), { target: { value: PUBLIC_PEM } });

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      /blacklisted/i,
    );
    expect(screen.getByRole('button', { name: /^review$/i })).toBeDisabled();
  });

  it('maps renew error codes to translated messages', async () => {
    mutateAsync.mockRejectedValue({
      response: { data: { error: { code: 'CA_BLACKLISTED', message: 'CA_BLACKLISTED' } } },
    });
    const user = userEvent.setup();
    renderWithProviders(<CertRenewalModal open onClose={() => {}} instanceId="i1" />);
    await user.click(screen.getByRole('button', { name: /CN=ukm\.de/ }));
    fireEvent.change(pemField(), { target: { value: PUBLIC_PEM } });
    await user.click(screen.getByRole('button', { name: /^review$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm renewal/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/is blacklisted/)),
    );
  });
});
