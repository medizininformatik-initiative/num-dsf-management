/**
 * IncidentBanner.test.tsx — the red banner: hidden without a confirmed open
 * incident, naming the one incident with a direct link, counting several, and
 * pointing admins to the admin page. useIncidents' list call and useMe are
 * mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { Incident } from '../../../api/incidents.api';

const { listMock, me } = vi.hoisted(() => ({
  listMock: vi.fn(),
  me: { current: { email: 'site@ukm.de', isAdmin: false } },
}));
vi.mock('../../../api/incidents.api', () => ({ incidentsApi: { list: listMock } }));
vi.mock('../../../hooks/useMe', () => ({ useMe: () => ({ data: me.current }) }));
vi.mock('../../../stores/auth.store', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: true }),
}));

import { IncidentBanner } from '../IncidentBanner';

const incident = (id: string, status: Incident['status']): Incident =>
  ({
    id,
    status,
    title: `Incident ${id}`,
    organization: { identifier: 'ukm.de', name: 'Uniklinik Münster' },
    confirmedAt: status === 'REPORTED' ? null : '2026-11-10T09:00:00Z',
  }) as Incident;

beforeEach(() => {
  vi.clearAllMocks();
  me.current = { email: 'site@ukm.de', isAdmin: false };
});

describe('IncidentBanner', () => {
  it('stays away without a confirmed open incident', async () => {
    listMock.mockResolvedValue({
      data: { data: [incident('a', 'REPORTED'), incident('b', 'CLOSED')] },
    });
    renderWithProviders(<IncidentBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('incident-banner')).not.toBeInTheDocument();
  });

  it('names a single incident and links straight to it', async () => {
    listMock.mockResolvedValue({ data: { data: [incident('a', 'CONFIRMED')] } });
    renderWithProviders(<IncidentBanner />);
    const banner = await screen.findByRole('alert', { name: 'Security incident in the network' });
    expect(banner).toHaveTextContent('Incident a · Uniklinik Münster · confirmed');
    expect(screen.getByRole('link', { name: 'View incidents' })).toHaveAttribute(
      'href',
      '/app/incidents?id=a',
    );
  });

  it('counts several incidents and sends admins to the admin page', async () => {
    me.current = { email: 'admin@imi.de', isAdmin: true };
    listMock.mockResolvedValue({
      data: { data: [incident('a', 'CONFIRMED'), incident('b', 'CONFIRMED')] },
    });
    renderWithProviders(<IncidentBanner />);
    expect(await screen.findByText('2 confirmed incidents are open.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View incidents' })).toHaveAttribute(
      'href',
      '/app/admin/incidents',
    );
  });
});
