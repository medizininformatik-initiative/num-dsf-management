/**
 * ReportIncidentDialog.test.tsx — the report form: the site list with
 * "unknown", the own site preselected for site users, validation before any
 * request, the request body (null site, numeric level, ISO detection time,
 * DPO flag) and the rate-limit message. incidents.api, useMe and
 * useOrganization are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const { reportMock, toastError, me } = vi.hoisted(() => ({
  reportMock: vi.fn(),
  toastError: vi.fn(),
  me: { current: { email: 'site@ukm.de', isAdmin: false } },
}));

vi.mock('../../../api/incidents.api', () => ({
  incidentsApi: {
    organizations: vi.fn().mockResolvedValue({
      data: {
        data: [
          { identifier: 'ukm.de', name: 'Uniklinik Münster' },
          { identifier: 'uk-essen.de', name: 'Uniklinik Essen' },
        ],
      },
    }),
    report: reportMock,
  },
}));
vi.mock('../../../hooks/useMe', () => ({ useMe: () => ({ data: me.current }) }));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: (instanceId: string | null) => ({
    data: instanceId ? { identifier: 'ukm.de' } : undefined,
  }),
}));
vi.mock('../../../stores/canvas.store', () => ({
  useCanvasStore: (sel: (s: { activeInstanceId: string }) => unknown) =>
    sel({ activeInstanceId: 'inst-1' }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { ReportIncidentDialog } from '../ReportIncidentDialog';

beforeEach(() => {
  vi.clearAllMocks();
  me.current = { email: 'site@ukm.de', isAdmin: false };
  reportMock.mockResolvedValue({ data: { data: { id: 'i1' } } });
});

describe('ReportIncidentDialog', () => {
  it('preselects the own site for a site user', async () => {
    renderWithProviders(<ReportIncidentDialog open onClose={vi.fn()} />);
    const select = screen.getByTestId('incident-site-select') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('ukm.de'));
    expect(screen.getByRole('option', { name: 'Unknown' })).toBeInTheDocument();
  });

  it('validates before sending anything', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportIncidentDialog open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Report incident' }));
    expect(await screen.findByText('At least 3 characters')).toBeInTheDocument();
    expect(screen.getByText('Describe what happened')).toBeInTheDocument();
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('sends the report and closes', async () => {
    me.current = { email: 'admin@imi.de', isAdmin: true };
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ReportIncidentDialog open onClose={onClose} />);

    await user.type(screen.getByLabelText(/Short title/), 'Leaked client key');
    await user.type(screen.getByLabelText(/Description/), 'Key found in a public repo');
    await user.selectOptions(screen.getByLabelText(/Escalation level/), '3');
    await user.click(screen.getByLabelText(/data protection officer/));
    await user.click(screen.getByRole('button', { name: 'Report incident' }));

    await waitFor(() => expect(reportMock).toHaveBeenCalledTimes(1));
    const body = reportMock.mock.calls[0][0];
    expect(body).toMatchObject({
      organizationId: null,
      title: 'Leaked client key',
      description: 'Key found in a public repo',
      escalationLevel: 3,
      dpoInformed: true,
    });
    expect(body.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('explains a rate limit', async () => {
    reportMock.mockRejectedValue({
      response: { status: 429, data: { error: { code: 'RATE_LIMITED', message: 'x' } } },
    });
    const user = userEvent.setup();
    renderWithProviders(<ReportIncidentDialog open onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Short title/), 'Phishing');
    await user.type(screen.getByLabelText(/Description/), 'Mail to staff');
    await user.click(screen.getByRole('button', { name: 'Report incident' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Too many reports in a short time. Try again later or call the admins.',
      ),
    );
  });
});
