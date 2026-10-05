import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within, act } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { GeoMap } from '../GeoMap';
import { GermanyOutline } from '../GermanyOutline';
import { derivePeerEdges } from '../../../lib/peerEdges';
import type { MapOrganization } from '../../../api/network.api';

// Two orgs in *different* known cities (Berlin / Hamburg) so each renders as
// its own pin rather than collapsing into a single-city cluster. Both share a
// parent_organization, so derivePeerEdges yields exactly one peer edge.
const VERBUND = 'num-testverband.example.de';

function org(id: string, name: string, city: string): MapOrganization {
  return {
    identifier: id,
    name,
    active: true,
    city,
    country_code: 'DE',
    cert_status: 'VALID',
    endpoints: [],
    memberships: [{ parent_organization: VERBUND, roles: ['DIC'] }],
  };
}

const orgs: MapOrganization[] = [
  org('ukm.de', 'Uni Klinikum Muenster', 'Berlin'),
  org('uksh.de', 'Uni Klinikum Hamburg', 'Hamburg'),
];

const edges = derivePeerEdges(orgs);

function renderMap(
  opts: {
    showAllEdges?: boolean;
    onSelect?: (id: string | null) => void;
    selectedId?: string | null;
    organizations?: MapOrganization[];
    allOrganizations?: MapOrganization[];
    onResetFilters?: () => void;
  } = {},
) {
  const onSelect = opts.onSelect ?? vi.fn();
  const list = opts.organizations ?? orgs;
  const view = renderWithProviders(
    <GeoMap
      organizations={list}
      allOrganizations={opts.allOrganizations ?? list}
      selectedId={opts.selectedId ?? null}
      onSelect={onSelect}
      edges={derivePeerEdges(list)}
      activeVerbunds={new Set()}
      showAllEdges={opts.showAllEdges ?? false}
      onResetFilters={opts.onResetFilters}
    />,
  );
  return { onSelect, ...view };
}

function mapSvg(container: HTMLElement): SVGSVGElement {
  return container.querySelector('svg.map-svg') as SVGSVGElement;
}

function edgeCount(container: HTMLElement): number {
  return container.querySelectorAll('path[data-map-edge]').length;
}

