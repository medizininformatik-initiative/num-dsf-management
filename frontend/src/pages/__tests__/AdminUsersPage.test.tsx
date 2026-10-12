/**
 * AdminUsersPage.test.tsx — admin whitelist + role manager. adminUsersApi.list
 * is mocked with two whitelist rows and useMe is mocked to an admin viewer.
 * Asserts the title and the mocked rows render, then drives the actions
 * through the step-up dialog (foundation Modal): remove and add send the row
 * email and the entered 6-digit code, lock sends its reason, Escape closes the
 * dialog without acting, and a failed attempt keeps the dialog open with the
 * spent code cleared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { WhitelistEntry } from '../../api/admin.api';

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMe', () => ({ useMe }));

const { listMock, addMock, removeMock, lockMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  addMock: vi.fn().mockResolvedValue({ ok: true }),
  removeMock: vi.fn().mockResolvedValue({}),
  lockMock: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../api/admin.api', () => ({
  adminUsersApi: {
    list: listMock,
    add: addMock,
    lock: lockMock,
    unlock: vi.fn(),
    demote: vi.fn(),
    remove: removeMock,
  },
  adminPromotionsApi: {
    create: vi.fn().mockResolvedValue({ id: 'p1' }),
  },
}));

const certApi = vi.hoisted(() => ({
  all: vi.fn(),
  preview: vi.fn(),
  addFor: vi.fn(),
  removeFor: vi.fn(),
}));
const reqApi = vi.hoisted(() => ({
  list: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('../../api/adminCertificates.api', () => ({
  adminCertificatesApi: certApi,
  adminCertRequestsApi: reqApi,
}));

import { AdminUsersPage } from '../AdminUsersPage';

function users(): WhitelistEntry[] {
  return [
    {
      email: 'me@imi-a.example.de',
      created_at: '2026-01-01T00:00:00Z',
      created_by: 'root@imi.example.de',
      locked_at: null,
      locked_by: null,
      locked_reason: null,
      is_admin: true,
    },
    {
      email: 'bob@imi-b.example.de',
      created_at: '2026-02-01T00:00:00Z',
      created_by: 'root@imi.example.de',
      locked_at: null,
      locked_by: null,
      locked_reason: null,
      is_admin: false,
    },
  ];
}

async function openRowAction(name: string) {
  const bobCell = await screen.findByText('bob@imi-b.example.de');
  const bobRow = bobCell.closest('tr') as HTMLTableRowElement;
  fireEvent.click(within(bobRow).getByRole('button', { name }));
  return screen.findByRole('dialog');
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue(users());
    addMock.mockClear();
    removeMock.mockReset();
    removeMock.mockResolvedValue({});
    lockMock.mockClear();
    Object.values(certApi).forEach((f) => f.mockReset());
    certApi.all.mockResolvedValue([]);
    Object.values(reqApi).forEach((f) => f.mockReset());
    reqApi.list.mockResolvedValue([]);
    useMe.mockReturnValue({ data: { email: 'me@imi-a.example.de', isAdmin: true } });
  });

  it('renders the title and both whitelist rows from the mocked list', async () => {
    renderWithProviders(<AdminUsersPage />);

    expect(screen.getByRole('heading', { name: 'User management' })).toBeInTheDocument();

    // Both rows render from the mocked query data.
    expect(await screen.findByText('me@imi-a.example.de')).toBeInTheDocument();
    expect(screen.getByText('bob@imi-b.example.de')).toBeInTheDocument();

    // The admin row shows the Admin role; the viewer's own row is marked "(you)".
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText(/\(you\)/)).toBeInTheDocument();
  });

  it('removes a whitelisted user: the dialog explains it and sends the TOTP code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    const dialog = await openRowAction('Remove');
    expect(within(dialog).getByText('Remove from whitelist')).toBeInTheDocument();
    expect(within(dialog).getByText('bob@imi-b.example.de')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'The address is removed from the whitelist and can no longer sign in.',
      ),
    ).toBeInTheDocument();

    // Confirm stays disabled until the 6-digit step-up code is complete.
    const confirm = within(dialog).getByRole('button', { name: 'Remove' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByPlaceholderText('000000'), {
      target: { value: '123456' },
    });
    await user.click(confirm);

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('bob@imi-b.example.de', '123456'), {
      timeout: 4000,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('adds a whitelisted email: confirm fires adminUsersApi.add with the new email and code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);
    await screen.findByText('bob@imi-b.example.de');

    fireEvent.change(screen.getByLabelText('Email address to whitelist'), {
      target: { value: 'new@imi-c.example.de' },
    });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Whitelist new email')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByPlaceholderText('000000'), {
      target: { value: '654321' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addMock).toHaveBeenCalledWith('new@imi-c.example.de', '654321'), {
      timeout: 4000,
    });
  });

  it('locks with the typed reason', async () => {
    renderWithProviders(<AdminUsersPage />);
    const dialog = await openRowAction('Lock');
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), {
      target: { value: 'left the project' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('000000'), {
      target: { value: '111222' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lock' }));
    await waitFor(() =>
      expect(lockMock).toHaveBeenCalledWith('bob@imi-b.example.de', 'left the project', '111222'),
    );
  });

  it('closes the dialog with Escape without acting', async () => {
    renderWithProviders(<AdminUsersPage />);
    const dialog = await openRowAction('Remove');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and clears the spent code when the action fails', async () => {
    removeMock.mockRejectedValue({
      response: { status: 401, data: { error: { code: 'TOTP_INVALID', message: 'Invalid' } } },
    });
    renderWithProviders(<AdminUsersPage />);
    const dialog = await openRowAction('Remove');
    const code = within(dialog).getByPlaceholderText('000000');
    fireEvent.change(code, { target: { value: '000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(removeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(code).toHaveValue(''));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows admin certificate counts and lets an admin recover a colleague', async () => {
    const colleague = { ...users()[1], email: 'carol@imi-c.example.de', is_admin: true };
    listMock.mockResolvedValue([users()[0], colleague]);
    certApi.all.mockResolvedValue([
      {
        id: 'k1',
        email: 'carol@imi-c.example.de',
        label: 'old',
        subject: 'cn',
        fingerprint: 'c'.repeat(128),
        validUntil: new Date(Date.now() - 86_400_000).toISOString(),
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
        createdBy: 'bootstrap',
      },
    ]);
    certApi.removeFor.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    const row = (await screen.findByText('carol@imi-c.example.de')).closest('tr') as HTMLElement;
    expect(within(row).getByText('1 registered')).toBeInTheDocument();
    // No certificates action on the viewer's own row.
    const meRow = screen.getByText('me@imi-a.example.de').closest('tr') as HTMLElement;
    expect(within(meRow).queryByRole('button', { name: 'Certificates' })).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Certificates' }));
    const list = await screen.findByRole('dialog');
    expect(within(list).getByText('old')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Remove' }));

    const confirmDialogs = await screen.findAllByRole('dialog');
    const confirm = confirmDialogs[confirmDialogs.length - 1];
    fireEvent.change(within(confirm).getByPlaceholderText('000000'), {
      target: { value: '111222' },
    });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(certApi.removeFor).toHaveBeenCalledWith('carol@imi-c.example.de', 'k1', '111222'),
    );
  });

  it('words the colleague action as a request that another site must approve', async () => {
    const colleague = { ...users()[1], email: 'carol@imi-c.example.de', is_admin: true };
    listMock.mockResolvedValue([users()[0], colleague]);
    const user = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    const row = (await screen.findByText('carol@imi-c.example.de')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Certificates' }));
    const list = await screen.findByRole('dialog');
    expect(within(list).queryByRole('button', { name: 'Register certificate' })).toBeNull();
    await user.click(within(list).getByRole('button', { name: 'Request certificate' }));

    const dialogs = await screen.findAllByRole('dialog');
    const add = dialogs[dialogs.length - 1];
    expect(within(add).getByText('Request certificate for an admin')).toBeInTheDocument();
    expect(within(add).getByText(/another admin from a different site/)).toBeInTheDocument();
    expect(within(add).getByRole('button', { name: 'Request certificate' })).toBeDisabled();
  });

  describe('open certificate requests', () => {
    const req = (over: Record<string, unknown>) => ({
      id: 'r',
      targetEmail: 'carol@imi-c.example.de',
      fingerprint: 'a'.repeat(128),
      subject: 'carol-new',
      validUntil: '2030-01-01T00:00:00Z',
      label: null,
      requestedBy: 'dave@imi-d.example.de',
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      comment: null,
      createdAt: new Date().toISOString(),
      ...over,
    });

    it('renders nothing without pending requests', async () => {
      reqApi.list.mockResolvedValue([req({ id: 'done', status: 'APPROVED' })]);
      renderWithProviders(<AdminUsersPage />);
      await screen.findByText('bob@imi-b.example.de');
      await waitFor(() => expect(reqApi.list).toHaveBeenCalled());
      expect(screen.queryByTestId('pending-cert-requests')).toBeNull();
    });

    it('disables approval with the reason for own request, target and same site', async () => {
      reqApi.list.mockResolvedValue([
        req({ id: 'own', requestedBy: 'me@imi-a.example.de', subject: 'own-cert' }),
        req({ id: 'target', targetEmail: 'me@imi-a.example.de', subject: 'target-cert' }),
        req({ id: 'site', requestedBy: 'zoe@imi-a.example.de', subject: 'site-cert' }),
        req({ id: 'ok', subject: 'ok-cert' }),
      ]);
      renderWithProviders(<AdminUsersPage />);
      const card = await screen.findByTestId('pending-cert-requests');
      const rowOf = (subject: string) =>
        within(card).getByText(new RegExp(subject)).closest('li') as HTMLElement;

      const own = rowOf('own-cert');
      expect(within(own).getByRole('button', { name: 'Approve' })).toBeDisabled();
      expect(within(own).getByText(/You requested this certificate/)).toBeInTheDocument();
      expect(within(own).getByRole('button', { name: 'Cancel request' })).toBeEnabled();
      expect(within(own).queryByRole('button', { name: 'Reject' })).toBeNull();

      const target = rowOf('target-cert');
      expect(within(target).getByRole('button', { name: 'Approve' })).toBeDisabled();
      expect(within(target).getByText(/request is for your own account/)).toBeInTheDocument();

      const site = rowOf('site-cert');
      expect(within(site).getByRole('button', { name: 'Approve' })).toBeDisabled();
      expect(within(site).getByText(/different site than the requester/)).toBeInTheDocument();

      const ok = rowOf('ok-cert');
      expect(within(ok).getByRole('button', { name: 'Approve' })).toBeEnabled();
    });

    it('approves through the step-up dialog and rejects only with a reason', async () => {
      reqApi.list.mockResolvedValue([req({ id: 'ok', subject: 'ok-cert' })]);
      reqApi.approve.mockResolvedValue({});
      reqApi.reject.mockResolvedValue({});
      const user = userEvent.setup();
      renderWithProviders(<AdminUsersPage />);
      const card = await screen.findByTestId('pending-cert-requests');

      await user.click(within(card).getByRole('button', { name: 'Approve' }));
      let dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByPlaceholderText('000000'), {
        target: { value: '123456' },
      });
      await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(reqApi.approve).toHaveBeenCalledWith('ok', '123456'));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      await user.click(within(card).getByRole('button', { name: 'Reject' }));
      dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByPlaceholderText('000000'), {
        target: { value: '654321' },
      });
      expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'not ok' } });
      await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(reqApi.reject).toHaveBeenCalledWith('ok', 'not ok', '654321'));
    });

    it('lets the requester cancel', async () => {
      reqApi.list.mockResolvedValue([
        req({ id: 'own', requestedBy: 'me@imi-a.example.de', subject: 'own-cert' }),
      ]);
      reqApi.cancel.mockResolvedValue({});
      const user = userEvent.setup();
      renderWithProviders(<AdminUsersPage />);
      const card = await screen.findByTestId('pending-cert-requests');
      await user.click(within(card).getByRole('button', { name: 'Cancel request' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByPlaceholderText('000000'), {
        target: { value: '111111' },
      });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
      await waitFor(() => expect(reqApi.cancel).toHaveBeenCalledWith('own', '111111'));
    });
  });
});
