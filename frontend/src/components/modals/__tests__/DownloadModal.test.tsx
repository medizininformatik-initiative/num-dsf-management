/**
 * DownloadModal.test.tsx — the link DSF uses, the version history list with
 * DSF history links, versioned signed download with its verification panel,
 * and the acknowledgement gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const downloadBundle = vi.hoisted(() => vi.fn());
const getBundleHistory = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('sonner', () => ({ toast }));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({
    data: [{ identifier: 'dsf.klinik.example.de', name: 'Klinik FHIR' }],
    isLoading: false,
  }),
}));
vi.mock('../BundlePreview', () => ({ BundlePreview: () => null }));
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ downloadBundle, getBundleHistory, downloadIpList: vi.fn() }),
  downloadFullAllowListBundle: vi.fn(),
}));

import { DownloadModal } from '../DownloadModal';

const HISTORY = [
  {
    versionNumber: 2,
    createdAt: '2026-05-02T10:00:00Z',
    triggeredBy: 'RESTORE',
    notes: 'Rollback of v1',
    isCurrent: true,
  },
  {
    versionNumber: 3,
    createdAt: '2026-05-03T10:00:00Z',
    triggeredBy: 'APPROVAL',
    notes: null,
    isCurrent: false,
  },
  {
    versionNumber: 1,
    createdAt: '2026-05-01T10:00:00Z',
    triggeredBy: 'APPROVAL',
    notes: null,
    isCurrent: false,
  },
];
const BASE = `${window.location.origin}/fhir/Bundle/dsf.klinik.example.de`;

async function openWithEndpoint() {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
  await user.selectOptions(screen.getByLabelText('Selected Endpoint'), 'dsf.klinik.example.de');
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  getBundleHistory.mockResolvedValue({ data: { data: HISTORY } });
  downloadBundle.mockResolvedValue({
    data: '{}',
    headers: {
      'x-bundle-version': '3',
      'x-content-hash': 'deadbeef',
      'x-bundle-signature': 'c2lnbmF0dXJl',
    },
  });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('DownloadModal – DSF link and history', () => {
  it('asks for an endpoint before showing a link', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByText('Select an endpoint to see its link.')).toBeInTheDocument();
    expect(screen.queryByTestId('dsf-link')).toBeNull();
    expect(getBundleHistory).not.toHaveBeenCalled();
  });

  it('leads with the current allow-list URL of the endpoint, copyable, with the Task input', async () => {
    const user = await openWithEndpoint();
    expect(screen.getByTestId('dsf-link')).toHaveTextContent(BASE);
    expect(screen.getAllByText(/allow-list\|allow_list/).length).toBeGreaterThan(0);
    await user.click(screen.getByTestId('copy-dsf-link'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(BASE);
    expect(toast.success).toHaveBeenCalledWith('Copied.');
  });

  it('lists versions newest first with the current pill, trigger, note and DSF history link', async () => {
    const user = await openWithEndpoint();
    const list = await screen.findByTestId('download-history');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => within(li).getByText(/^v\d$/).textContent)).toEqual([
      'v3',
      'v2',
      'v1',
    ]);
    expect(within(items[1]).getByText('Current')).toBeInTheDocument();
    expect(within(items[1]).getByText('Restore')).toBeInTheDocument();
    expect(within(items[1]).getByText(/Rollback of v1/)).toBeInTheDocument();
    expect(within(items[0]).queryByText('Current')).toBeNull();
    expect(within(items[0]).getByText(`${BASE}/_history/3`)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Copy the DSF history link of version 3' }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${BASE}/_history/3`);
  });

  it('shows the empty and error states of the history', async () => {
    getBundleHistory.mockResolvedValueOnce({ data: { data: [] } });
    await openWithEndpoint();
    expect(await screen.findByText(/No version has been published/)).toBeInTheDocument();
  });

  it('reports a failing history load', async () => {
    getBundleHistory.mockRejectedValueOnce(new Error('boom'));
    await openWithEndpoint();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});

describe('DownloadModal – versioned download', () => {
  it('keeps version downloads disabled until the disclaimer is acknowledged', async () => {
    await openWithEndpoint();
    expect(await screen.findByTestId('download-version-3')).toBeDisabled();
  });

  it('downloads the chosen version and shows hash, signature and version for verification', async () => {
    const user = await openWithEndpoint();
    await user.click(screen.getByTestId('disclaimer-checkbox'));
    await user.click(await screen.findByTestId('download-version-3'));
    await waitFor(() => expect(downloadBundle).toHaveBeenCalledWith('dsf.klinik.example.de', 3));
    const panel = await screen.findByTestId('verify-panel');
    expect(panel).toHaveTextContent('deadbeef');
    expect(panel).toHaveTextContent('c2lnbmF0dXJl');
    expect(panel).toHaveTextContent('v3');
    expect(panel).toHaveTextContent('sha256sum dsf-allow-list-v3.json');
    expect(toast.success).toHaveBeenCalledWith('Bundle downloaded.');
  });

  it('warns when the server sent neither hash nor signature', async () => {
    downloadBundle.mockResolvedValueOnce({ data: '{}', headers: {} });
    const user = await openWithEndpoint();
    await user.click(screen.getByTestId('disclaimer-checkbox'));
    await user.click(await screen.findByTestId('download-version-1'));
    expect(await screen.findByText(/did not send a hash or signature/)).toBeInTheDocument();
  });

  it('toasts an error when the download fails', async () => {
    downloadBundle.mockRejectedValueOnce(new Error('boom'));
    const user = await openWithEndpoint();
    await user.click(screen.getByTestId('disclaimer-checkbox'));
    await user.click(await screen.findByTestId('download-version-3'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to download the bundle.'));
    expect(screen.queryByTestId('verify-panel')).toBeNull();
  });
});

describe('DownloadModal – shell', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <DownloadModal open={false} onClose={() => {}} instanceId="i1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the title and keeps the network bundle gated when open', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /download allow list/i })).toBeInTheDocument();
    expect(screen.getByTestId('download-bundle-btn')).toBeDisabled();
  });
});
