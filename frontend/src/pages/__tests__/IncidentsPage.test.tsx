/**
 * IncidentsPage.test.tsx — the incidents page for every signed-in user: the
 * list with status and site, ?id= opening the incident (as the mail links
 * do), no description section when the API withholds it, selecting from the
 * list, and the not-found notice. incidents.api is mocked; no admin actions
 * are rendered here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { Incident, IncidentDetail } from '../../api/incidents.api';

const { listMock, getMock } = vi.hoisted(() => ({ listMock: vi.fn(), getMock: vi.fn() }));
vi.mock('../../api/incidents.api', () => ({ incidentsApi: { list: listMock, get: getMock } }));
vi.mock('../../stores/auth.store', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: true }),
}));

import { IncidentsPage } from '../IncidentsPage';

const incident: Incident = {
  id: 'i1',
  title: 'Compromised DSF FHIR server',
  description: null,
  status: 'CONFIRMED',
  escalationLevel: 3,
  organization: { identifier: 'ukm.de', name: 'Uniklinik Münster' },
  reportedBy: null,
  reportedByOrganization: null,
  reportedAt: '2026-11-09T10:00:00Z',
  detectedAt: '2026-11-09T09:00:00Z',
  confirmedBy: 'admin@imi.de',
  confirmedAt: '2026-11-09T10:30:00Z',
  closedBy: null,
  closedAt: null,
  suspended: true,
  zulipUrl: null,
  nis2: [
    { stage: 'EARLY_WARNING', dueAt: '2026-11-10T09:00:00Z', reportedAt: null, reportedBy: null },
    { stage: 'NOTIFICATION', dueAt: '2026-11-12T09:00:00Z', reportedAt: null, reportedBy: null },
    { stage: 'FINAL_REPORT', dueAt: '2026-12-09T09:00:00Z', reportedAt: null, reportedBy: null },
  ],
  dpoInformed: null,
  canAcknowledge: false,
  isMine: false,
};

const detail: IncidentDetail = {
  incident,
  events: [
    {
      id: 'e1',
      seq: 1,
      at: '2026-11-09T10:00:00Z',
      actorEmail: null,
      type: 'REPORTED',
      details: { escalationLevel: 3 },
      prevHash: '0',
      hash: 'a',
    },
  ],
  chain: { valid: true, brokenAt: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue({ data: { data: [incident] } });
  getMock.mockResolvedValue({ data: { data: detail } });
});

describe('IncidentsPage', () => {
  it('lists the visible incidents', async () => {
    renderWithProviders(<IncidentsPage />, { route: '/app/incidents' });
    const list = await screen.findByTestId('incident-list');
    expect(within(list).getByText('Compromised DSF FHIR server')).toBeInTheDocument();
    expect(within(list).getByText('Confirmed')).toBeInTheDocument();
    expect(within(list).getByText('Site suspended')).toBeInTheDocument();
    expect(within(list).getByText('Uniklinik Münster')).toBeInTheDocument();
    expect(
      screen.getByText('Select an incident to see its details and timeline.'),
    ).toBeInTheDocument();
  });

  it('opens the incident from ?id= without a withheld description', async () => {
    renderWithProviders(<IncidentsPage />, { route: '/app/incidents?id=i1' });
    const article = await screen.findByTestId('incident-detail');
    expect(getMock).toHaveBeenCalledWith('i1');
    expect(within(article).queryByText('Description')).not.toBeInTheDocument();
    expect(within(article).getByText('Hash chain verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('opens an incident picked from the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentsPage />, { route: '/app/incidents' });
    await user.click(await screen.findByRole('button', { name: /Compromised DSF FHIR server/ }));
    expect(await screen.findByTestId('incident-detail')).toBeInTheDocument();
  });

  it('explains an incident that cannot be shown', async () => {
    getMock.mockRejectedValue({
      response: { status: 404, data: { error: { code: 'INCIDENT_NOT_FOUND' } } },
    });
    renderWithProviders(<IncidentsPage />, { route: '/app/incidents?id=gone' });
    expect(
      await screen.findByText('This incident does not exist or is not visible to you.'),
    ).toBeInTheDocument();
  });
});
