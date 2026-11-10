/**
 * GeoMap.tsx – The network map canvas: a zoomable, pannable SVG of Germany
 * with organization pins, city clusters and peer edges, plus floating zoom
 * controls and a legend.
 * - Placement: cities with one site render a GeoMapPin, cities with several a
 *   GeoMapCluster; selecting a cluster (or one of its members) fans the
 *   members out around it with a short staggered spring.
 * - Motion: pins enter with a north-to-south stagger on load, animate out and
 *   in when filters change (usePresenceList), and the view glides to a newly
 *   selected organization in one spring movement (useMapViewport). Reduce
 *   Motion turns movement into crossfades and instant view changes.
 * - Verbunds: every site links to its Verbund hub (hub-and-spoke, one line
 *   per member); selecting a site rings its Verbund peers in the Verbund
 *   colour.
 * - Keyboard: Tab reaches every node; arrow keys jump to the nearest node in
 *   that direction (or pan when the map itself has focus); + / − zoom and 0
 *   shows all of Germany.
 * - Performance: pan and zoom gestures move the zoom layer directly
 *   (useMapViewport) and re-render nothing until the gesture ends; hover
 *   lives in a store, so only the affected markers, the tooltip and the
 *   hover spokes re-render; pins and clusters are memoized.
 * Dependencies: GermanyOutline, GeoMapPin, GeoMapCluster, GeoMapEdges,
 * MapControls, mapGeometry, spokeGeometry, hoverStore, useMapViewport,
 * usePresenceList, lib/motion, lib/peerEdges, i18n.store, map.css.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, type CSSProperties } from 'react';
import type { MapOrganization } from '../../api/network.api';
import { GermanyOutline } from './GermanyOutline';
import { GeoMapPin } from './GeoMapPin';
import { GeoMapCluster } from './GeoMapCluster';
import { GeoMapEdges } from './GeoMapEdges';
import { MapLegend, MapZoomControls } from './MapControls';
import { MapTooltip } from './MapTooltip';
import {
  FOCUS_ZOOM,
  PIN_SHADOW_GRADIENT_ID,
  MAP_HEIGHT,
  MAP_WIDTH,
  fanOutOffsets,
  nearestInDirection,
  placeOrganizations,
  type Direction,
  type MapView,
  type NodePoint,
  type Placed,
  type PlacedCluster,
} from './mapGeometry';
import { useMapViewport, viewTransform } from './useMapViewport';
import { layoutSpokes } from './spokeGeometry';
import { useHoveredId, useOwnHoverStore, type HoverStore } from './hoverStore';
import { usePresenceList } from './usePresenceList';
import { verbundColor, verbundsByOrg, type VerbundGroup } from '../../lib/peerEdges';
import { exitMs } from '../../lib/motion';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { useI18n } from '../../stores/i18n.store';

interface Props {
  organizations: MapOrganization[]; // already filtered (search/status/active)
  allOrganizations: MapOrganization[]; // unfiltered, used for cluster totals
  selectedId: string | null; // pin identifier OR cluster key
  onSelect: (id: string | null) => void;
  verbunds: VerbundGroup[];
  activeVerbunds: Set<string>;
  showAllEdges: boolean;
  /** Hover shared with the organization list; the map keeps its own if omitted. */
  hover?: HoverStore;
  /** Offered in the "nothing matches" state. */
  onResetFilters?: () => void;
  /** Screen-pixel sideways shift for focusing, when a sheet floats over the map. */
  focusShiftPx?: number;
}

interface FanMember {
  key: string;
  org: MapOrganization;
  x: number;
  y: number;
  offset: [number, number];
  index: number;
}

const NODE_EXIT_MS = exitMs('short');
const PAN_STEP = 60;
const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function expandedClusterOf(placed: Placed[], selectedId: string | null): PlacedCluster | null {
  if (!selectedId) return null;
  for (const p of placed) {
    if (p.kind !== 'cluster') continue;
    if (p.key === selectedId || p.group.members.some((m) => m.identifier === selectedId)) return p;
  }
  return null;
}

