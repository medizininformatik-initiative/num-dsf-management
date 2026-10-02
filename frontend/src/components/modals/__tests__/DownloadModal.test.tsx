/**
 * DownloadModal.test.tsx — the endpoint bundle (what the site's DSF downloads)
 * is the primary download for the selected endpoint, the network-wide bundle
 * the secondary one; after a download the content hash (checked against the
 * received bytes), the signature and the time are shown with copy buttons;
 * the guide builds the downloadAllowList Task input reference from the portal
 * origin. The API, sonner and the browser download plumbing are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

const endpoints = vi.hoisted(() => ({ list: [] as { identifier: string; name?: string }[] }));
const downloadBundle = vi.hoisted(() => vi.fn());
const downloadIpList = vi.hoisted(() => vi.fn());
const downloadFullAllowListBundle = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: endpoints.list, isLoading: false }),
}));
// BundlePreview pulls extra API state irrelevant to this render test.
vi.mock('../BundlePreview', () => ({ BundlePreview: () => null }));
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ downloadBundle, downloadIpList }),
  downloadFullAllowListBundle,
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DownloadModal } from '../DownloadModal';

const HASH = 'ab'.repeat(32);
const JWT = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQifQ.eyJjb250ZW50SGFzaCI6ImFiIn0.c2ln';

/** A bundle response whose body hashes (through the stubbed digest) to `digestHex`. */
function bundleResponse(headers: Record<string, string>) {
  const blob = new Blob(['{"resourceType":"Bundle"}'], { type: 'application/fhir+json' });
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
  return { data: blob, headers };
}

function stubDigest(hex: string) {
  const bytes = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => bytes.buffer) } });
}

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  endpoints.list = [
    { identifier: 'fhir.alpha.example.de', name: 'Alpha FHIR' },
    { identifier: 'fhir.beta.example.de' },
  ];
  URL.createObjectURL = vi.fn(() => 'blob:bundle');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function openAndAcknowledge() {
  renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
  fireEvent.click(screen.getByTestId('disclaimer-checkbox'));
}

