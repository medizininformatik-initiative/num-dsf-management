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
});
