/**
 * ArchiveIncidentDialog.test.tsx — archiving sends the step-up code and
 * words a NOT_ARCHIVABLE refusal. incidents.api is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Incident } from '../../../api/incidents.api';

const { archiveMock, toastError, toastSuccess } = vi.hoisted(() => ({
  archiveMock: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('../../../api/incidents.api', () => ({ incidentsApi: { archive: archiveMock } }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ArchiveIncidentDialog } from '../ArchiveIncidentDialog';

const incident = { id: 'i1', title: 'Pen test' } as Incident;

beforeEach(() => {
  vi.clearAllMocks();
  archiveMock.mockResolvedValue({ data: { data: incident } });
});

describe('ArchiveIncidentDialog', () => {
  it('archives with the step-up code', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<ArchiveIncidentDialog incident={incident} open onClose={onClose} />);
    await user.type(screen.getByLabelText('TOTP Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archiveMock).toHaveBeenCalledWith('i1', '123456'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Incident archived.');
  });

  it('words a refusal', async () => {
    archiveMock.mockRejectedValue({
      response: { status: 409, data: { error: { code: 'NOT_ARCHIVABLE' } } },
    });
    const user = userEvent.setup();
    renderWithProviders(<ArchiveIncidentDialog incident={incident} open onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('TOTP Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Only a closed incident or false alarm without an active suspension can be archived.',
      ),
    );
  });
});