describe('DownloadModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <DownloadModal open={false} onClose={() => {}} instanceId="i1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the title and the disclaimer gate when open', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /download allow list/i })).toBeInTheDocument();
    // Download buttons start disabled behind the acknowledgment gate.
    expect(screen.getByTestId('download-bundle-btn')).toBeDisabled();
    expect(screen.getByTestId('download-full-bundle-btn')).toBeDisabled();
  });

  it('downloads the endpoint bundle of the selected endpoint, not the network-wide one', async () => {
    downloadBundle.mockResolvedValue(bundleResponse({}));
    openAndAcknowledge();

    // The first endpoint is preselected; pick the second one.
    const select = screen.getByLabelText('Endpoint') as HTMLSelectElement;
    expect(select.value).toBe('fhir.alpha.example.de');
    fireEvent.change(select, { target: { value: 'fhir.beta.example.de' } });
    fireEvent.click(screen.getByTestId('download-bundle-btn'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Bundle downloaded.'));
    expect(downloadBundle).toHaveBeenCalledWith('fhir.beta.example.de');
    expect(downloadFullAllowListBundle).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId('download-result')).getByText(
        'Downloaded allowlist-bundle-fhir.beta.example.de.json',
      ),
    ).toBeInTheDocument();
  });

  it('shows hash, signature and time with copy buttons and confirms a matching hash', async () => {
    stubDigest(HASH);
    downloadBundle.mockResolvedValue(
      bundleResponse({ 'x-content-hash': HASH.toUpperCase(), 'x-bundle-signature': JWT }),
    );
    openAndAcknowledge();
    fireEvent.click(screen.getByTestId('download-bundle-btn'));

    const result = await screen.findByTestId('download-result', undefined, { timeout: 4000 });
    // Grouped for reading, copied raw.
    expect(within(result).getByText(/^abab abab/)).toBeInTheDocument();
    expect(within(result).getByTestId('hash-check')).toHaveTextContent(
      'The downloaded file matches this hash.',
    );
    expect(within(result).getByText('Signature (JWT, RS256)')).toBeInTheDocument();
    expect(within(result).getByText(JWT)).toBeInTheDocument();

    fireEvent.click(within(result).getByRole('button', { name: 'Copy Content hash (SHA-256)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH.toUpperCase()));
    fireEvent.click(within(result).getByRole('button', { name: 'Copy Signature (JWT, RS256)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JWT));
    expect(within(result).getByRole('button', { name: 'Copy Downloaded at' })).toBeInTheDocument();
  });

  it('warns when the received bytes do not match the content hash', async () => {
    stubDigest('cd'.repeat(32));
    downloadBundle.mockResolvedValue(
      bundleResponse({ 'x-content-hash': HASH, 'x-bundle-signature': JWT }),
    );
    openAndAcknowledge();
    fireEvent.click(screen.getByTestId('download-bundle-btn'));

    const result = await screen.findByTestId('download-result', undefined, { timeout: 4000 });
    expect(within(result).getByRole('alert')).toHaveTextContent(
      'The downloaded file does not match this hash. Do not import it.',
    );
  });

  it('asks for a manual check when the browser cannot hash the file', async () => {
    downloadBundle.mockResolvedValue(
      bundleResponse({ 'x-content-hash': HASH, 'x-bundle-signature': JWT }),
    );
    vi.stubGlobal('crypto', {});
    openAndAcknowledge();
    fireEvent.click(screen.getByTestId('download-bundle-btn'));

    const result = await screen.findByTestId('download-result', undefined, { timeout: 4000 });
    expect(
      within(result).getByText('Compare the hash of the file yourself (step 2).'),
    ).toBeInTheDocument();
  });

  it('downloads the signed network-wide bundle as the secondary option', async () => {
    downloadFullAllowListBundle.mockResolvedValue(
      bundleResponse({ 'x-content-hash': HASH, 'x-bundle-signature': JWT }),
    );
    openAndAcknowledge();
    fireEvent.click(screen.getByTestId('download-full-bundle-btn'));

    const result = await screen.findByTestId('download-result', undefined, { timeout: 4000 });
    expect(downloadFullAllowListBundle).toHaveBeenCalledTimes(1);
    expect(downloadBundle).not.toHaveBeenCalled();
    expect(within(result).getByText('Downloaded dsf-allow-list-bundle.json')).toBeInTheDocument();
  });

  it('builds the downloadAllowList Task input reference from the portal origin', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);

    expect(
      screen.getByText('http://dsf.dev/fhir/CodeSystem/allow-list|allow_list'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${window.location.origin}/fhir/Bundle/fhir.alpha.example.de`),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: 'fhir.beta.example.de' },
    });
    expect(
      screen.getByText(`${window.location.origin}/fhir/Bundle/fhir.beta.example.de`),
    ).toBeInTheDocument();
    // The process name is a link inside the translated sentence, not split from it.
    const link = screen.getByRole('link', { name: /dsf-process-allow-list/ });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/datasharingframework/dsf-process-allow-list',
    );
    expect(link.parentElement).toHaveTextContent(/^Start the DSF process downloadAllowList \(/);
  });

  it('keeps the endpoint bundle unavailable without endpoints', () => {
    endpoints.list = [];
    openAndAcknowledge();

    expect(screen.getByTestId('download-bundle-btn')).toBeDisabled();
    expect(screen.getByTestId('download-full-bundle-btn')).toBeEnabled();
    expect(
      screen.getByText('Add an endpoint first — the endpoint bundle is built per endpoint.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Select an endpoint to see its bundle reference.')).toBeInTheDocument();
  });

  it('reports a failed download', async () => {
    downloadBundle.mockRejectedValue(new Error('boom'));
    openAndAcknowledge();
    fireEvent.click(screen.getByTestId('download-bundle-btn'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to download the bundle.'));
    expect(screen.queryByTestId('download-result')).not.toBeInTheDocument();
  });
});
