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
 * - Keyboard: Tab reaches every node; arrow keys jump to the nearest node in
 *   that direction (or pan when the map itself has focus); + / − zoom and 0
 *   shows all of Germany.
 * Dependencies: GermanyOutline, GeoMapPin, GeoMapCluster, GeoMapEdges,
 * MapControls, mapGeometry, useMapViewport, usePresenceList, lib/motion,
 * lib/peerEdges, i18n.store, map.css.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
  type NodePoint,
  type Placed,
  type PlacedCluster,
} from './mapGeometry';
import { useMapViewport } from './useMapViewport';
import { usePresenceList } from './usePresenceList';
import type { PeerEdge } from '../../lib/peerEdges';
import { exitMs } from '../../lib/motion';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { useI18n } from '../../stores/i18n.store';

interface Props {
  organizations: MapOrganization[]; // already filtered (search/status/active)
  allOrganizations: MapOrganization[]; // unfiltered, used for cluster totals
  selectedId: string | null; // pin identifier OR cluster key
  onSelect: (id: string | null) => void;
  edges: PeerEdge[];
  activeVerbunds: Set<string>;
  showAllEdges: boolean;
  /** Controlled hover (shared with the organization list); internal if omitted. */
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
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
  edges,
  activeVerbunds,
  showAllEdges,
  hoveredId: hoveredProp,
  onHover: onHoverProp,
  onResetFilters,
  focusShiftPx = 0,
}: Props) {
  const { t } = useI18n();
  const hintId = useId();
  const [hoveredLocal, setHoveredLocal] = useState<string | null>(null);
  const hoveredId = hoveredProp !== undefined ? hoveredProp : hoveredLocal;
  const onHover = onHoverProp ?? setHoveredLocal;
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

  // Glide to a newly selected organization or city. Only a new selection
  // moves the view; filter changes and resizes must not, so the latest
  // placement and focus function are read through a ref.
  const focusRef = useRef({ placed, focusOn, focusShiftPx });
  focusRef.current = { placed, focusOn, focusShiftPx };
  useEffect(() => {
    if (!selectedId) return;
    const { placed: nodes, focusOn: focus, focusShiftPx: shift } = focusRef.current;
    const target = nodes.find((p) => p.key === selectedId) ?? expandedClusterOf(nodes, selectedId);
    if (target) focus(target.x, target.y, FOCUS_ZOOM, shift);
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
        <span className="glass flex h-14 w-14 items-center justify-center rounded-2xl text-[color:var(--text-muted)]">
          <Icon name={nothingMatches ? 'filter_alt_off' : 'map'} size={28} />
        </span>
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

  // An expanded city gets no label: it would cover its fanned-out members,
  // and the details sheet already names it.
  const labelId = hoveredId ?? selectedId;
  const tooltipId = labelId && labelId === expanded?.key ? null : labelId;
  const tooltipNode =
    (tooltipId && placed.find((p) => p.key === tooltipId)) ||
    (tooltipId && fanMembers.find((f) => f.org.identifier === tooltipId)) ||
    null;
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
          className="map-zoom-layer"
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${k})` }}
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
            edges={edges}
            endpointPos={endpointPos}
            selectedId={selectedId}
            hoveredId={hoveredId}
            activeVerbunds={activeVerbunds}
            showAllEdges={showAllEdges}
            clusterKeyForOrg={clusterKeyForOrg}
            k={ks}
          />

          {presentNodes.map(({ item: p, key, leaving }) =>
            p.kind === 'pin' ? (
              <GeoMapPin
                key={key}
                org={p.org}
                x={p.x}
                y={p.y}
                k={ks}
                isHovered={hoveredId === key}
                isSelected={selectedId === key}
                isUnknown={!p.known}
                onSelect={onSelect}
                onHover={onHover}
                staggerIndex={staggerOf(key)}
                leaving={leaving}
              />
            ) : (
              <GeoMapCluster
                key={key}
                group={p.group}
                x={p.x}
                y={p.y}
                k={ks}
                isHovered={hoveredId === key}
                isSelected={selectedId === key}
                expanded={!leaving && expanded?.key === key}
                matchedCount={p.group.members.length}
                totalCount={p.totalMembers}
                onSelect={(id) => onSelect(selectedId === id ? null : id)}
                onHover={onHover}
                staggerIndex={staggerOf(key)}
                leaving={leaving}
              />
            ),
          )}

          {presentFan.map(({ item: f, key, leaving }) => (
            <GeoMapPin
              key={key}
              org={f.org}
              x={f.x}
              y={f.y}
              k={ks}
              offset={f.offset}
              compact
              isHovered={hoveredId === f.org.identifier}
              isSelected={selectedId === f.org.identifier}
              isUnknown={false}
              onSelect={onSelect}
              onHover={onHover}
              staggerIndex={f.index}
              leaving={leaving}
            />
          ))}

          {tooltipNode && <MapTooltip key={tooltipId} node={tooltipNode} k={ks} />}
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
