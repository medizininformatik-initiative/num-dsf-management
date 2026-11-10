/**
 * Nis2Panel.test.tsx — the NIS2 panel: reported, overdue and open stages with
 * their countdown text, ticks only for callers with canAcknowledge, a tick
 * sent after the confirmation, and the DPO record. incidents.api is mocked;
 * the clock is fixed with fake timers (Date only, so promises still run).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Incident } from '../../../api/incidents.api';

const { ackNis2, ackDpo } = vi.hoisted(() => ({ ackNis2: vi.fn(), ackDpo: vi.fn() }));
vi.mock('../../../api/incidents.api', () => ({
  incidentsApi: { acknowledgeNis2: ackNis2, acknowledgeDpo: ackDpo },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { Nis2Panel } from '../Nis2Panel';

const base: Incident = {
  id: 'i1',
  title: 'Leak',
  description: null,
  status: 'CONFIRMED',
  escalationLevel: 2,
  organization: { identifier: 'ukm.de', name: 'Uniklinik Münster' },
  reportedBy: null,
  reportedAt: '2026-11-09T10:00:00Z',
  detectedAt: '2026-11-09T10:00:00Z',
  confirmedBy: null,
  confirmedAt: '2026-11-09T11:00:00Z',
  closedBy: null,
  closedAt: null,
  suspended: false,
  zulipUrl: null,
  nis2: [
    {
      stage: 'EARLY_WARNING',
      dueAt: '2026-11-10T10:00:00Z',
      reportedAt: '2026-11-09T20:00:00Z',
      reportedBy: 'site@ukm.de',
    },
    { stage: 'NOTIFICATION', dueAt: '2026-11-12T10:00:00Z', reportedAt: null, reportedBy: null },
    { stage: 'FINAL_REPORT', dueAt: '2026-12-09T10:00:00Z', reportedAt: null, reportedBy: null },
  ],
  dpoInformed: null,
  canAcknowledge: true,
  isMine: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
  ackNis2.mockResolvedValue({ data: { data: base } });
  ackDpo.mockResolvedValue({ data: { data: base } });
});
afterEach(() => {
  vi.useRealTimers();
});

const stageRow = (stage: string) =>
  screen.getByTestId('nis2-panel').querySelector(`[data-stage="${stage}"]`) as HTMLElement;

describe('Nis2Panel', () => {
  it('shows reported, open and countdown states', () => {
    renderWithProviders(<Nis2Panel incident={base} />);
    expect(stageRow('EARLY_WARNING')).toHaveAttribute('data-state', 'reported');
    expect(stageRow('EARLY_WARNING')).toHaveTextContent('by site@ukm.de');
    expect(stageRow('NOTIFICATION')).toHaveTextContent('1 d 22 h left');
    expect(stageRow('FINAL_REPORT')).toHaveAttribute('data-state', 'open');
  });

  it('marks a missed deadline as overdue', () => {
    vi.setSystemTime(new Date('2026-11-12T13:30:00Z'));
    renderWithProviders(<Nis2Panel incident={base} />);
    expect(stageRow('NOTIFICATION')).toHaveAttribute('data-state', 'overdue');
    expect(stageRow('NOTIFICATION')).toHaveTextContent('Overdue by 3 h 30 min');
  });

  it('offers no ticks without canAcknowledge', () => {
    renderWithProviders(<Nis2Panel incident={{ ...base, canAcknowledge: false }} />);
    expect(screen.queryByRole('button', { name: /reported/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as informed' })).not.toBeInTheDocument();
  });

  it('ticks a stage after the confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Nis2Panel incident={base} />);
    await user.click(
      within(stageRow('NOTIFICATION')).getByRole('button', {
        name: 'Mark Notification (72 h) as reported to the BSI',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Record' }));
    await waitFor(() => expect(ackNis2).toHaveBeenCalledWith('i1', 'NOTIFICATION'));
  });

  it('records the DPO as informed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Nis2Panel incident={base} />);
    expect(screen.getByText('Not recorded as informed yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark as informed' }));
    await user.click(await screen.findByRole('button', { name: 'Record' }));
    await waitFor(() => expect(ackDpo).toHaveBeenCalledWith('i1'));
  });

  it('shows who recorded the DPO', () => {
    renderWithProviders(
      <Nis2Panel
        incident={{ ...base, dpoInformed: { at: '2026-11-10T08:00:00Z', by: 'dpo@ukm.de' } }}
      />,
    );
    expect(screen.getByText(/by dpo@ukm\.de/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as informed' })).not.toBeInTheDocument();
  });
});
