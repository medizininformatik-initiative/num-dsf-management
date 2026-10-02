/**
 * CertificateModal.test.tsx — the certificate upload dialog: the label points
 * at the PEM textarea, the file picker and the drop zone load PEM files (and
 * refuse private keys and non-PEM files), validation errors are announced and
 * wired to the field, upload error codes become translated messages, and
 * typed input asks before the dialog is dismissed. The server preview runs
 * through the real usePreviewCertificate with the API mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const certCreate = vi.hoisted(() => vi.fn());
const previewFn = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useCertificates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useCertificates')>()),
  useCreateCertificate: () => ({ mutateAsync: certCreate, isPending: false }),
}));
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ previewCertificate: previewFn }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { CertificateModal } from '../CertificateModal';

// Certificate markers around a short dummy body (not a real certificate).
const PEM = '-----BEGIN CERTIFICATE-----\nQkFTRTY0Qk9EWQ==\n-----END CERTIFICATE-----';

function pemField() {
  return screen.getByRole('textbox', { name: /certificate pem/i }) as HTMLTextAreaElement;
}

function pick(file: File) {
  fireEvent.change(screen.getByTestId('pem-file-input'), { target: { files: [file] } });
}

beforeEach(() => {
  certCreate.mockReset().mockResolvedValue(undefined);
  previewFn.mockReset().mockReturnValue(new Promise(() => {}));
  toastError.mockReset();
});

describe('CertificateModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <CertificateModal open={false} onClose={() => {}} instanceId="i1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the PEM textarea and describes it with the hint', () => {
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /add new certificate/i })).toBeInTheDocument();
    const textarea = pemField();
    expect(textarea.tagName).toBe('TEXTAREA');
    const hintId = textarea.getAttribute('aria-describedby');
    expect(document.getElementById(hintId!)).toHaveTextContent(/paste the public certificate/i);
  });

  it('announces the empty-field error and marks the textarea invalid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    await user.click(screen.getByRole('button', { name: /save & parse/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/certificate pem is required/i);
    expect(pemField()).toHaveAttribute('aria-invalid', 'true');
    expect(pemField().getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('loads a picked certificate file into the textarea', async () => {
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    pick(new File([PEM], 'server.pem', { type: 'application/x-pem-file' }));
    await waitFor(() => expect(pemField().value).toBe(PEM));
    expect(screen.getByText('Loaded server.pem')).toHaveAttribute('role', 'status');
  });

  it('offers the picker for .pem, .crt and .cer files through a named button', () => {
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
    const accept = screen.getByTestId('pem-file-input').getAttribute('accept');
    expect(accept).toContain('.pem');
    expect(accept).toContain('.crt');
    expect(accept).toContain('.cer');
  });

  it('refuses a file that carries a private key and never previews it', async () => {
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    // A short marker, not real key material, so secret scanners stay quiet.
    pick(new File([`${PEM}\nPRIVATE KEY`], 'bundle.pem'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/contains a private key/i);
    expect(pemField().value).toBe('');
    expect(previewFn).not.toHaveBeenCalled();
  });

  it('refuses a binary (DER) file with a conversion hint', async () => {
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    pick(new File([new Uint8Array([0x30, 0x82, 0x01, 0x0a])], 'server.cer'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not contain a pem/i);
    expect(pemField().value).toBe('');
  });

  it('highlights the drop zone while a file is dragged and loads the dropped file', async () => {
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    const zone = pemField().closest('.pem-dropzone') as HTMLElement;
    const file = new File([PEM], 'dropped.pem');

    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone).toHaveAttribute('data-drag-over', 'true');
    expect(screen.getByText(/release to load/i)).toBeInTheDocument();

    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone).not.toHaveAttribute('data-drag-over');
    await waitFor(() => expect(pemField().value).toBe(PEM));
  });

  it('submits the PEM and closes on success', async () => {
    const onClose = vi.fn();
    renderWithProviders(<CertificateModal open onClose={onClose} instanceId="i1" />);
    fireEvent.change(pemField(), { target: { value: PEM } });
    fireEvent.click(screen.getByRole('button', { name: /save & parse/i }));
    await waitFor(() => expect(certCreate).toHaveBeenCalledWith(PEM));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('maps upload error codes to translated messages', async () => {
    certCreate.mockRejectedValue({
      response: { data: { error: { code: 'CA_NOT_WHITELISTED', message: 'CA_NOT_WHITELISTED' } } },
    });
    renderWithProviders(<CertificateModal open onClose={() => {}} instanceId="i1" />);
    fireEvent.change(pemField(), { target: { value: PEM } });
    fireEvent.click(screen.getByRole('button', { name: /save & parse/i }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/not on the CA whitelist \(CA_NOT_WHITELISTED\)/),
      ),
    );
  });

  it('asks before discarding typed input on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<CertificateModal open onClose={onClose} instanceId="i1" />);
    fireEvent.change(pemField(), { target: { value: 'draft' } });
    await user.keyboard('{Escape}');
    expect(
      await screen.findByRole('alertdialog', { name: /discard changes/i }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
