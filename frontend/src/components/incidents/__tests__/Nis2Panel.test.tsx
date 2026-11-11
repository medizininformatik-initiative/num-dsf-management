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

const { ackNis2, ackDpo, saveFields, requestInterim } = vi.hoisted(() => ({
  ackNis2: vi.fn(),
  ackDpo: vi.fn(),
  saveFields: vi.fn(),
  requestInterim: vi.fn(),
}));
vi.mock('../../../api/incidents.api', () => ({
  incidentsApi: {
    acknowledgeNis2: ackNis2,
    acknowledgeDpo: ackDpo,
    saveNis2Fields: saveFields,
    requestNis2Interim: requestInterim,
  },
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
  reportedByOrganization: null,
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
      provisional: false,
      reportedAt: '2026-11-09T20:00:00Z',
      reportedBy: 'site@ukm.de',
      fields: { suspectedMalicious: 'yes', crossBorder: 'no', affectedServices: 'BPE' },
    },
    {
      stage: 'NOTIFICATION',
      dueAt: '2026-11-12T10:00:00Z',
      provisional: false,
      reportedAt: null,
      reportedBy: null,
      fields: { severity: 'high', impact: 'BPE offline' },
    },
    {
      stage: 'INTERIM_REPORT',
      dueAt: null,
      provisional: false,
      reportedAt: null,
      reportedBy: null,
      requestedAt: null,
      requestedBy: null,
      fields: null,
    },
    {
      stage: 'FINAL_REPORT',
      dueAt: '2026-12-12T10:00:00Z',
      provisional: true,
      reportedAt: null,
      reportedBy: null,
      fields: {},
    },
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
  saveFields.mockResolvedValue({ data: { data: base } });
  requestInterim.mockResolvedValue({ data: { data: base } });
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

  it('says the portal is a filling aid and keeps the stages in the order of the law', () => {
    renderWithProviders(<Nis2Panel incident={base} />);
    expect(
      screen.getByText(
        'The portal does not report to the BSI itself; it serves as a filling aid and record.',
      ),
    ).toBeInTheDocument();
    const stages = Array.from(
      screen.getByTestId('nis2-panel').querySelectorAll('[data-stage]'),
    ).map((el) => el.getAttribute('data-stage'));
    expect(stages).toEqual(['EARLY_WARNING', 'NOTIFICATION', 'INTERIM_REPORT', 'FINAL_REPORT']);
  });

  it('marks a final report date that rests on the 72 h deadline as provisional', () => {
    const { rerender } = renderWithProviders(<Nis2Panel incident={base} />);
    expect(within(stageRow('FINAL_REPORT')).getByText('provisional')).toBeInTheDocument();
    const confirmed = {
      ...base,
      nis2: base.nis2.map((e) => (e.stage === 'FINAL_REPORT' ? { ...e, provisional: false } : e)),
    };
    rerender(<Nis2Panel incident={confirmed} />);
    expect(within(stageRow('FINAL_REPORT')).queryByText('provisional')).not.toBeInTheDocument();
  });

  it('shows a final report that waits for the closure without a countdown, with the progress report due', () => {
    const nis2 = [
      ...base.nis2.slice(0, 3),
      {
        stage: 'PROGRESS_REPORT' as const,
        dueAt: '2026-11-10T09:00:00Z',
        provisional: false,
        reportedAt: null,
        reportedBy: null,
        fields: {},
      },
      { ...base.nis2[3], dueAt: null, provisional: false },
    ];
    renderWithProviders(<Nis2Panel incident={{ ...base, nis2 }} />);
    expect(stageRow('PROGRESS_REPORT')).toHaveAttribute('data-state', 'overdue');
    expect(stageRow('PROGRESS_REPORT')).toHaveTextContent('The final report fell due while');
    expect(stageRow('FINAL_REPORT')).toHaveAttribute('data-state', 'pending');
    expect(stageRow('FINAL_REPORT')).toHaveTextContent(
      'Due one month after the incident is closed',
    );
    expect(stageRow('FINAL_REPORT')).not.toHaveTextContent('left');
  });

  it('offers the interim report only after the BSI request is recorded', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Nis2Panel incident={base} />);
    const row = stageRow('INTERIM_REPORT');
    expect(row).toHaveTextContent('Only when the BSI requests it');
    expect(within(row).getByText('Record the BSI request first.')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Mark .* as reported/ })).toBeDisabled();
    await user.click(within(row).getByRole('button', { name: 'Record request' }));
    await waitFor(() => expect(requestInterim).toHaveBeenCalledTimes(1));
    expect(requestInterim.mock.calls[0][0]).toBe('i1');
    expect(requestInterim.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('allows ticking the interim report once it was requested', () => {
    const nis2 = base.nis2.map((e) =>
      e.stage === 'INTERIM_REPORT' ? { ...e, requestedAt: '2026-11-10T08:00:00Z' } : e,
    );
    renderWithProviders(<Nis2Panel incident={{ ...base, nis2 }} />);
    const row = stageRow('INTERIM_REPORT');
    expect(row).toHaveTextContent('Requested by the BSI on');
    expect(within(row).getByRole('button', { name: /Mark .* as reported/ })).toBeEnabled();
  });

  it('blocks the tick of a stage whose details are incomplete', () => {
    renderWithProviders(<Nis2Panel incident={base} />);
    const final = stageRow('FINAL_REPORT');
    expect(
      within(final).getByText('Fill in all required details before marking it as reported.'),
    ).toBeInTheDocument();
    expect(within(final).getByRole('button', { name: /Mark .* as reported/ })).toBeDisabled();
    expect(
      within(stageRow('NOTIFICATION')).getByRole('button', { name: /Mark .* as reported/ }),
    ).toBeEnabled();
  });

  it('shows the details of a stage collapsed, with a check once complete, and saves them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Nis2Panel incident={base} />);
    const row = stageRow('NOTIFICATION');
    expect(within(row).queryByLabelText('Impact')).not.toBeInTheDocument();
    const toggle = within(row).getByRole('button', {
      name: 'Show or hide the details of Notification (72 h)',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Details complete');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const impact = within(row).getByLabelText(/Impact/);
    expect(impact).toHaveValue('BPE offline');
    await user.clear(impact);
    await user.type(impact, 'FHIR endpoint down');
    await user.click(within(row).getByRole('button', { name: 'Save details' }));
    await waitFor(() =>
      expect(saveFields).toHaveBeenCalledWith('i1', 'NOTIFICATION', {
        severity: 'high',
        impact: 'FHIR endpoint down',
        iocs: '',
      }),
    );
  });

  it('shows the details of an incomplete stage as missing', () => {
    renderWithProviders(<Nis2Panel incident={base} />);
    expect(
      within(stageRow('FINAL_REPORT')).getByRole('button', {
        name: 'Show or hide the details of Final report (1 month after notification)',
      }),
    ).toHaveTextContent('Details missing');
  });

  it('keeps the details of a reported stage read-only', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Nis2Panel incident={base} />);
    const row = stageRow('EARLY_WARNING');
    await user.click(
      within(row).getByRole('button', { name: /Show or hide the details of Early warning/ }),
    );
    expect(within(row).getByLabelText(/Affected services/)).toBeDisabled();
    expect(within(row).queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument();
    expect(within(row).getByText(/cannot be changed/)).toBeInTheDocument();
  });

  it('hides the details and the request form from callers who may not see them', () => {
    const nis2 = base.nis2.map((e) => ({ ...e, fields: null }));
    renderWithProviders(<Nis2Panel incident={{ ...base, nis2, canAcknowledge: false }} />);
    expect(
      screen.queryByRole('button', { name: /Show or hide the details/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record request' })).not.toBeInTheDocument();
  });

  it('shows the DPO tick without an actor hidden from the caller', () => {
    renderWithProviders(
      <Nis2Panel incident={{ ...base, dpoInformed: { at: '2026-11-10T08:00:00Z', by: null } }} />,
    );
    expect(screen.getByText(/^Informed /)).toBeInTheDocument();
    expect(screen.queryByText(/^Informed .* by /)).not.toBeInTheDocument();
  });
});
