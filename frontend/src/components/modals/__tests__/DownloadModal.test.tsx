/**
 * DownloadModal.test.tsx — the link DSF uses, the version history with DSF
 * history links, signed versioned downloads with local hash verification
 * (match, mismatch, unavailable), the three-step guide, the admin-only IP list
 * and the calm disclaimer note (no gate). API, sonner and browser download plumbing are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const downloadBundle = vi.hoisted(() => vi.fn());
const downloadIpList = vi.hoisted(() => vi.fn());
const getBundleHistory = vi.hoisted(() => vi.fn());
const downloadFull = vi.hoisted(() => vi.fn());
const getAllowListFreshness = vi.hoisted(() => vi.fn());
const me = vi.hoisted(() => ({ isAdmin: false }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('sonner', () => ({ toast }));
vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: { email: 'a@example.de', isAdmin: me.isAdmin } }),
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({
    data: [
      {
        identifier: 'dsf.klinik.example.de',
        name: 'Klinik FHIR',
        address: 'https://fhir.klinik.example.de/fhir/',
      },
      { identifier: 'broken.example.de', name: 'Broken', address: 'ftp://broken.example.de' },
    ],
    isLoading: false,
  }),
}));
vi.mock('../BundlePreview', () => ({ BundlePreview: () => null }));
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ downloadBundle, getBundleHistory, downloadIpList, getAllowListFreshness }),
  downloadFullAllowListBundle: downloadFull,
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
const FRESH_UNKNOWN = {
  currentVersion: null,
  currentPublishedAt: null,
  lastObtainedVersion: null,
  lastObtainedAt: null,
  via: null,
  outdated: false,
};
const BASE = `${window.location.origin}/fhir/Bundle/dsf.klinik.example.de`;
const HASH = 'ab'.repeat(32);
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJjb250ZW50SGFzaCI6ImFiIn0.c2ln';

/** A bundle response whose body hashes (through the stubbed digest) to the stub. */
function bundleResponse(headers: Record<string, string>) {
  const blob = new Blob(['{"resourceType":"Bundle"}'], { type: 'application/fhir+json' });
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
  return { data: blob, headers };
}

function stubDigest(hex: string) {
  const bytes = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => bytes.buffer) } });
}

async function openWithEndpoint() {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
  await user.selectOptions(screen.getByLabelText('Endpoint'), 'dsf.klinik.example.de');
  return user;
}

async function downloadVersion3() {
  const user = await openWithEndpoint();
  await user.click(await screen.findByTestId('download-version-3'));
  return screen.findByTestId('verify-panel');
}

