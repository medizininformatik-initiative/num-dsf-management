/**
 * AdminStatsSection.test.tsx — overview charts: numbers from the mocked
 * useAdminStats hook, loading skeleton, error line and the pending legend scroll.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { AdminStats } from '../../../api/admin.api';

const useAdminStats = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useAdmin', () => ({ useAdminStats }));

import { AdminStatsSection } from '../AdminStatsSection';

const STATS: AdminStats = {
  sites: {
    total: 56,
    active: 54,
    withLoginCertificate: 41,
    everLoggedIn: 33,
    loggedInLast24h: 7,
    published: 29,
  },
  requests: { pending: 4, approved: 29, rejected: 3, withdrawn: 2, draft: 5, approvedLast24h: 1 },
  allowList: {
    currentVersion: 12,
    currentPublishedAt: '2026-11-17T10:00:00Z',
    sitesUpToDate: 20,
    sitesNeverFetched: 9,
  },
  incidents: { open: 2 },
};

describe('AdminStatsSection', () => {
  beforeEach(() => useAdminStats.mockReset());

  it('renders the numbers of every group', () => {
    useAdminStats.mockReturnValue({ data: STATS, isLoading: false, error: null });
    renderWithProviders(<AdminStatsSection />);
    expect(screen.getByRole('img', { name: 'Sites in total: 56 (100%)' })).toBeInTheDocument();
    expect(screen.getByText('Logged in today: 7')).toBeInTheDocument();
    expect(screen.getByText('Pending').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Withdrawn').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Approved today: 1')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Never fetched: 9')).toBeInTheDocument();
    expect(screen.getByText('Open incidents').previousElementSibling).toHaveTextContent('2');
    expect(screen.getByRole('img', { name: 'Up to date: 20 of 56' })).toBeInTheDocument();
  });

  it('shows the share of each funnel row', () => {
    useAdminStats.mockReturnValue({ data: STATS, isLoading: false, error: null });
    renderWithProviders(<AdminStatsSection />);
    expect(
      screen.getByRole('img', { name: 'With login certificate: 41 (73%)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Have logged in: 33 (59%)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Published: 29 (52%)' })).toBeInTheDocument();
  });

  it('summarises the request bar for screen readers', () => {
    useAdminStats.mockReturnValue({ data: STATS, isLoading: false, error: null });
    renderWithProviders(<AdminStatsSection />);
    expect(
      screen.getByRole('img', {
        name: 'Pending: 4, Approved: 29, Rejected: 3, Withdrawn: 2',
      }),
    ).toBeInTheDocument();
  });

  it('shows a placeholder when no version exists yet', () => {
    useAdminStats.mockReturnValue({
      data: {
        ...STATS,
        allowList: { ...STATS.allowList, currentVersion: null, currentPublishedAt: null },
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AdminStatsSection />);
    expect(screen.getByText('No version yet')).toBeInTheDocument();
  });

  it('shows a loading skeleton', () => {
    useAdminStats.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderWithProviders(<AdminStatsSection />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Sites in total')).not.toBeInTheDocument();
  });

  it('shows an error line', () => {
    useAdminStats.mockReturnValue({ data: undefined, isLoading: false, error: new Error('x') });
    renderWithProviders(<AdminStatsSection />);
    expect(screen.getByRole('alert')).toHaveTextContent('The overview could not be loaded.');
  });

  it('scrolls to the pending list when the pending legend item is clicked', async () => {
    useAdminStats.mockReturnValue({ data: STATS, isLoading: false, error: null });
    const target = document.createElement('div');
    target.id = 'pending-target';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    renderWithProviders(<AdminStatsSection pendingTargetId="pending-target" />);
    await userEvent.click(screen.getByRole('button', { name: /Pending/ }));
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });
});
