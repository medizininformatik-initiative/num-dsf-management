/**
 * CertificatePreviewPanel.test.tsx — the debounced upload preview inside the
 * certificate dialog: what would be registered (subject, expiry pill, grouped
 * SHA-512 fingerprint with a raw-value copy button, DSF-CA issuer pill), the
 * untrusted-issuer warning, and the blocking states that disable Save
 * (blacklisted CA, enforced whitelist, unreadable PEM, private key). Runs
 * the real usePreviewCertificate against a mocked API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { CertificatePreview } from '../../../api/entities.api';

const previewFn = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useCertificates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useCertificates')>()),
  useCreateCertificate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ previewCertificate: previewFn }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CertificateModal } from '../CertificateModal';

const PEM = '-----BEGIN CERTIFICATE-----\nQkFTRTY0Qk9EWQ==\n-----END CERTIFICATE-----';
const SHA512 = '0123456789abcdef'.repeat(8);
const WAIT = { timeout: 3000 };

function preview(overrides: Partial<CertificatePreview> = {}): CertificatePreview {
  return {
    subject: 'CN=fhir.klinik-eins.example.de,O=Klinik Eins,C=DE',
    validUntil: new Date(Date.now() + 400 * 86400000).toISOString(),
    thumbprint: 'AB'.repeat(32),
    thumbprintSha512: SHA512,
    issuerDn: 'C=GR,O=Hellenic Academic and Research Institutions CA,CN=GEANT TLS RSA 1',
    issuerTrusted: true,
    issuerBlacklisted: false,
    whitelistEnforced: false,
    ...overrides,
  };
}

function resolvePreview(p: CertificatePreview) {
  previewFn.mockResolvedValue({ data: { data: p } });
}

function enterPem(value = PEM) {
  fireEvent.change(screen.getByRole('textbox', { name: /certificate pem/i }), {
    target: { value },
  });
}

function saveButton() {
  return screen.getByRole('button', { name: /save & parse/i });
}

beforeEach(() => {
  previewFn.mockReset();
});

describe('certificate upload preview', () => {
  it('shows subject, expiry, the grouped DSF fingerprint and the DSF-CA issuer', async () => {
    resolvePreview(preview());
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem();

    expect(
      await screen.findByText(/fhir\.klinik-eins\.example\.de/, undefined, WAIT),
    ).toBeInTheDocument();
    expect(previewFn).toHaveBeenCalledWith(PEM);
    expect(screen.getByText(/\d+ days left/)).toBeInTheDocument();
    // 128 hex characters in 32 groups of four.
    expect(screen.getAllByText('0123')).toHaveLength(8);
    expect(screen.getAllByText('cdef')).toHaveLength(8);
    expect(screen.getByText('DSF-CA')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('copies the raw 128-character fingerprint', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    resolvePreview(preview());
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem();

    fireEvent.click(await screen.findByRole('button', { name: /copy fingerprint/i }, WAIT));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHA512));
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('warns that production DSF will not accept an untrusted issuer, but allows saving', async () => {
    resolvePreview(preview({ issuerTrusted: false, issuerDn: 'CN=Test Root' }));
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem();

    expect(
      await screen.findByText(/production DSF instances will not accept it/i, undefined, WAIT),
    ).toBeInTheDocument();
    expect(screen.queryByText('DSF-CA')).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('blocks saving when the issuing CA is blacklisted', async () => {
    resolvePreview(preview({ issuerBlacklisted: true }));
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem();

    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent(/blacklisted/i);
    expect(saveButton()).toBeDisabled();
  });

  it('blocks saving when the CA whitelist is enforced and the issuer is not on it', async () => {
    resolvePreview(preview({ issuerTrusted: false, whitelistEnforced: true }));
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem();

    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent(/CA_NOT_WHITELISTED/);
    expect(saveButton()).toBeDisabled();
  });

  it('blocks saving when the server cannot read the PEM', async () => {
    previewFn.mockRejectedValue({ response: { data: { error: { code: 'INVALID_PEM' } } } });
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem();

    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent(
      /certificate cannot be read/i,
    );
    expect(saveButton()).toBeDisabled();
  });

  it('keeps saving possible when the preview itself fails', async () => {
    previewFn.mockRejectedValue(new Error('Network Error'));
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem();

    expect(await screen.findByText(/preview unavailable/i, undefined, WAIT)).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('explains a pasted private key and never sends it to the server', async () => {
    resolvePreview(preview());
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    // Marker text instead of real key material keeps secret scanners quiet.
    enterPem(`${PEM}\nPRIVATE KEY`);

    expect(screen.getByRole('alert')).toHaveTextContent(/never upload a private key/i);
    expect(saveButton()).toBeDisabled();
    await new Promise((r) => setTimeout(r, 600));
    expect(previewFn).not.toHaveBeenCalled();
  });

  it('asks the server once for a burst of edits (debounced)', async () => {
    resolvePreview(preview());
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem(`${PEM}\n`);
    enterPem(`${PEM}\n\n`);
    enterPem(PEM);

    await screen.findByText(/fhir\.klinik-eins\.example\.de/, undefined, WAIT);
    expect(previewFn).toHaveBeenCalledTimes(1);
    expect(previewFn).toHaveBeenCalledWith(PEM);
  });

  it('stays hidden until the text looks like a certificate', async () => {
    resolvePreview(preview());
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem('-----BEGIN CERTIFICATE-----\nQkFT');

    await new Promise((r) => setTimeout(r, 600));
    expect(previewFn).not.toHaveBeenCalled();
    expect(screen.queryByText(/certificate to be registered/i)).not.toBeInTheDocument();
  });

  it('wraps the request in the debounce window', async () => {
    resolvePreview(preview());
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    enterPem();
    expect(previewFn).not.toHaveBeenCalled();
    await waitFor(() => expect(previewFn).toHaveBeenCalledTimes(1), WAIT);
  });
});
