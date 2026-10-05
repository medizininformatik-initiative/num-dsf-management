/**
 * MapPage.test.tsx — the cross-instance P2P network map. useNetworkMap is the
 * single data source and is mocked per test through a mutable holder so each
 * case drives the loading / empty / loaded branch. Asserts the org/edge data
 * renders, that the show-all-connections toggle adds and removes edge paths,
 * that admin-only detail sections are gated on the admin flag, and the
 * loading + empty branches. Default language is English.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { MapOrganization, MapResponse } from '../../api/network.api';

interface MapHookResult {
  data: MapResponse | undefined;
  isLoading: boolean;
  error: unknown;
  refetch?: () => void;
}

const NUM_VERBUND = 'num-testverband.example.de';

const hook: { current: MapHookResult } = {
  current: { data: undefined, isLoading: false, error: null },
};

vi.mock('../../hooks/useNetworkMap', () => ({
  useNetworkMap: () => hook.current,
}));

import { MapPage } from '../MapPage';

function org(
  over: Partial<MapOrganization> & Pick<MapOrganization, 'identifier' | 'name'>,
): MapOrganization {
  return {
    active: true,
    city: null,
    country_code: 'DE',
    cert_status: 'VALID',
    endpoints: [],
    memberships: [{ parent_organization: NUM_VERBUND, roles: ['DIC'] }],
    ...over,
  };
}

const MUENSTER = org({
  identifier: 'ukm.de',
  name: 'Universitätsklinikum Münster',
  city: 'Münster',
  email: 'admin@ukm.de',
  contacts: [],
});
const BERLIN = org({
  identifier: 'charite.de',
  name: 'Charité Berlin',
  city: 'Berlin',
});

function loaded(isAdmin: boolean): MapHookResult {
  return {
    data: { organizations: [MUENSTER, BERLIN], isAdmin },
    isLoading: false,
    error: null,
  };
}

describe('MapPage', () => {
  beforeEach(() => {
    hook.current = { data: undefined, isLoading: false, error: null };
  });

  it('renders the network from node + edge data', () => {
    hook.current = loaded(false);
    const { container } = renderWithProviders(<MapPage />);

    // Both nodes appear in the left rail, grouped under their shared verbund.
    expect(screen.getByText('Universitätsklinikum Münster')).toBeInTheDocument();
    expect(screen.getByText('Charité Berlin')).toBeInTheDocument();
    expect(screen.getByText(NUM_VERBUND)).toBeInTheDocument();

    // The SVG canvas mounted (not the loading/empty placeholder).
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText('Loading network…')).not.toBeInTheDocument();
  });

  it('show-all-connections toggle adds and removes edge paths', () => {
    hook.current = loaded(false);
    const { container } = renderWithProviders(<MapPage />);

    // Edge paths are tagged data-map-edge; none are drawn by default.
    const edgeSelector = 'path[data-map-edge]';
    expect(container.querySelectorAll(edgeSelector)).toHaveLength(0);

    const toggle = screen.getByRole('button', { name: /Show all connections/i });
    fireEvent.click(toggle);
    // Two peers sharing one verbund → exactly one edge becomes visible.
    expect(container.querySelectorAll(edgeSelector)).toHaveLength(1);

    fireEvent.click(toggle);
    expect(container.querySelectorAll(edgeSelector)).toHaveLength(0);
  });

  it('gates admin-only detail sections behind the admin flag', () => {
    hook.current = loaded(true);
    renderWithProviders(<MapPage />);

    // Open the details panel by selecting an org from the left rail.
    fireEvent.click(screen.getByText('Universitätsklinikum Münster'));

    const panel = screen
      .getByRole('heading', { name: 'Universitätsklinikum Münster' })
      .closest('aside') as HTMLElement;
    expect(panel).not.toBeNull();
    // Admin sections render: Contacts and the Location block.
    expect(within(panel).getByText(/^Contacts/)).toBeInTheDocument();
    expect(within(panel).getByText('Location')).toBeInTheDocument();
    expect(within(panel).getByText('admin@ukm.de')).toBeInTheDocument();
  });

  it('hides admin-only detail sections for non-admin viewers', () => {
    hook.current = loaded(false);
    renderWithProviders(<MapPage />);

    fireEvent.click(screen.getByText('Universitätsklinikum Münster'));

    const panel = screen
      .getByRole('heading', { name: 'Universitätsklinikum Münster' })
      .closest('aside') as HTMLElement;
    expect(within(panel).getByText(/^Endpoints/)).toBeInTheDocument();
    expect(within(panel).queryByText('Location')).not.toBeInTheDocument();
    expect(within(panel).queryByText('admin@ukm.de')).not.toBeInTheDocument();
  });

  it('shows the loading placeholder while the map is fetching', () => {
    hook.current = { data: undefined, isLoading: true, error: null };
    const { container } = renderWithProviders(<MapPage />);

    expect(screen.getByText('Loading network…')).toBeInTheDocument();
    // The map SVG is not rendered during loading.
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('shows the empty state when no organizations are returned', () => {
    hook.current = { data: { organizations: [], isAdmin: false }, isLoading: false, error: null };
    renderWithProviders(<MapPage />);

    expect(
      screen.getByText('No approved organizations in the allow list yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No organizations match the current filter.')).toBeInTheDocument();
  });

  it('shows the load error as an alert with a retry action', () => {
    const refetch = vi.fn();
    hook.current = { data: undefined, isLoading: false, error: new Error('x'), refetch };
    renderWithProviders(<MapPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load network map.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('collapses and reopens the organization list from the toolbar', async () => {
    hook.current = loaded(false);
    renderWithProviders(<MapPage />);

    // The toolbar toggle (aria-expanded) and the list's own close button share
    // the label; drive the toggle.
    const toggle = screen
      .getAllByRole('button', { name: 'Hide organization list' })
      .find((b) => b.hasAttribute('aria-expanded')) as HTMLElement;
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Organizations' })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show organization list' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // The list slides out, then unmounts.
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Organizations' })).toBeNull(),
    );
  });

  it('highlights the map pin while its list row is hovered', () => {
    hook.current = loaded(false);
    const { container } = renderWithProviders(<MapPage />);

    const pinBody = () =>
      container.querySelector('[data-map-node="charite.de"] .map-marker-body') as Element;
    expect(pinBody()).not.toHaveAttribute('data-hovered');
    const row = screen.getByText('Charité Berlin');
    fireEvent.mouseEnter(row);
    expect(pinBody()).toHaveAttribute('data-hovered', 'true');
    fireEvent.mouseLeave(row);
    expect(pinBody()).not.toHaveAttribute('data-hovered');
  });

  it('marks the list row of a pin selected on the map', () => {
    hook.current = loaded(false);
    const { container } = renderWithProviders(<MapPage />);

    fireEvent.click(screen.getByRole('button', { name: /^Charité Berlin, certificate/ }));
    const row = container.querySelector('[data-org-row="charite.de"]');
    expect(row).toHaveAttribute('aria-current', 'true');
    // The details sheet docks on the right while the list occupies the left.
    const panel = screen.getByRole('heading', { name: 'Charité Berlin' }).closest('aside');
    expect(panel).toHaveAttribute('data-side', 'right');
  });

  it('docks the details sheet on the side of a western site once the list is closed', async () => {
    hook.current = loaded(false);
    renderWithProviders(<MapPage />);

    const toggle = screen
      .getAllByRole('button', { name: 'Hide organization list' })
      .find((b) => b.hasAttribute('aria-expanded')) as HTMLElement;
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Organizations' })).toBeNull(),
    );

    // Münster lies in the west of Germany.
    fireEvent.click(
      screen.getByRole('button', { name: /^Universitätsklinikum Münster, certificate/ }),
    );
    const panel = screen
      .getByRole('heading', { name: 'Universitätsklinikum Münster' })
      .closest('aside');
    expect(panel).toHaveAttribute('data-side', 'left');
  });
});
