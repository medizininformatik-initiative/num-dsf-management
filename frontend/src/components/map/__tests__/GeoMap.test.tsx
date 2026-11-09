import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within, act } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { GeoMap } from '../GeoMap';
import { GermanyOutline } from '../GermanyOutline';
import { deriveVerbunds } from '../../../lib/peerEdges';
import type { MapOrganization } from '../../../api/network.api';

// Two orgs in *different* known cities (Berlin / Hamburg) so each renders as
// its own pin rather than collapsing into a single-city cluster. Both share a
// parent_organization, so they form one Verbund: one hub, two spokes.
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

const verbunds = deriveVerbunds(orgs);

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
      verbunds={deriveVerbunds(list)}
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

  it('derives one Verbund holding both orgs', () => {
    // Sanity-check the fixture so the spoke assertions below are meaningful.
    expect(verbunds).toEqual([{ verbund: VERBUND, members: ['ukm.de', 'uksh.de'] }]);
  });

  it('batches all spokes of a Verbund into one path when showAllEdges is on', () => {
    const { container } = renderMap({ showAllEdges: true });
    expect(edgeCount(container)).toBe(1);
    const d = container.querySelector('path[data-map-edge]')?.getAttribute('d') ?? '';
    // Two quadratic curves (one per member) in one path.
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Q/g)).toHaveLength(2);
    expect(container.querySelector('path[data-map-edge]')).toHaveAttribute(
      'vector-effect',
      'non-scaling-stroke',
    );
  });

  it('shows the Verbund hub with its label midway between the members', () => {
    const { container } = renderMap({ showAllEdges: true });
    const hub = container.querySelector(`[data-map-hub="${VERBUND}"]`);
    expect(hub).not.toBeNull();
    expect(hub?.textContent).toBe('NUM');
    // Centroid of Berlin (481, 257) and Hamburg (269, 149).
    expect(hub?.getAttribute('transform')).toBe('translate(375 203)');
  });

  it('needs one spoke per member, not one edge per pair', () => {
    const cities = ['Berlin', 'Hamburg', 'München', 'Köln', 'Leipzig', 'Dresden', 'Kiel'];
    const many = Array.from({ length: 7 }, (_, i) =>
      org(`s${i}.example.de`, `Site ${i}`, cities[i]),
    );
    const { container } = renderMap({ organizations: many, showAllEdges: true });
    const d = container.querySelector('path[data-map-edge]')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(7); // a complete graph would need 21
  });

  it('draws no edge path when showAllEdges is off and nothing is selected', () => {
    const { container } = renderMap({ showAllEdges: false });
    expect(edgeCount(container)).toBe(0);
  });

  it('draws the selected node spoke on, starting from the selected node', () => {
    const { container } = renderMap({ selectedId: 'uksh.de' });
    const edges = container.querySelectorAll('path[data-map-edge]');
    expect(edges).toHaveLength(1);
    expect(edges[0].getAttribute('class')).toContain('map-animate-edge-draw');
    // Hamburg (269, 149) is the start point of the drawn curve, the hub its end.
    expect(edges[0].getAttribute('d')).toMatch(/^M269 149Q.* 375 203$/);
    // A dash flow runs along the selected spoke, and the hub is shown.
    expect(container.querySelectorAll('.map-edge-flow')).toHaveLength(1);
    expect(container.querySelector(`[data-map-hub="${VERBUND}"]`)).not.toBeNull();
  });

  it('rings the Verbund peers of the selected site instead of drawing lines to them', () => {
    const { container } = renderMap({ selectedId: 'uksh.de' });
    const peer = container.querySelector('[data-map-node="ukm.de"] [data-map-peer]');
    expect(peer).not.toBeNull();
    expect(peer).toHaveStyle({ stroke: '#4a90d9' });
    // The selected site itself is no peer.
    expect(container.querySelector('[data-map-node="uksh.de"] [data-map-peer]')).toBeNull();
  });

  it('rings no peers while nothing is selected', () => {
    const { container } = renderMap({ showAllEdges: true });
    expect(container.querySelector('[data-map-peer]')).toBeNull();
  });

  it('runs the dash flow on at most MAX_FLOW spokes of a selection', () => {
    // Six sites of one city, each in its own Verbund with a site elsewhere:
    // selecting the city selects six spokes, but only three flow.
    const list: MapOrganization[] = [];
    for (let i = 0; i < 6; i++) {
      const parent = `v${i}.example.de`;
      list.push({
        ...org(`b${i}.example.de`, `Berlin ${i}`, 'Berlin'),
        memberships: [{ parent_organization: parent, roles: [] }],
      });
      list.push({
        ...org(`h${i}.example.de`, `Hamburg ${i}`, 'Hamburg'),
        memberships: [{ parent_organization: parent, roles: [] }],
      });
    }
    const { container } = renderMap({ organizations: list, selectedId: '__cluster__berlin|DE' });
    expect(container.querySelectorAll('.map-animate-edge-draw').length).toBeGreaterThan(3);
    expect(container.querySelectorAll('.map-edge-flow')).toHaveLength(3);
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
        verbunds={[]}
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
        verbunds={[]}
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
        verbunds={[]}
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
