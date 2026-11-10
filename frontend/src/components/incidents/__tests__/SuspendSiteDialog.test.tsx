/**
 * SuspendSiteDialog.test.tsx — confirm and suspend with the step-up code:
 * at level 2 confirming suspends in the same request (confirm: true, all
 * measures on by default); unticking the toggle sends a plain confirm; the
 * suspend mode needs at least one measure; a refusal is worded and clears the
 * spent code. incidents.api is mocked; the session is an OTP session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Incident } from '../../../api/incidents.api';

const { confirmMock, suspendMock, toastError } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  suspendMock: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../../../api/incidents.api', async (orig) => ({
  ...(await orig<typeof import('../../../api/incidents.api')>()),
  incidentsApi: { confirm: confirmMock, suspend: suspendMock },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { SuspendSiteDialog } from '../SuspendSiteDialog';

const incident = {
  id: 'i1',
  title: 'Leaked key',
  status: 'REPORTED',
  escalationLevel: 2,
  organization: { identifier: 'ukm.de', name: 'Uniklinik Münster' },
} as Incident;

const ALL = ['BLOCK_CERTIFICATES', 'REMOVE_LOGINS', 'WITHDRAW', 'MAIL_SITES'];

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue({ data: { data: incident } });
  suspendMock.mockResolvedValue({ data: { data: { incident, results: [{}, {}, {}, {}] } } });
});

async function typeCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('TOTP Code'), '123456');
}

describe('SuspendSiteDialog', () => {
  it('confirms and suspends in one request at level 2', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <SuspendSiteDialog incident={incident} open confirmFirst onClose={onClose} />,
    );
    expect(screen.getByLabelText('Suspend the site in the same step')).toBeChecked();
    await typeCode(user);
    await user.click(screen.getByRole('button', { name: 'Confirm and suspend' }));
    await waitFor(() =>
      expect(suspendMock).toHaveBeenCalledWith('i1', { measures: ALL, confirm: true }, '123456'),
    );
    expect(confirmMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('sends a plain confirm when the toggle is off', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SuspendSiteDialog incident={incident} open confirmFirst onClose={vi.fn()} />,
    );
    await user.click(screen.getByLabelText('Suspend the site in the same step'));
    await typeCode(user);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith('i1', '123456'));
  });

  it('starts without suspension at level 1', () => {
    renderWithProviders(
      <SuspendSiteDialog
        incident={{ ...incident, escalationLevel: 1 }}
        open
        confirmFirst
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Suspend the site in the same step')).not.toBeChecked();
  });

  it('needs at least one measure to suspend', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SuspendSiteDialog
        incident={{ ...incident, status: 'CONFIRMED' }}
        open
        confirmFirst={false}
        onClose={vi.fn()}
      />,
    );
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    await typeCode(user);
    expect(screen.getByText('Choose at least one measure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend site' })).toBeDisabled();
  });

  it('words a refusal and clears the code', async () => {
    suspendMock.mockRejectedValue({
      response: { status: 409, data: { error: { code: 'ALREADY_SUSPENDED' } } },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <SuspendSiteDialog
        incident={{ ...incident, status: 'CONFIRMED' }}
        open
        confirmFirst={false}
        onClose={vi.fn()}
      />,
    );
    await typeCode(user);
    await user.click(screen.getByRole('button', { name: 'Suspend site' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('This incident already suspends the site.'),
    );
    expect(screen.getByLabelText('TOTP Code')).toHaveValue('');
  });
});