export function GeoMap({
  organizations,
  allOrganizations,
  selectedId,
  onSelect,
  verbunds,
  activeVerbunds,
  showAllEdges,
  hover: hoverProp,
  onResetFilters,
  focusShiftPx = 0,
}: Props) {
  const { t } = useI18n();
  const hintId = useId();
  const ownHover = useOwnHoverStore();
  const hover = hoverProp ?? ownHover;
  const onHover = hover.set;
  const viewport = useMapViewport();
  const { view, focusOn } = viewport;
  const k = view.k;
  // Screen pixels per SVG unit: markers, labels and line widths divide by it
  // to keep a constant on-screen size at every zoom and window size.
  const ks = k * viewport.pixelScale;

  const placed = useMemo(
    () => placeOrganizations(organizations, allOrganizations),
    [organizations, allOrganizations],
  );
  const presentNodes = usePresenceList(placed, (p) => p.key, NODE_EXIT_MS);

  // Stagger only the first batch (a north-to-south sweep on load); nodes that
  // arrive later through a filter change enter without delay. Indices stay
  // fixed per key so re-renders never shift a running animation.
  const staggerRef = useRef<Map<string, number> | null>(null);
  if (staggerRef.current === null && placed.length > 0) {
    staggerRef.current = new Map(placed.map((p, i) => [p.key, i]));
  }
  const staggerOf = (key: string) => staggerRef.current?.get(key) ?? 0;

  const expanded = expandedClusterOf(placed, selectedId);
  const fanMembers = useMemo<FanMember[]>(() => {
    if (!expanded) return [];
    const offsets = fanOutOffsets(expanded.group.members.length);
    return expanded.group.members.map((org, index) => ({
      key: `${expanded.key}|${org.identifier}`,
      org,
      x: expanded.x,
      y: expanded.y,
      offset: offsets[index],
      index,
    }));
  }, [expanded]);
  const presentFan = usePresenceList(fanMembers, (m) => m.key, NODE_EXIT_MS);

  const endpointPos = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const p of placed) {
      if (p.kind === 'pin') m.set(p.org.identifier, [p.x, p.y]);
      else for (const member of p.group.members) m.set(member.identifier, [p.x, p.y]);
    }
    for (const f of fanMembers) {
      m.set(f.org.identifier, [f.x + f.offset[0] / ks, f.y + f.offset[1] / ks]);
    }
    return m;
  }, [placed, fanMembers, ks]);

  const clusterKeyForOrg = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of placed)
      if (p.kind === 'cluster')
        for (const member of p.group.members) m.set(member.identifier, p.key);
    return (orgId: string) => m.get(orgId) ?? null;
  }, [placed]);

  // Spoke geometry depends on positions only, never on highlight state.
  const { hubs, spokes } = useMemo(
    () => layoutSpokes(verbunds, endpointPos, clusterKeyForOrg),
    [verbunds, endpointPos, clusterKeyForOrg],
  );

  // Peers of the selection: every other member of the selected site's (or
  // selected city's) Verbunds, keyed by the node that shows them, coloured
  // by the first shared Verbund.
  const parentsOf = useMemo(() => verbundsByOrg(verbunds), [verbunds]);
  const peerColors = useMemo(() => {
    const out = new Map<string, string>();
    if (!selectedId) return out;
    const selectedOrgs = expanded ? expanded.group.members.map((m) => m.identifier) : [selectedId];
    const own = new Set(selectedOrgs);
    const shared = new Set(selectedOrgs.flatMap((id) => parentsOf.get(id) ?? []));
    for (const g of verbunds) {
      if (!shared.has(g.verbund)) continue;
      for (const id of g.members) {
        if (own.has(id)) continue;
        const color = verbundColor(g.verbund);
        const nodeKey = clusterKeyForOrg(id) ?? id;
        if (!out.has(nodeKey)) out.set(nodeKey, color);
        if (!out.has(id)) out.set(id, color);
      }
    }
    return out;
  }, [selectedId, expanded, parentsOf, verbunds, clusterKeyForOrg]);

  // Stable handlers keep the memoized markers from re-rendering.
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const toggleCluster = useCallback(
    (id: string) => onSelect(selectedRef.current === id ? null : id),
    [onSelect],
  );

  // Glide to a newly selected organization or city, and back to the view the
  // user had before once the selection is cleared. Only a selection change
  // moves the view; filter changes and resizes must not, so the latest
  // placement, view and view functions are read through a ref.
  const setView = viewport.setView;
  const focusRef = useRef({ placed, focusOn, focusShiftPx, view, setView });
  focusRef.current = { placed, focusOn, focusShiftPx, view, setView };
  const viewBeforeFocusRef = useRef<MapView | null>(null);
  useEffect(() => {
    const { placed: nodes, focusOn: focus, focusShiftPx: shift, view: now } = focusRef.current;
    if (!selectedId) {
      if (viewBeforeFocusRef.current) focusRef.current.setView(viewBeforeFocusRef.current);
      viewBeforeFocusRef.current = null;
      return;
    }
    const target = nodes.find((p) => p.key === selectedId) ?? expandedClusterOf(nodes, selectedId);
    if (!target) return;
    viewBeforeFocusRef.current ??= now;
    focus(target.x, target.y, FOCUS_ZOOM, shift);
  }, [selectedId]);

  const nodePoints = useMemo<NodePoint[]>(() => {
    const pts: NodePoint[] = placed.map((p) => ({ id: p.key, x: p.x, y: p.y }));
    for (const f of fanMembers) {
      pts.push({ id: f.org.identifier, x: f.x + f.offset[0] / ks, y: f.y + f.offset[1] / ks });
    }
    return pts;
  }, [placed, fanMembers, ks]);

  if (organizations.length === 0) {
    const nothingMatches = allOrganizations.length > 0;
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-3 p-6 text-center">
        <Icon
          name={nothingMatches ? 'filter_alt_off' : 'map'}
          size={40}
          className="text-[color:var(--text-muted)]"
        />
        <p className="m-0 max-w-xs text-sm text-[color:var(--text-secondary)]">
          {t(nothingMatches ? 'mapNoMatches' : 'mapEmptyState')}
        </p>
        {nothingMatches && onResetFilters && (
          <Button variant="secondary" size="sm" onClick={onResetFilters}>
            {t('mapResetFilters')}
          </Button>
        )}
      </div>
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as Element;
    if (event.key === '+' || event.key === '=') viewport.zoomIn();
    else if (event.key === '-' || event.key === '_') viewport.zoomOut();
    else if (event.key === '0') viewport.reset();
    else if (ARROWS[event.key]) {
      const dir = ARROWS[event.key];
      const nodeEl = target.closest?.('[data-map-node]');
      if (nodeEl) {
        const from = nodePoints.find((n) => n.id === nodeEl.getAttribute('data-map-node'));
        const next = from && nearestInDirection(from, nodePoints, dir);
        if (next) {
          const els = event.currentTarget.querySelectorAll<SVGGElement>('[data-map-node]');
          Array.from(els)
            .find((el) => el.getAttribute('data-map-node') === next.id)
            ?.focus();
        }
      } else {
        const step = PAN_STEP;
        viewport.panBy(
          dir === 'left' ? step : dir === 'right' ? -step : 0,
          dir === 'up' ? step : dir === 'down' ? -step : 0,
        );
      }
    } else return;
    event.preventDefault();
  }

  const hasUnknown = placed.some((p) => p.kind === 'pin' && !p.known);

  return (
    <div className="relative h-full w-full">
      <svg
        ref={viewport.svgRef}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="map-svg absolute inset-0 block h-full w-full"
        style={{ overflow: 'visible' }}
        data-dragging={viewport.dragging || undefined}
        tabIndex={0}
        role="group"
        aria-label={t('mapNetworkLabel')}
        aria-describedby={hintId}
        onClick={() => {
          if (viewport.consumeDragClick()) return;
          onSelect(null);
        }}
        onKeyDown={handleKeyDown}
        {...viewport.pointerHandlers}
      >
        <defs>
          <radialGradient id={PIN_SHADOW_GRADIENT_ID}>
            <stop offset="0%" style={{ stopColor: 'var(--map-pin-shadow)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--map-pin-shadow)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <g
          ref={viewport.layerRef}
          className="map-zoom-layer"
          style={{ transform: viewTransform(view), '--map-inv': 1 / ks } as CSSProperties}
        >
          <GermanyOutline />

          {hasUnknown && (
            <g aria-hidden="true">
              <rect
                x="616"
                y="130"
                width="48"
                height="604"
                rx="16"
                className="map-other-zone"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x="640"
                y="120"
                textAnchor="middle"
                className="map-other-label"
                style={{ fontSize: `${11 / ks}px` }}
              >
                {t('mapSonstigeLabel')}
              </text>
            </g>
          )}

          <GeoMapEdges
            hubs={hubs}
            spokes={spokes}
            selectedId={selectedId}
            hover={hover}
            activeVerbunds={activeVerbunds}
            showAllEdges={showAllEdges}
            k={ks}
          />

          {presentNodes.map(({ item: p, key, leaving }) =>
            p.kind === 'pin' ? (
              <GeoMapPin
                key={key}
                org={p.org}
                x={p.x}
                y={p.y}
                hover={hover}
                isSelected={selectedId === key}
                isUnknown={!p.known}
                onSelect={onSelect}
                onHover={onHover}
                staggerIndex={staggerOf(key)}
                leaving={leaving}
                peerColor={peerColors.get(key) ?? null}
              />
            ) : (
              <GeoMapCluster
                key={key}
                group={p.group}
                x={p.x}
                y={p.y}
                hover={hover}
                isSelected={selectedId === key}
                expanded={!leaving && expanded?.key === key}
                matchedCount={p.group.members.length}
                totalCount={p.totalMembers}
                onSelect={toggleCluster}
                onHover={onHover}
                staggerIndex={staggerOf(key)}
                leaving={leaving}
                peerColor={expanded?.key === key ? null : (peerColors.get(key) ?? null)}
              />
            ),
          )}

          {presentFan.map(({ item: f, key, leaving }) => (
            <GeoMapPin
              key={key}
              org={f.org}
              x={f.x}
              y={f.y}
              offset={f.offset}
              compact
              hover={hover}
              isSelected={selectedId === f.org.identifier}
              isUnknown={false}
              onSelect={onSelect}
              onHover={onHover}
              staggerIndex={f.index}
              leaving={leaving}
              peerColor={peerColors.get(f.org.identifier) ?? null}
            />
          ))}

          <TooltipLayer
            hover={hover}
            selectedId={selectedId}
            expandedKey={expanded?.key ?? null}
            placed={placed}
            fanMembers={fanMembers}
          />
        </g>
      </svg>

      <p id={hintId} className="sr-only">
        {t('mapKeyboardHint')}
      </p>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
        <div className="pointer-events-auto">
          <MapLegend />
        </div>
        <div className="pointer-events-auto">
          <MapZoomControls
            k={k}
            onZoomIn={viewport.zoomIn}
            onZoomOut={viewport.zoomOut}
            onReset={viewport.reset}
          />
        </div>
      </div>
    </div>
  );
}

/** The label of the hovered (else selected) node; re-renders on hover only. */
const TooltipLayer = memo(function TooltipLayer({
  hover,
  selectedId,
  expandedKey,
  placed,
  fanMembers,
}: {
  hover: HoverStore;
  selectedId: string | null;
  expandedKey: string | null;
  placed: Placed[];
  fanMembers: FanMember[];
}) {
  const hoveredId = useHoveredId(hover);
  // An expanded city gets no label: it would cover its fanned-out members,
  // and the details sheet already names it.
  const labelId = hoveredId ?? selectedId;
  const tooltipId = labelId && labelId === expandedKey ? null : labelId;
  const tooltipNode =
    (tooltipId && placed.find((p) => p.key === tooltipId)) ||
    (tooltipId && fanMembers.find((f) => f.org.identifier === tooltipId)) ||
    null;
  return tooltipNode ? <MapTooltip key={tooltipId} node={tooltipNode} /> : null;
});
