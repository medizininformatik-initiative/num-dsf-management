/**
 * IncidentAdminPanel.test.tsx — which admin actions an incident offers: a
 * reported incident gets Confirm, level 2/3 the immediate suspension callout,
 * a suspended one Lift with Close and False alarm blocked, an incident without
 * a site no suspension, a closed one only the export. incidents.api is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Incident, IncidentDetail } from '../../../api/incidents.api';

vi.mock('../../../api/incidents.api', async (orig) => ({
  ...(await orig<typeof import('../../../api/incidents.api')>()),
  incidentsApi: {},
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IncidentAdminPanel } from '../IncidentAdminPanel';

const base: Incident = {
  id: 'i1',
  title: 'Leaked key',
  description: 'Found in a repo',
  status: 'CONFIRMED',
  escalationLevel: 1,
  organization: { identifier: 'ukm.de', name: 'Uniklinik Münster' },
  reportedBy: 'site@ukm.de',
  reportedByOrganization: null,
  reportedAt: '2026-11-09T10:00:00Z',
  detectedAt: '2026-11-09T09:00:00Z',
  confirmedBy: 'admin@imi.de',
  confirmedAt: '2026-11-09T10:30:00Z',
  closedBy: null,
  closedAt: null,
  suspended: false,
  zulipUrl: null,
  nis2: [],
  dpoInformed: null,
  canAcknowledge: true,
  isMine: false,
};
const detail = (patch: Partial<Incident>): IncidentDetail => ({
  incident: { ...base, ...patch },
  events: [],
  chain: { valid: true, brokenAt: null },
});
const actions = () => within(screen.getByTestId('incident-admin-actions'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IncidentAdminPanel', () => {
  it('offers Confirm for a reported incident and opens the dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentAdminPanel detail={detail({ status: 'REPORTED' })} />);
    await user.click(actions().getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByRole('heading', { name: 'Confirm the incident?' }),
    ).toBeInTheDocument();
  });

  it('offers the suspension right away at level 2', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentAdminPanel detail={detail({ escalationLevel: 2 })} />);
    expect(
      actions().getByText(
        'Escalation level 2: suspend the site now unless there is a reason not to.',
      ),
    ).toBeInTheDocument();
    await user.click(actions().getByRole('button', { name: 'Suspend site' }));
    expect(
      await screen.findByRole('heading', { name: 'Suspend Uniklinik Münster?' }),
    ).toBeInTheDocument();
  });

  it('offers Suspend without the callout at level 1', () => {
    renderWithProviders(<IncidentAdminPanel detail={detail({})} />);
    expect(actions().queryByRole('status')).not.toBeInTheDocument();
    expect(actions().getByRole('button', { name: 'Suspend site' })).toBeInTheDocument();
  });

  it('blocks closing while the site is suspended', () => {
    renderWithProviders(<IncidentAdminPanel detail={detail({ suspended: true })} />);
    expect(actions().getByRole('button', { name: 'Lift suspension' })).toBeInTheDocument();
    expect(actions().getByRole('button', { name: 'Close incident' })).toBeDisabled();
    expect(actions().getByRole('button', { name: 'False alarm' })).toBeDisabled();
    expect(actions().queryByRole('button', { name: 'Suspend site' })).not.toBeInTheDocument();
    expect(
      actions().getByText('Lift the suspension before closing the incident.'),
    ).toBeInTheDocument();
  });

  it('cannot suspend without a recorded site', () => {
    renderWithProviders(
      <IncidentAdminPanel detail={detail({ organization: null, escalationLevel: 3 })} />,
    );
    expect(actions().queryByRole('button', { name: 'Suspend site' })).not.toBeInTheDocument();
    expect(
      actions().getByText('No affected site is recorded, so no site can be suspended.'),
    ).toBeInTheDocument();
  });

  it('only exports a closed incident', () => {
    renderWithProviders(
      <IncidentAdminPanel
        detail={detail({ status: 'CLOSED', closedAt: '2026-11-10T08:00:00Z' })}
      />,
    );
    expect(actions().getAllByRole('button')).toHaveLength(2);
    expect(actions().getByRole('button', { name: 'Export JSON' })).toBeInTheDocument();
    expect(actions().getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Classification' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Comment or measure taken' }),
    ).not.toBeInTheDocument();
  });
});
