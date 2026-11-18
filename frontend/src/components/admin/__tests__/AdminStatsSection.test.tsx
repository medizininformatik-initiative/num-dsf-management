/**
 * AdminStatsSection.test.tsx — overview tiles: numbers from the mocked
 * useAdminStats hook, loading skeleton, error line and the pending-tile scroll.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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

function tile(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

describe('AdminStatsSection', () => {
  beforeEach(() => useAdminStats.mockReset());

  it('renders the numbers of every group', () => {
    useAdminStats.mockReturnValue({ data: STATS, isLoading: false, error: null });
    renderWithProviders(<AdminStatsSection />);
    expect(within(tile('Sites in total')).getByText('56')).toBeInTheDocument();
    expect(within(tile('With login certificate')).getByText('41')).toBeInTheDocument();
    expect(within(tile('With login certificate')).getByText('of 56')).toBeInTheDocument();
    expect(within(tile('Logged in today')).getByText('7')).toBeInTheDocument();
    expect(within(tile('Pending')).getByText('4')).toBeInTheDocument();
    expect(within(tile('Withdrawn')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Current version')).getByText('12')).toBeInTheDocument();
    expect(within(tile('Never fetched')).getByText('9')).toBeInTheDocument();
    expect(within(tile('Open incidents')).getByText('2')).toBeInTheDocument();
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

  it('scrolls to the pending list when the pending tile is clicked', async () => {
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
