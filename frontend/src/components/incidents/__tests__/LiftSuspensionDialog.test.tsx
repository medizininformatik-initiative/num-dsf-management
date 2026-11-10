/**
 * LiftSuspensionDialog.test.tsx — lifting needs all three checklist ticks, a
 * note and the code; the request sends the literal true flags and the trimmed
 * note. incidents.api is mocked; the session is an OTP session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Incident } from '../../../api/incidents.api';

const { liftMock } = vi.hoisted(() => ({ liftMock: vi.fn() }));
vi.mock('../../../api/incidents.api', () => ({ incidentsApi: { liftSuspension: liftMock } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LiftSuspensionDialog } from '../LiftSuspensionDialog';

const incident = {
  id: 'i1',
  title: 'Leaked key',
  organization: { identifier: 'ukm.de', name: 'Uniklinik Münster' },
} as Incident;

beforeEach(() => {
  vi.clearAllMocks();
  liftMock.mockResolvedValue({ data: { data: incident } });
});

describe('LiftSuspensionDialog', () => {
  it('needs the whole checklist and a note', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<LiftSuspensionDialog incident={incident} open onClose={onClose} />);
    expect(
      screen.getByRole('heading', { name: 'Lift the suspension of Uniklinik Münster?' }),
    ).toBeInTheDocument();
    const lift = screen.getByRole('button', { name: 'Lift suspension' });

    await user.type(screen.getByLabelText('TOTP Code'), '123456');
    await user.click(screen.getByLabelText('The cause is fixed'));
    await user.click(screen.getByLabelText('The fix is proven by tests'));
    await user.type(screen.getByLabelText(/Note/), '  New server, new key  ');
    expect(lift).toBeDisabled();

    await user.click(screen.getByLabelText('The DSF Technikgremium has released the site'));
    expect(lift).toBeEnabled();
    await user.click(lift);

    await waitFor(() =>
      expect(liftMock).toHaveBeenCalledWith(
        'i1',
        {
          causeFixed: true,
          fixTested: true,
          releasedByTechBoard: true,
          note: 'New server, new key',
        },
        '123456',
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