beforeEach(() => {
  vi.clearAllMocks();
  me.isAdmin = false;
  getBundleHistory.mockResolvedValue({ data: { data: HISTORY } });
  getAllowListFreshness.mockResolvedValue({ data: { data: FRESH_UNKNOWN } });
  downloadBundle.mockResolvedValue(
    bundleResponse({ 'x-content-hash': HASH, 'x-bundle-signature': JWT }),
  );
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DownloadModal – DSF link and history', () => {
  it('asks for an endpoint before showing a link', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByText(/select an endpoint to get the task link/i)).toBeInTheDocument();
    expect(screen.queryByTestId('dsf-link')).toBeNull();
    expect(getBundleHistory).not.toHaveBeenCalled();
  });

  it('leads with the current allow-list URL of the endpoint, copyable, plus the Task input in the guide', async () => {
    const user = await openWithEndpoint();
    expect(screen.getByTestId('dsf-link')).toHaveTextContent(BASE);
    expect(
      screen.getByText('http://dsf.dev/fhir/CodeSystem/allow-list|allow_list'),
    ).toBeInTheDocument();
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

  it('shows the empty state of the history', async () => {
    getBundleHistory.mockResolvedValueOnce({ data: { data: [] } });
    await openWithEndpoint();
    expect(await screen.findByText(/No version has been published/)).toBeInTheDocument();
  });

  it('reports a failing history load', async () => {
    getBundleHistory.mockRejectedValueOnce(new Error('boom'));
    await openWithEndpoint();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });

  it('reports a failing copy', async () => {
    const user = await openWithEndpoint();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByTestId('copy-dsf-link'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

describe('DownloadModal – versioned download and verification', () => {
  it('enables version downloads right away, without any acknowledgement', async () => {
    await openWithEndpoint();
    expect(await screen.findByTestId('download-version-3')).toBeEnabled();
  });

  it('downloads the chosen version, shows hash and signature and confirms a matching hash', async () => {
    stubDigest(HASH);
    const panel = await downloadVersion3();
    expect(downloadBundle).toHaveBeenCalledWith('dsf.klinik.example.de', 3);
    expect(panel).toHaveTextContent('dsf-allow-list-v3.json');
    // Grouped for reading, copied raw.
    expect(within(panel).getByText(/^abab abab/)).toBeInTheDocument();
    expect(within(panel).getByTestId('hash-check')).toHaveTextContent(
      'The downloaded file matches this hash.',
    );
    expect(within(panel).getByText(JWT)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Bundle downloaded.');
    // Step 2 commands now name the downloaded file.
    expect(screen.getByText('sha256sum dsf-allow-list-v3.json')).toBeInTheDocument();
    expect(
      screen.getByText('Get-FileHash dsf-allow-list-v3.json -Algorithm SHA256'),
    ).toBeInTheDocument();
  });

  it('warns when the received bytes do not match the content hash', async () => {
    stubDigest('cd'.repeat(32));
    const panel = await downloadVersion3();
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      'The downloaded file does not match this hash. Do not import it.',
    );
  });

  it('asks for a manual check when the browser cannot hash the file', async () => {
    vi.stubGlobal('crypto', {});
    const panel = await downloadVersion3();
    expect(
      within(panel).getByText('Compare the hash of the file yourself (step 2).'),
    ).toBeInTheDocument();
  });

  it('warns when the server sent neither hash nor signature', async () => {
    downloadBundle.mockResolvedValueOnce(bundleResponse({}));
    const panel = await downloadVersion3();
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      'The server sent no hash or signature',
    );
  });

  it('copies the commands of the guide', async () => {
    const user = await openWithEndpoint();
    await user.click(screen.getByRole('button', { name: 'Copy sha256sum' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sha256sum dsf-allow-list.json');
  });

  it('toasts an error when the download fails', async () => {
    downloadBundle.mockRejectedValueOnce(new Error('boom'));
    const user = await openWithEndpoint();
    await user.click(await screen.findByTestId('download-version-3'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to download the bundle.'));
    expect(screen.queryByTestId('verify-panel')).toBeNull();
  });

  it('verifies the network-wide bundle the same way', async () => {
    stubDigest(HASH);
    downloadFull.mockResolvedValue(
      bundleResponse({ 'x-content-hash': HASH, 'x-bundle-signature': JWT }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    await user.click(screen.getByTestId('download-bundle-btn'));
    const panel = await screen.findByTestId('verify-panel');
    expect(downloadFull).toHaveBeenCalledTimes(1);
    expect(panel).toHaveTextContent('dsf-allow-list-bundle.json');
    expect(within(panel).getByTestId('hash-check')).toHaveTextContent('matches');
  });
});

describe('DownloadModal – guide, IP list and gate', () => {
  it('puts the process link inside the translated step 3 sentence', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    const link = screen.getByRole('link', { name: 'dsf-process-allow-list' });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/datasharingframework/dsf-process-allow-list',
    );
    expect(link.parentElement).toHaveTextContent(/^Start the DSF process downloadAllowList \(/);
    expect(link.parentElement).toHaveTextContent(/registered in the portal\.$/);
  });

  it('shows the manual upload curl command with a placeholder before an endpoint is chosen', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    const cmd = screen.getByText(/^curl --cert client_certificate[.]pem/);
    expect(cmd).toHaveTextContent('-H "Accept: application/fhir+json"');
    expect(cmd).toHaveTextContent('-H "Content-Type: application/fhir+json"');
    expect(cmd).not.toHaveTextContent('xml');
    expect(cmd).toHaveTextContent(
      '--data-binary @dsf-allow-list.json https://YOUR_DSF_FHIR_HOST/fhir/',
    );
  });

  it('targets the selected endpoint with exactly one trailing slash and the downloaded file', async () => {
    await downloadVersion3();
    const cmd = screen.getByText(/^curl --cert client_certificate[.]pem/);
    expect(
      cmd.textContent?.endsWith(
        '--data-binary @dsf-allow-list-v3.json https://fhir.klinik.example.de/fhir/',
      ),
    ).toBe(true);
  });

  it('adds the trailing slash when the address has none', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    await user.selectOptions(screen.getByLabelText('Endpoint'), 'broken.example.de');
    expect(
      screen.getByText(/^curl --cert/).textContent?.endsWith(' ftp://broken.example.de/'),
    ).toBe(true);
  });

  it('shows the IP address list to non-admins too', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByTestId('download-ip-btn')).toBeInTheDocument();
  });

  it('offers the IP address list to admins, without a gate', async () => {
    me.isAdmin = true;
    downloadIpList.mockResolvedValue({ data: new Blob(['x']) });
    const user = userEvent.setup();
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByTestId('download-ip-btn')).toBeEnabled();
    await user.click(screen.getByTestId('download-ip-btn'));
    await waitFor(() => expect(downloadIpList).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('IP address list downloaded.');
  });

  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <DownloadModal open={false} onClose={() => {}} instanceId="i1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a calm disclaimer note and never gates a download', async () => {
    me.isAdmin = true;
    await openWithEndpoint();
    expect(screen.getByRole('heading', { name: /download allow list/i })).toBeInTheDocument();
    const note = screen.getByTestId('bundle-disclaimer');
    expect(note).toHaveTextContent(/recommendation/i);
    expect(within(note).queryByRole('checkbox')).toBeNull();
    // The full text sits behind a disclosure.
    expect(within(note).getByText('Full notice').closest('details')).not.toHaveAttribute('open');
    const downloads = [
      screen.getByTestId('download-bundle-btn'),
      screen.getByTestId('download-ip-btn'),
      await screen.findByTestId('download-version-3'),
    ];
    for (const d of downloads) expect(d).toBeEnabled();
  });
});

describe('DownloadModal – Variant 1: DSF web UI', () => {
  const SHARED = `${window.location.origin}/fhir/Bundle/mine`;
  const TASK_TEXT =
    'https://fhir.klinik.example.de/fhir/Task?identifier=http://dsf.dev/sid/task-identifier|http://dsf.dev/bpe/Process/downloadAllowList/1.0/task-download-allow-list&status=draft';
  const TASK_HREF =
    'https://fhir.klinik.example.de/fhir/Task?identifier=http%3A%2F%2Fdsf.dev%2Fsid%2Ftask-identifier%7Chttp%3A%2F%2Fdsf.dev%2Fbpe%2FProcess%2FdownloadAllowList%2F1.0%2Ftask-download-allow-list&status=draft';

  it('asks for an endpoint before offering the steps and the shared link', () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /variant 1: dsf web ui/i })).toBeInTheDocument();
    expect(screen.getByText(/select an endpoint to get the task link/i)).toBeInTheDocument();
    expect(screen.queryByTestId('dsf-task-open')).toBeNull();
    expect(screen.queryByTestId('shared-link')).toBeNull();
  });

  it('shows the four steps: plugin link, Task link and the per-endpoint download URL', async () => {
    await openWithEndpoint();
    const steps = within(screen.getByTestId('dsf-task-steps'));
    expect(steps.getAllByRole('listitem')).toHaveLength(4);
    const plugin = screen.getByTestId('dsf-plugin-link');
    expect(plugin).toHaveAttribute(
      'href',
      'https://github.com/datasharingframework/dsf-process-allow-list/releases',
    );
    expect(plugin).toHaveAttribute('target', '_blank');
    expect(plugin).toHaveAttribute('rel', 'noopener noreferrer');
    const open = screen.getByTestId('dsf-task-open');
    expect(open).toHaveAttribute('href', TASK_HREF);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByTestId('dsf-task-url')).toHaveTextContent(TASK_TEXT);
    expect(screen.getByTestId('dsf-link')).toHaveTextContent(BASE);
  });

  it('keeps the shared /mine link as a secondary hint and copies every value', async () => {
    const user = await openWithEndpoint();
    expect(screen.getByTestId('shared-link')).toHaveTextContent(SHARED);
    await user.click(screen.getByTestId('copy-shared-link'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SHARED);
    await user.click(screen.getByTestId('dsf-task-copy'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(TASK_HREF);
    await user.click(screen.getByTestId('copy-dsf-link'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(BASE);
  });

  it('shows a hint instead of a link for a non-http(s) endpoint address', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    await user.selectOptions(screen.getByLabelText('Endpoint'), 'broken.example.de');
    expect(screen.getByRole('alert')).toHaveTextContent(/not a valid http\(s\) url/i);
    expect(screen.queryByTestId('dsf-task-open')).toBeNull();
  });
});

describe('DownloadModal – new allow-list banner', () => {
  const outdated = {
    currentVersion: 3,
    currentPublishedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    lastObtainedVersion: 2,
    lastObtainedAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
    via: 'DSF',
    outdated: true,
  };

  it('shows the info banner at the top while a newer version is waiting', async () => {
    getAllowListFreshness.mockResolvedValue({ data: { data: outdated } });
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(await screen.findByTestId('freshness-banner')).toHaveTextContent(
      'Version 3 is new (published 3h ago). Your DSF last fetched version 2 (2d ago).',
    );
  });

  it('shows the success line when the DSF is current', async () => {
    getAllowListFreshness.mockResolvedValue({
      data: { data: { ...outdated, lastObtainedVersion: 3, outdated: false } },
    });
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    expect(await screen.findByTestId('freshness-current')).toHaveTextContent(
      'Your DSF is up to date (version 3, fetched 2d ago).',
    );
    expect(screen.queryByTestId('freshness-banner')).toBeNull();
  });

  it('shows neither while nothing is known', async () => {
    renderWithProviders(<DownloadModal open onClose={() => {}} instanceId="i1" />);
    await waitFor(() => expect(getAllowListFreshness).toHaveBeenCalled());
    expect(screen.queryByTestId('freshness-banner')).toBeNull();
    expect(screen.queryByTestId('freshness-current')).toBeNull();
  });

  it('refreshes the freshness after a version download', async () => {
    getAllowListFreshness.mockResolvedValue({ data: { data: outdated } });
    await downloadVersion3();
    await waitFor(() => expect(getAllowListFreshness.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