describe('GeoMap', () => {
  it('renders one pin per seeded org node (distinct cities)', () => {
    const { container } = renderMap();
    const svg = within(mapSvg(container) as unknown as HTMLElement);
    // Each GeoMapPin is a button named after the org and its certificate state.
    expect(
      svg.getByRole('button', { name: 'Uni Klinikum Muenster, certificate: Valid' }),
    ).toBeInTheDocument();
    expect(svg.getByRole('button', { name: /^Uni Klinikum Hamburg/ })).toBeInTheDocument();
    // Exactly the two pins — no extra cluster/button slipped in.
    expect(svg.getAllByRole('button')).toHaveLength(2);
  });

  it('fires onSelect with the org identifier when a pin is clicked', () => {
    const { onSelect } = renderMap();
    fireEvent.click(screen.getByRole('button', { name: /^Uni Klinikum Muenster/ }));
    expect(onSelect).toHaveBeenCalledWith('ukm.de');
  });

  it('derives exactly one peer edge for two orgs sharing a verbund', () => {
    // Sanity-check the fixture so the edge-render assertion below is meaningful.
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: 'ukm.de', to: 'uksh.de', verbund: VERBUND });
  });

  it('renders an edge path per seeded relation when showAllEdges is on', () => {
    const { container } = renderMap({ showAllEdges: true });
    expect(edgeCount(container)).toBe(1);
    // A quadratic-bezier curve, not a straight line.
    expect(container.querySelector('path[data-map-edge]')?.getAttribute('d')).toContain('Q');
  });

  it('draws no edge path when showAllEdges is off and nothing is selected', () => {
    const { container } = renderMap({ showAllEdges: false });
    expect(edgeCount(container)).toBe(0);
  });

  it('draws the selected node edges on, starting from the selected node', () => {
    const { container } = renderMap({ selectedId: 'uksh.de' });
    const edge = container.querySelector('path[data-map-edge]');
    expect(edge).not.toBeNull();
    expect(edge?.getAttribute('class')).toContain('map-animate-edge-draw');
    // Hamburg (269, 149) is the start point of the drawn curve.
    expect(edge?.getAttribute('d')).toMatch(/^M 269 149 /);
    // A dash flow runs along the selected edge.
    expect(container.querySelector('.map-edge-flow')).not.toBeNull();
  });

  it('zooms with the floating controls and resets to all of Germany', () => {
    const { container } = renderMap();
    const layer = container.querySelector('.map-zoom-layer') as SVGGElement;
    expect(layer.style.transform).toContain('scale(1)');
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(layer.style.transform).toContain('scale(1.5)');
    fireEvent.click(screen.getByRole('button', { name: 'Show all of Germany' }));
    expect(layer.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('supports + / − / 0 keys on the focused map', () => {
    const { container } = renderMap();
    const svg = mapSvg(container);
    const layer = container.querySelector('.map-zoom-layer') as SVGGElement;
    fireEvent.keyDown(svg, { key: '+' });
    expect(layer.style.transform).toContain('scale(1.5)');
    fireEvent.keyDown(svg, { key: '0' });
    expect(layer.style.transform).toContain('scale(1)');
  });

  it('moves keyboard focus to the nearest pin in the arrow direction', () => {
    renderMap();
    const hamburg = screen.getByRole('button', { name: /^Uni Klinikum Hamburg/ });
    const berlin = screen.getByRole('button', { name: /^Uni Klinikum Muenster/ });
    act(() => hamburg.focus());
    // Berlin lies south-east of Hamburg: more east than south.
    fireEvent.keyDown(hamburg, { key: 'ArrowRight' });
    expect(berlin).toHaveFocus();
    fireEvent.keyDown(berlin, { key: 'ArrowLeft' });
    expect(hamburg).toHaveFocus();
  });

  it('glides to a selected organization', () => {
    const { container } = renderMap({ selectedId: 'uksh.de' });
    const layer = container.querySelector('.map-zoom-layer') as SVGGElement;
    expect(layer.style.transform).toContain('scale(2.2)');
  });

  it('fans the members of a selected city cluster out as pins', () => {
    const berlinA = org('a.example.de', 'Alpha Berlin', 'Berlin');
    const berlinB = org('b.example.de', 'Beta Berlin', 'Berlin');
    const list = [berlinA, berlinB];
    const { container, rerender, onSelect } = renderMap({ organizations: list });
    const cluster = screen.getByRole('button', { name: 'Berlin: 2 sites' });
    expect(cluster).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(cluster);
    expect(onSelect).toHaveBeenCalledWith('__cluster__berlin|DE');

    rerender(
      <GeoMap
        organizations={list}
        allOrganizations={list}
        selectedId="__cluster__berlin|DE"
        onSelect={onSelect}
        edges={[]}
        activeVerbunds={new Set()}
        showAllEdges={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Berlin: 2 sites' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const fanned = container.querySelectorAll('.map-animate-fan-in');
    expect(fanned).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /^Beta Berlin/ }));
    expect(onSelect).toHaveBeenLastCalledWith('b.example.de');
  });

  it('keeps a filtered-out pin briefly as a non-interactive exit', () => {
    const { container, rerender, onSelect } = renderMap();
    rerender(
      <GeoMap
        organizations={[orgs[0]]}
        allOrganizations={orgs}
        selectedId={null}
        onSelect={onSelect}
        edges={[]}
        activeVerbunds={new Set()}
        showAllEdges={false}
      />,
    );
    const leaving = container.querySelector('[data-leaving="true"]');
    expect(leaving).not.toBeNull();
    expect(leaving).toHaveAttribute('aria-hidden', 'true');
    expect(leaving?.querySelector('.map-animate-node-out')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Uni Klinikum Hamburg/ })).toBeNull();
  });

  it('renders the empty-state message and no SVG when there are no orgs', () => {
    const { container } = renderWithProviders(
      <GeoMap
        organizations={[]}
        allOrganizations={[]}
        selectedId={null}
        onSelect={vi.fn()}
        edges={[]}
        activeVerbunds={new Set()}
        showAllEdges={false}
      />,
    );
    expect(
      screen.getByText('No approved organizations in the allow list yet.'),
    ).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a filter reset when the filters hide every site', () => {
    const onResetFilters = vi.fn();
    renderMap({ organizations: [], allOrganizations: orgs, onResetFilters });
    expect(screen.getByText('No sites match the current filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });
});

describe('GermanyOutline', () => {
  it('defines one SVG path per federal-state silhouette and reuses it per layer', () => {
    const { container } = renderWithProviders(
      <svg>
        <GermanyOutline />
      </svg>,
    );
    const paths = container.querySelectorAll('path');
    // 16 German federal states, each a single <path>.
    expect(paths.length).toBe(16);
    // Each path carries real geometry data.
    paths.forEach((p) => {
      expect(p.getAttribute('d')).toBeTruthy();
    });
    // Coast, land and state-border layers each reuse all 16 shapes.
    expect(container.querySelectorAll('use')).toHaveLength(48);
  });
});
