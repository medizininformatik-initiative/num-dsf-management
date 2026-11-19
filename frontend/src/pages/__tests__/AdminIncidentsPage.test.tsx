/**
 * AdminIncidentsPage.test.tsx — the admin incident register: ?id= (the admin
 * mail link) opens the incident with its description and the admin actions,
 * "New incident" opens the report dialog, and a non-admin is sent to
 * /app/incidents with the same ?id=. incidents.api and useMe are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { Incident, IncidentDetail } from '../../api/incidents.api';

const { listMock, getMock, me } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
  me: { current: { email: 'admin@imi.de', isAdmin: true } },
}));
vi.mock('../../api/incidents.api', async (orig) => ({
  ...(await orig<typeof import('../../api/incidents.api')>()),
  incidentsApi: {
    list: listMock,
    get: getMock,
    organizations: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
}));
vi.mock('../../hooks/useMe', () => ({ useMe: () => ({ data: me.current }) }));
vi.mock('../../stores/auth.store', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: true }),
}));

import { AdminIncidentsPage } from '../AdminIncidentsPage';

const incident: Incident = {
  id: 'i1',
  title: 'Phishing wave',
  description: 'Mails with a fake DSF login page',
  status: 'REPORTED',
  escalationLevel: 1,
  organization: { identifier: 'ukm.de', name: 'Uniklinik Münster' },
  reportedBy: 'site@ukm.de',
  reportedByOrganization: null,
  reportedAt: '2026-11-10T08:00:00Z',
  detectedAt: '2026-11-10T07:30:00Z',
  confirmedBy: null,
  confirmedAt: null,
  closedBy: null,
  closedAt: null,
  suspended: false,
  zulipUrl: null,
  nis2: [],
  dpoInformed: null,
  canAcknowledge: true,
  isMine: false,
};
const detail: IncidentDetail = { incident, events: [], chain: { valid: true, brokenAt: null } };

function renderAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/app/admin/incidents" element={<AdminIncidentsPage />} />
      <Route path="/app/incidents" element={<p>user incidents page</p>} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  me.current = { email: 'admin@imi.de', isAdmin: true };
  listMock.mockResolvedValue({ data: { data: [incident] } });
  getMock.mockResolvedValue({ data: { data: detail } });
});

describe('AdminIncidentsPage', () => {
  it('opens the mailed incident with its description and the actions', async () => {
    renderAt('/app/admin/incidents?id=i1');
    const article = await screen.findByTestId('incident-detail');
    expect(within(article).getByText('Mails with a fake DSF login page')).toBeInTheDocument();
    expect(within(article).getByText(/by site@ukm\.de/)).toBeInTheDocument();
    const actions = within(screen.getByTestId('incident-admin-actions'));
    expect(actions.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Classification' })).toBeInTheDocument();
  });

  it('records a new incident through the report dialog', async () => {
    const user = userEvent.setup();
    renderAt('/app/admin/incidents');
    await user.click(screen.getByRole('button', { name: 'New incident' }));
    expect(
      await screen.findByRole('heading', { name: 'Report a security incident' }),
    ).toBeInTheDocument();
  });

  it('lists archived incidents only after the toggle', async () => {
    const user = userEvent.setup();
    renderAt('/app/admin/incidents');
    await screen.findByText('Phishing wave');
    expect(listMock).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(true));
  });

  it('sends a non-admin to the user page with the same incident', async () => {
    me.current = { email: 'site@ukm.de', isAdmin: false };
    renderAt('/app/admin/incidents?id=i1');
    expect(await screen.findByText('user incidents page')).toBeInTheDocument();
  });
});
