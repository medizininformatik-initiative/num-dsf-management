/**
 * MarketplaceDetailPage.test.tsx — the per-process detail page. useParams is
 * stubbed to a fixed slug; useMarketplaceEntry + useMe are mocked. Asserts the
 * header, the DSF-metadata panel, the lifecycle/trust panel, and the not-found
 * state when the entry is null.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { MarketplaceDetail } from '../../api/marketplace.api';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ slug: 'owner-repo' }) };
});

const useMarketplaceEntry = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMarketplace', () => ({ useMarketplaceEntry }));

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMe', () => ({ useMe }));

// The modal has its own coverage; stub it so this test stays focused on the page.
vi.mock('../../components/modals/MarketplaceEditStatusModal', () => ({
  MarketplaceEditStatusModal: () => null,
}));

import { MarketplaceDetailPage } from '../MarketplaceDetailPage';

function detail(over: Partial<MarketplaceDetail> = {}): MarketplaceDetail {
  return {
    id: 'e1',
    slug: 'owner-repo',
    gitUrl: 'https://github.com/owner/repo',
    name: 'Data Transfer Process',
    description: 'Moves data between sites.',
    status: 'APPROVED',
    latestReleaseTag: 'v1.2.0',
    lastCommitAt: '2026-05-01T00:00:00Z',
    stars: 7,
    license: 'MIT',
    topics: ['fhir'],
    forks: 1,
    openIssues: 0,
    archived: false,
    homepage: 'https://docs.example.org',
    language: 'Java',
    processIdentifiers: ['dsf.dataTransfer'],
    dsfVersionMin: '1.5',
    requiredRoles: ['DIC', 'HRP'],
    messageNames: ['startDataTransfer'],
    artifactUrl: 'https://github.com/owner/repo/releases/download/v1/p.jar',
    metadataSource: 'MANIFEST',
    verified: true,
    advisoryText: null,
    advisorySeverity: null,
    supersededBy: null,
    licenseOk: true,
    stale: false,
    syncAt: null,
    syncError: null,
    releases: [
      { tag: 'v1.2.0', publishedAt: '2026-05-01T00:00:00Z' },
      { tag: 'v1.1.0', publishedAt: '2026-03-01T00:00:00Z' },
    ],
    ...over,
  };
}

describe('MarketplaceDetailPage', () => {
  it('renders the header, compatibility and releases tabs', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    useMarketplaceEntry.mockReturnValue({ data: detail(), isLoading: false });

    renderWithProviders(<MarketplaceDetailPage />);

    expect(screen.getByRole('heading', { name: 'Data Transfer Process' })).toBeInTheDocument();
    // DSF-metadata panel
    fireEvent.click(screen.getByRole('tab', { name: 'Compatibility' }));
    expect(screen.getByText('dsf.dataTransfer')).toBeInTheDocument();
    expect(screen.getByText('startDataTransfer')).toBeInTheDocument();
    expect(screen.getByText('DIC')).toBeInTheDocument();
    expect(screen.getByText('MANIFEST')).toBeInTheDocument();
    // Releases timeline
    fireEvent.click(screen.getByRole('tab', { name: 'Releases' }));
    expect(screen.getAllByText('v1.2.0').length).toBeGreaterThan(0);
    expect(screen.getByText('v1.1.0')).toBeInTheDocument();
    expect(screen.getByText('Latest')).toBeInTheDocument();
  });

  it('shows an advisory banner when a severity is present', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    useMarketplaceEntry.mockReturnValue({
      data: detail({ advisorySeverity: 'WARNING', advisoryText: 'Upgrade soon.' }),
      isLoading: false,
    });

    renderWithProviders(<MarketplaceDetailPage />);
    expect(screen.getByText('Upgrade soon.')).toBeInTheDocument();
  });

  it('shows the Edit-metadata button only for admins', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: true } });
    useMarketplaceEntry.mockReturnValue({ data: detail(), isLoading: false });

    renderWithProviders(<MarketplaceDetailPage />);
    expect(screen.getByRole('button', { name: /edit metadata/i })).toBeInTheDocument();
  });

  it('renders a not-found state when the entry is null', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    useMarketplaceEntry.mockReturnValue({ data: null, isLoading: false });

    renderWithProviders(<MarketplaceDetailPage />);
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('does not render a homepage link for a non-http(s) (javascript:) URL', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    useMarketplaceEntry.mockReturnValue({
      data: detail({ homepage: 'javascript:alert(1)' }),
      isLoading: false,
    });

    const { container } = renderWithProviders(<MarketplaceDetailPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    // No anchor at all should carry a javascript: scheme.
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    // And the docs link must not be emitted for an unsafe homepage.
    expect(screen.queryByText(/docs|doku/i)).toBeNull();
  });

  it('renders the homepage link for a valid https URL', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    useMarketplaceEntry.mockReturnValue({
      data: detail({ homepage: 'https://docs.example.org' }),
      isLoading: false,
    });

    const { container } = renderWithProviders(<MarketplaceDetailPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(container.querySelector('a[href="https://docs.example.org"]')).not.toBeNull();
  });

  it('offers View on GitHub and the plugin download as primary actions', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    useMarketplaceEntry.mockReturnValue({ data: detail(), isLoading: false });

    renderWithProviders(<MarketplaceDetailPage />);
    expect(screen.getByRole('link', { name: /view on github/i })).toHaveAttribute(
      'href',
      'https://github.com/owner/repo',
    );
    expect(screen.getByRole('link', { name: /download plugin/i })).toBeInTheDocument();
  });

  it('does not link a non-http artifact URL', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    useMarketplaceEntry.mockReturnValue({
      data: detail({ artifactUrl: 'javascript:alert(1)' }),
      isLoading: false,
    });

    const { container } = renderWithProviders(<MarketplaceDetailPage />);
    expect(screen.queryByRole('link', { name: /download plugin/i })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Compatibility' }));
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('switches tabs with the arrow keys', () => {
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    useMarketplaceEntry.mockReturnValue({ data: detail(), isLoading: false });

    renderWithProviders(<MarketplaceDetailPage />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Releases' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });
});
