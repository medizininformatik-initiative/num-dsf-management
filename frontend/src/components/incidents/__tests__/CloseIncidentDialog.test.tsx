/**
 * CloseIncidentDialog.test.tsx — closing needs the review note, a false alarm
 * the reason; both send the outcome with the trimmed note and the code, and a
 * STILL_SUSPENDED refusal is worded. incidents.api is mocked; the session is
 * an OTP session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Incident } from '../../../api/incidents.api';

const { closeMock, toastError } = vi.hoisted(() => ({ closeMock: vi.fn(), toastError: vi.fn() }));
vi.mock('../../../api/incidents.api', () => ({ incidentsApi: { close: closeMock } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { CloseIncidentDialog } from '../CloseIncidentDialog';

const incident = { id: 'i1', title: 'Leaked key' } as Incident;

beforeEach(() => {
  vi.clearAllMocks();
  closeMock.mockResolvedValue({ data: { data: incident } });
});

describe('CloseIncidentDialog', () => {
  it('closes with the post-incident review', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CloseIncidentDialog incident={incident} outcome="CLOSED" open onClose={vi.fn()} />,
    );
    const close = screen.getByRole('button', { name: 'Close incident' });
    await user.type(screen.getByLabelText('TOTP Code'), '123456');
    expect(close).toBeDisabled();
    await user.type(screen.getByLabelText(/Post-incident review/), ' Rotate keys yearly ');
    await user.click(close);
    await waitFor(() =>
      expect(closeMock).toHaveBeenCalledWith(
        'i1',
        { outcome: 'CLOSED', note: 'Rotate keys yearly' },
        '123456',
      ),
    );
  });

  it('marks a false alarm with its reason', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CloseIncidentDialog incident={incident} outcome="FALSE_ALARM" open onClose={vi.fn()} />,
    );
    await user.type(screen.getByLabelText(/Reason/), 'Pen test by the site');
    await user.type(screen.getByLabelText('TOTP Code'), '654321');
    await user.click(screen.getByRole('button', { name: 'False alarm' }));
    await waitFor(() =>
      expect(closeMock).toHaveBeenCalledWith(
        'i1',
        { outcome: 'FALSE_ALARM', note: 'Pen test by the site' },
        '654321',
      ),
    );
  });

  it('asks to lift the suspension first', async () => {
    closeMock.mockRejectedValue({
      response: { status: 409, data: { error: { code: 'STILL_SUSPENDED' } } },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <CloseIncidentDialog incident={incident} outcome="CLOSED" open onClose={vi.fn()} />,
    );
    await user.type(screen.getByLabelText(/Post-incident review/), 'Done');
    await user.type(screen.getByLabelText('TOTP Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Close incident' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Lift the suspension before closing the incident.'),
    );
  });
});
