/**
 * AdminBundleRestoreRequests.test.tsx — the pending-restore card on the
 * allow-list history page: a second admin of another site approves (new version
 * toast) or rejects (comment required), the requester can only cancel, an
 * approver of the requester's site sees why approval is unavailable, the
 * step-up differs in OTP mode (TOTP code) and cert mode (no code), and the
 * timeline shows the request status.
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

const version = (n: number, extra: Record<string, unknown> = {}) => ({
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

const request = (extra: Record<string, unknown> = {}) => ({
  id: 'rr1',
  sourceVersionId: 'id6',
  sourceVersionNumber: 6,
  reason: 'Wrong thumbprint approved',
  requestedBy: 'alice@imi-a.example.de',
  requestedAt: new Date().toISOString(),
  status: 'PENDING',
  decidedBy: null,
  decidedAt: null,
  decisionComment: null,
  resultingVersionId: null,
  resultingVersionNumber: null,
  ...extra,
});

function asUser(email: string) {
  useMe.mockReturnValue({ data: { email, isAdmin: true } });
}

beforeEach(() => {
  vi.clearAllMocks();
  certMode.value = false;
  api.list.mockResolvedValue({
    data: {
      data: [version(7, { isCurrent: true }), version(6), version(5)],
      meta: { page: 1, limit: 50, total: 3, pages: 1 },
    },
  });
  api.diff.mockResolvedValue({ data: { data: { added: [], removed: [], changed: [] } } });
  api.listRestores.mockResolvedValue({ data: { data: [request()] } });
  asUser('bob@imi-b.example.de');
});

describe('pending restore card', () => {
  it('shows version, reason and requester, and marks the version in the timeline', async () => {
    renderWithProviders(<AdminBundleVersionsPage />);
    const card = await screen.findByTestId('pending-restore');
    expect(card).toHaveTextContent('Restore waiting for approval');
    expect(card).toHaveTextContent('Version 6 is to be published again');
    expect(card).toHaveTextContent('alice@imi-a.example.de');
    expect(card).toHaveTextContent('Wrong thumbprint approved');
    const timeline = await screen.findByTestId('bundle-timeline');
    expect(within(timeline).getByText('Restore requested')).toBeInTheDocument();
    // Nothing new can be requested while one is pending.
    for (const b of within(timeline).getAllByRole('button', { name: /request restore/i })) {
      expect(b).toBeDisabled();
    }
  });

  it('approves with a TOTP code in OTP mode and reports the new version', async () => {
    api.approveRestore.mockResolvedValue({
      data: { data: { id: 'id8', versionNumber: 8, restoredFromVersion: 6 } },
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Approve restore' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Approve restore of version 6?');
    const confirm = within(dialog).getByRole('button', { name: 'Approve restore' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('TOTP Code'), '123456');
    await user.click(confirm);
    await waitFor(() => expect(api.approveRestore).toHaveBeenCalledWith('rr1', '123456'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Version 6 restored as version 8.'),
    );
    await waitFor(() => expect(api.listRestores.mock.calls.length).toBeGreaterThan(1));
  });

  it('approves without a code in cert mode', async () => {
    certMode.value = true;
    api.approveRestore.mockResolvedValue({
      data: { data: { id: 'id8', versionNumber: 8, restoredFromVersion: 6 } },
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Approve restore' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('TOTP Code')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Approve restore' }));
    await waitFor(() => expect(api.approveRestore).toHaveBeenCalledWith('rr1', undefined));
  });

  it('rejects only with a comment', async () => {
    certMode.value = true;
    api.rejectRestore.mockResolvedValue({ data: { data: { ok: true } } });
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reject restore' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Comment (required)'), 'Not needed');
    await user.click(confirm);
    await waitFor(() =>
      expect(api.rejectRestore).toHaveBeenCalledWith('rr1', 'Not needed', undefined),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restore request rejected.'));
  });

  it('lets the requester only cancel, in cert mode and OTP mode', async () => {
    asUser('alice@imi-a.example.de');
    api.cancelRestore.mockResolvedValue({ data: { data: { ok: true } } });
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    const card = await screen.findByTestId('pending-restore');
    expect(within(card).queryByRole('button', { name: 'Approve restore' })).toBeNull();
    expect(card).toHaveTextContent('A second admin from another site has to approve your request.');
    await user.click(within(card).getByRole('button', { name: 'Cancel my request' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('TOTP Code'), '654321');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(api.cancelRestore).toHaveBeenCalledWith('rr1', '654321'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restore request cancelled.'));
  });

  it('cancels without a code in cert mode', async () => {
    certMode.value = true;
    asUser('alice@imi-a.example.de');
    api.cancelRestore.mockResolvedValue({ data: { data: { ok: true } } });
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Cancel my request' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('TOTP Code')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(api.cancelRestore).toHaveBeenCalledWith('rr1', undefined));
  });

  it('disables approval for an admin of the requesters site and says why', async () => {
    asUser('carol@imi-a.example.de');
    renderWithProviders(<AdminBundleVersionsPage />);
    const approve = await screen.findByRole('button', { name: 'Approve restore' });
    expect(approve).toBeDisabled();
    expect(screen.getByTestId('pending-restore')).toHaveTextContent(
      'Approver must be from a different site than the requester.',
    );
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('closes the dialog and refreshes when the request was decided meanwhile', async () => {
    certMode.value = true;
    api.approveRestore.mockRejectedValue({
      response: { data: { error: { code: 'NOT_PENDING', message: 'x' } } },
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminBundleVersionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Approve restore' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve restore' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This request has already been decided.'),
    );
    await waitFor(() => expect(api.listRestores.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows the outcome in the timeline when no request is pending', async () => {
    api.listRestores.mockResolvedValue({
      data: {
        data: [
          request({
            id: 'rr2',
            status: 'REJECTED',
            decidedBy: 'bob@imi-b.example.de',
            decisionComment: 'Not needed',
          }),
          request({
            id: 'rr3',
            sourceVersionId: 'id5',
            sourceVersionNumber: 5,
            status: 'APPROVED',
            decidedBy: 'bob@imi-b.example.de',
            resultingVersionId: 'id7',
            resultingVersionNumber: 7,
          }),
        ],
      },
    });
    renderWithProviders(<AdminBundleVersionsPage />);
    const timeline = await screen.findByTestId('bundle-timeline');
    expect(screen.queryByTestId('pending-restore')).toBeNull();
    expect(await within(timeline).findByText('Restore rejected')).toBeInTheDocument();
    expect(timeline).toHaveTextContent('Rejected by bob@imi-b.example.de: Not needed');
    expect(timeline).toHaveTextContent(
      'Restore of v5, requested by alice@imi-a.example.de, approved by bob@imi-b.example.de',
    );
    // Restoring is possible again.
    expect(
      within(timeline).getByRole('button', { name: 'Request restore of version 6' }),
    ).toBeEnabled();
  });
});
