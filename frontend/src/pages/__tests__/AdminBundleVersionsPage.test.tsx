/**
 * AdminBundleVersionsPage.test.tsx — allow-list history: timeline (newest
 * first, current marked), default diff of the newest version against its
 * predecessor rendered in plain language, version selection, empty/error
 * states and the four-eyes restore: the request dialog in cert mode (reason
 * only) and OTP mode (reason + TOTP), the VERSION_NOT_RESTORABLE conflict, and
 * the pending-restore card (approve, reject, cancel in both modes, same-site
 * and own-request rules, status in the timeline).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  diff: vi.fn(),
  restore: vi.fn(),
  listRestores: vi.fn(),
  approveRestore: vi.fn(),
  rejectRestore: vi.fn(),
  cancelRestore: vi.fn(),
}));
const useMe = vi.hoisted(() => vi.fn());
const certMode = vi.hoisted(() => ({ value: false }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../../api/bundleVersions.api', () => ({
  bundleVersionsApi: { ...api, downloadUrl: (id: string) => `/download/${id}` },
}));
vi.mock('../../hooks/useMe', () => ({ useMe }));
vi.mock('../../lib/authMode', () => ({
  isCertMode: () => certMode.value,
  needsTotpStepUp: () => !certMode.value,
  reauthRedirect: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));

import { AdminBundleVersionsPage } from '../AdminBundleVersionsPage';

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `id${n}`,
  version_number: n,
  created_at: '2026-05-01T10:00:00Z',
  triggered_by: 'APPROVAL',
  triggered_by_email: 'admin@example.de',
  content_hash: 'abc',
  notes: null,
  approval_request_id: null,
  isCurrent: false,
  restorable: true,
  ...extra,
});

const ORG = 'http://dsf.dev/sid/organization-identifier';
const newOrg = {
  fullUrl: 'urn:uuid:1',
  resource: {
    resourceType: 'Organization',
    identifier: [{ system: ORG, value: 'neu.example.de' }],
    name: 'Neue Klinik',
  },
  request: { method: 'PUT', url: `Organization?identifier=${ORG}|neu.example.de` },
};

function mockList(rows: unknown[]) {
  api.list.mockResolvedValue({
    data: { data: rows, meta: { page: 1, limit: 50, total: rows.length, pages: 1 } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  certMode.value = false;
  mockList([
    row(7, { isCurrent: true, notes: 'Quarterly approval' }),
    row(6),
    row(5, { restorable: false }),
  ]);
  api.diff.mockResolvedValue({ data: { data: { added: [newOrg], removed: [], changed: [] } } });
  api.listRestores.mockResolvedValue({ data: { data: [] } });
  useMe.mockReturnValue({ data: { email: 'alice@imi-a.example.de', isAdmin: true } });
});

describe('AdminBundleVersionsPage', () => {
  it('shows the timeline newest first with the current version marked', async () => {
    renderWithProviders(<AdminBundleVersionsPage />);
    expect(screen.getByRole('heading', { name: 'Bundle versions' })).toBeInTheDocument();
    const timeline = await screen.findByTestId('bundle-timeline');
    const items = within(timeline).getAllByRole('listitem');
    expect(items.map((li) => within(li).getByText(/^v\d$/).textContent)).toEqual([
      'v7',
      'v6',
      'v5',
    ]);
    expect(within(items[0]).getByText('Current')).toBeInTheDocument();
    expect(within(items[0]).getByText('Quarterly approval')).toBeInTheDocument();
    // Only restorable, non-current versions offer Restore.
    expect(within(items[0]).queryByRole('button', { name: /restore/i })).toBeNull();
    expect(
      within(items[1]).getByRole('button', { name: 'Request restore of version 6' }),
    ).toBeInTheDocument();
    expect(within(items[2]).queryByRole('button', { name: /restore/i })).toBeNull();
  });

  it('diffs the newest version against its predecessor and explains it in plain language', async () => {
    renderWithProviders(<AdminBundleVersionsPage />);
    expect(await screen.findByTestId('diff-summary')).toHaveTextContent('1 organization added');
    expect(api.diff).toHaveBeenCalledWith('id6', 'id7');
    expect(screen.getByText('Changes in v7 compared with v6')).toBeInTheDocument();
    const org = screen.getByTestId('diff-org');
    expect(org).toHaveAttribute('data-status', 'added');
    expect(within(org).getByText('Neue Klinik')).toBeInTheDocument();
    expect(within(org).getByText('Organization added')).toBeInTheDocument();
  });

  it('keeps the raw FHIR behind a disclosure', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    await screen.findByTestId('diff-summary');
    expect(screen.queryByTestId('diff-raw')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show raw FHIR data' }));
    expect(screen.getByTestId('diff-raw')).toHaveTextContent('neu.example.de');
  });

  it('selecting another version compares it with its own predecessor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    await screen.findByTestId('diff-summary');
    await user.click(screen.getByTestId('version-6'));
    await waitFor(() => expect(api.diff).toHaveBeenCalledWith('id5', 'id6'));
  });

  it('orders the diff arguments older to newer when the comparison version is newer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    await screen.findByTestId('diff-summary');
    await user.click(screen.getByTestId('version-6'));
    await waitFor(() => expect(api.diff).toHaveBeenLastCalledWith('id5', 'id6'));
    await user.selectOptions(screen.getByRole('combobox'), 'id7');
    await waitFor(() => expect(api.diff).toHaveBeenLastCalledWith('id6', 'id7'));
  });

  it('says so when the first version has nothing to compare with', async () => {
    mockList([row(1, { isCurrent: true })]);
    renderWithProviders(<AdminBundleVersionsPage />);
    expect(await screen.findByText(/first version/)).toBeInTheDocument();
    expect(api.diff).not.toHaveBeenCalled();
  });

  it('shows the empty state', async () => {
    mockList([]);
    renderWithProviders(<AdminBundleVersionsPage />);
    expect(await screen.findByText(/No bundle versions yet/)).toBeInTheDocument();
  });

  it('shows a retryable error when the list fails', async () => {
    api.list.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('bundle-timeline')).toBeInTheDocument();
  });

  it('shows an error with retry when the diff fails', async () => {
    api.diff.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<AdminBundleVersionsPage />);
    expect(await screen.findByText('The changes could not be loaded.')).toBeInTheDocument();
  });

  it('says when two versions are identical', async () => {
    api.diff.mockResolvedValue({ data: { data: { added: [], removed: [], changed: [] } } });
    renderWithProviders(<AdminBundleVersionsPage />);
    expect(await screen.findByText(/exactly the same content/)).toBeInTheDocument();
  });

  describe('restore', () => {
    it('in cert mode asks only for a reason, then restores and confirms', async () => {
      certMode.value = true;
      api.restore.mockResolvedValue({ data: { data: { id: 'rr1', sourceVersionNumber: 6 } } });
      const user = userEvent.setup();
      renderWithProviders(<AdminBundleVersionsPage />);
      await user.click(await screen.findByRole('button', { name: 'Request restore of version 6' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/affects all sites/)).toBeInTheDocument();
      expect(within(dialog).queryByLabelText('Authenticator code')).toBeNull();

      // A reason is required.
      await user.click(within(dialog).getByRole('button', { name: 'Request restore' }));
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Please give a reason.');
      expect(api.restore).not.toHaveBeenCalled();

      await user.type(within(dialog).getByLabelText('Reason'), 'Wrong thumbprint approved');
      await user.click(within(dialog).getByRole('button', { name: 'Request restore' }));
      await waitFor(() =>
        expect(api.restore).toHaveBeenCalledWith('id6', {
          reason: 'Wrong thumbprint approved',
          totpCode: undefined,
        }),
      );
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          'Restore of version 6 requested. A second admin from another site must approve it.',
        ),
      );
      // The restore requests are refreshed.
      await waitFor(() => expect(api.listRestores.mock.calls.length).toBeGreaterThan(1));
    });

    it('explains in the dialog that a second admin from another site must approve', async () => {
      certMode.value = true;
      const user = userEvent.setup();
      renderWithProviders(<AdminBundleVersionsPage />);
      await user.click(await screen.findByRole('button', { name: 'Request restore of version 6' }));
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByRole('heading', { name: 'Request restore of version 6' }),
      ).toBeInTheDocument();
      expect(dialog).toHaveTextContent('a second admin from another site approves the request');
      expect(within(dialog).getByRole('button', { name: 'Request restore' })).toBeInTheDocument();
    });

    it('tells when another restore request is already pending', async () => {
      certMode.value = true;
      api.restore.mockRejectedValue({
        response: { data: { error: { code: 'ALREADY_PENDING', message: 'x' } } },
      });
      const user = userEvent.setup();
      renderWithProviders(<AdminBundleVersionsPage />);
      await user.click(await screen.findByRole('button', { name: 'Request restore of version 6' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Reason'), 'Rollback');
      await user.click(within(dialog).getByRole('button', { name: 'Request restore' }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'A restore request is already waiting for approval.',
        ),
      );
    });

    it('in OTP mode also requires a six-digit TOTP code', async () => {
      api.restore.mockResolvedValue({ data: { data: { id: 'rr1', sourceVersionNumber: 6 } } });
      const user = userEvent.setup();
      renderWithProviders(<AdminBundleVersionsPage />);
      await user.click(await screen.findByRole('button', { name: 'Request restore of version 6' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Reason'), 'Rollback');
      await user.type(within(dialog).getByLabelText('Authenticator code'), '12');
      await user.click(within(dialog).getByRole('button', { name: 'Request restore' }));
      expect(within(dialog).getByRole('alert')).toHaveTextContent('6-digit');
      expect(api.restore).not.toHaveBeenCalled();

      await user.type(within(dialog).getByLabelText('Authenticator code'), '3456');
      await user.click(within(dialog).getByRole('button', { name: 'Request restore' }));
      await waitFor(() =>
        expect(api.restore).toHaveBeenCalledWith('id6', { reason: 'Rollback', totpCode: '123456' }),
      );
    });

    it('cancelling does not restore', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminBundleVersionsPage />);
      await user.click(await screen.findByRole('button', { name: 'Request restore of version 6' }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
      );
      expect(api.restore).not.toHaveBeenCalled();
    });

    it('closes and refreshes when the version is no longer restorable', async () => {
      certMode.value = true;
      api.restore.mockRejectedValue({
        response: { data: { error: { code: 'VERSION_NOT_RESTORABLE', message: 'x' } } },
      });
      const user = userEvent.setup();
      renderWithProviders(<AdminBundleVersionsPage />);
      await user.click(await screen.findByRole('button', { name: 'Request restore of version 6' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Reason'), 'Rollback');
      await user.click(within(dialog).getByRole('button', { name: 'Request restore' }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('This version can no longer be restored.'),
      );
      await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(1));
    });

    it('keeps the dialog open with the server message on other failures', async () => {
      api.restore.mockRejectedValue({
        response: { data: { error: { code: 'INVALID_TOTP', message: 'Invalid code' } } },
      });
      const user = userEvent.setup();
      renderWithProviders(<AdminBundleVersionsPage />);
      await user.click(await screen.findByRole('button', { name: 'Request restore of version 6' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Reason'), 'Rollback');
      await user.type(within(dialog).getByLabelText('Authenticator code'), '123456');
      await user.click(within(dialog).getByRole('button', { name: 'Request restore' }));
      expect(await within(dialog).findByText('Invalid code')).toBeInTheDocument();
    });
  });
});
