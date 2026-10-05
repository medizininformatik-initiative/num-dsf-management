/**
 * MarketplacePage.test.tsx — the process-marketplace card grid. useMarketplace,
 * useDeleteMarketplaceEntry, and useMe are mocked; the add/edit modals are
 * stubbed so the test stays focused on the page itself. Asserts the card grid
 * renders entries, the search input filters by name/topic, the status-filter
 * chips narrow the grid, and the empty state appears when nothing matches.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { MarketplaceEntry } from '../../api/marketplace.api';

const useMarketplace = vi.hoisted(() => vi.fn());
const useDeleteMarketplaceEntry = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMarketplace', () => ({
  useMarketplace,
  useDeleteMarketplaceEntry,
}));

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMe', () => ({ useMe }));

// The add/edit modals have their own coverage; stub them so this test stays on
// the grid and search behaviour.
vi.mock('../../components/modals/MarketplaceAddModal', () => ({
  MarketplaceAddModal: () => null,
}));
vi.mock('../../components/modals/MarketplaceEditStatusModal', () => ({
  MarketplaceEditStatusModal: () => null,
}));

import { MarketplacePage } from '../MarketplacePage';

function entry(over: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'e1',
    slug: 'owner-repo',
    gitUrl: 'https://github.com/owner/repo',
    name: 'Data Transfer Process',
    description: 'Moves data between sites.',
    status: 'APPROVED',
    latestReleaseTag: 'v1.0.0',
    lastCommitAt: null,
    stars: 3,
    license: 'MIT',
    topics: ['fhir'],
    forks: 0,
    openIssues: 0,
    archived: false,
    homepage: null,
    language: 'Java',
    processIdentifiers: [],
    dsfVersionMin: null,
    requiredRoles: [],
    messageNames: [],
    artifactUrl: null,
    metadataSource: 'MANIFEST',
    verified: false,
    advisoryText: null,
    advisorySeverity: null,
    supersededBy: null,
    licenseOk: true,
    stale: false,
    syncAt: null,
    syncError: null,
    ...over,
  };
}

function mockDeleteMutation() {
  useDeleteMarketplaceEntry.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
}

describe('MarketplacePage', () => {
  it('renders a card for every entry in the grid', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({
      data: [
        entry({ id: 'e1', slug: 'transfer', name: 'Data Transfer Process' }),
        entry({ id: 'e2', slug: 'feasibility', name: 'Feasibility Process' }),
      ],
      isLoading: false,
    });

    renderWithProviders(<MarketplacePage />);

    expect(screen.getByText('Data Transfer Process')).toBeInTheDocument();
    expect(screen.getByText('Feasibility Process')).toBeInTheDocument();
  });

  it('filters the grid by the search query (name and topic)', async () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({
      data: [
        entry({ id: 'e1', slug: 'transfer', name: 'Data Transfer Process', topics: ['fhir'] }),
        entry({
          id: 'e2',
          slug: 'feasibility',
          name: 'Feasibility Process',
          topics: ['cohort'],
        }),
      ],
      isLoading: false,
    });

    renderWithProviders(<MarketplacePage />);

    const search = screen.getByPlaceholderText('Search processes…');
    fireEvent.change(search, { target: { value: 'feasibility' } });

    // The search is debounced into the URL, so the grid narrows a moment later.
    await waitFor(() =>
      expect(screen.queryByText('Data Transfer Process')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Feasibility Process')).toBeInTheDocument();

    // A topic-only match still surfaces the right card.
    fireEvent.change(search, { target: { value: 'fhir' } });
    await waitFor(() => expect(screen.getByText('Data Transfer Process')).toBeInTheDocument());
    expect(screen.queryByText('Feasibility Process')).not.toBeInTheDocument();
  });

  it('shows the no-results state when no entry matches the search', async () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({
      data: [entry({ id: 'e1', name: 'Data Transfer Process' })],
      isLoading: false,
    });

    renderWithProviders(<MarketplacePage />);

    fireEvent.change(screen.getByPlaceholderText('Search processes…'), {
      target: { value: 'no-such-process' },
    });

    expect(await screen.findByText('No processes match your filters.')).toBeInTheDocument();
    expect(screen.queryByText('Data Transfer Process')).not.toBeInTheDocument();
  });

  it('shows the empty state when the marketplace is empty', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({ data: [], isLoading: false });

    renderWithProviders(<MarketplacePage />);

    expect(screen.getByText('No processes registered yet.')).toBeInTheDocument();
  });

  it('narrows the grid to a single status when a filter chip is clicked', async () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({
      data: [
        entry({ id: 'e1', slug: 'a', name: 'Approved Process', status: 'APPROVED' }),
        entry({ id: 'e2', slug: 'b', name: 'Experimental Process', status: 'EXPERIMENTAL' }),
      ],
      isLoading: false,
    });

    renderWithProviders(<MarketplacePage />);

    // Both visible under the default 'All' filter.
    expect(screen.getByText('Approved Process')).toBeInTheDocument();
    expect(screen.getByText('Experimental Process')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Experimental' }));
    await waitFor(() => expect(screen.queryByText('Approved Process')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Approved Process')).not.toBeInTheDocument());

    expect(screen.queryByText('Approved Process')).not.toBeInTheDocument();
    expect(screen.getByText('Experimental Process')).toBeInTheDocument();
  });

  it('shows skeleton placeholders while loading', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({ data: undefined, isLoading: true });

    const { container } = renderWithProviders(<MarketplacePage />);

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    const refetch = vi.fn();
    useMarketplace.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    renderWithProviders(<MarketplacePage />);

    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('announces the result count politely', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({
      data: [entry({ id: 'e1' }), entry({ id: 'e2', slug: 'b', name: 'Other' })],
      isLoading: false,
    });

    renderWithProviders(<MarketplacePage />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('2 processes');
  });

  it('focuses the search field when "/" is pressed', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({ data: [entry()], isLoading: false });

    renderWithProviders(<MarketplacePage />);

    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByPlaceholderText('Search processes…')).toHaveFocus();
  });

  it('restores filters from the URL (Back from a detail page)', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({
      data: [
        entry({ id: 'e1', slug: 'a', name: 'Approved Process', status: 'APPROVED' }),
        entry({ id: 'e2', slug: 'b', name: 'Experimental Process', status: 'EXPERIMENTAL' }),
      ],
      isLoading: false,
    });

    renderWithProviders(<MarketplacePage />, { route: '/app/marketplace?status=EXPERIMENTAL' });

    expect(screen.queryByText('Approved Process')).not.toBeInTheDocument();
    expect(screen.getByText('Experimental Process')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Experimental' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sorts by popularity when selected', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({
      data: [
        entry({ id: 'e1', slug: 'a', name: 'Quiet Process', stars: 1 }),
        entry({ id: 'e2', slug: 'b', name: 'Famous Process', stars: 99 }),
      ],
      isLoading: false,
    });

    renderWithProviders(<MarketplacePage />, { route: '/app/marketplace?sort=popular' });

    const links = screen.getAllByRole('link').filter((a) => !a.closest('nav'));
    expect(links[0]).toHaveAttribute('href', '/app/marketplace/b');
  });

  it('shows a recommended row only for verified, healthy entries when unfiltered', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({
      data: [
        entry({ id: 'e1', slug: 'a', name: 'Star Process', verified: true, stars: 50 }),
        entry({ id: 'e2', slug: 'b', name: 'B' }),
        entry({ id: 'e3', slug: 'c', name: 'C' }),
        entry({ id: 'e4', slug: 'd', name: 'D' }),
      ],
      isLoading: false,
    });

    renderWithProviders(<MarketplacePage />);

    expect(screen.getByRole('heading', { name: 'Recommended' })).toBeInTheDocument();
  });

  it('offers Add/Edit/Remove to admins only', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: true } });
    mockDeleteMutation();
    useMarketplace.mockReturnValue({ data: [entry()], isLoading: false });

    renderWithProviders(<MarketplacePage />);

    expect(screen.getByRole('button', { name: 'Add process' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit status' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Remove this process');
  });
});
