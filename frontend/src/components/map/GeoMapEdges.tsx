/**
 * GeoMapEdges.tsx – SVG layer of the Verbund hub-and-spoke lines: thin
 * curves from each site to its Verbund hub, in the Verbund colour, and the
 * labelled hubs themselves. The layer is `pointer-events: none` so it never
 * steals hover/click from markers.
 *
 * Background spokes are batched: one <path> per Verbund (or colour) whose `d`
 * holds all its spokes, with a non-scaling stroke so zooming never touches
 * them. They fade in when triggered:
 *   - the hovered node's spokes          → 0.55
 *   - a Verbund chosen in the pills      → 0.45
 *   - `showAllEdges` is true             → 0.22 (0.1 while a node is selected)
 * Spokes of the selected node (or of every member of a selected cluster)
 * draw on from the selected end; a dash flow then runs along at most
 * MAX_FLOW of them, the rest stay a static highlight. When the selection
 * goes they retract towards it, faster than they came. Under Reduce Motion
 * the draw and retract are crossfades and the flow stands still. A hub shows
 * while any of its spokes does.
 *
 * Hover is read from the hover store in two small sub-layers, so a hover
 * change re-renders only those, never the whole map.
 * Dependencies: spokeGeometry, hoverStore, usePresenceList, lib/motion,
 * map.css.
 */
import { memo, useMemo, type CSSProperties } from 'react';
import { exitMs } from '../../lib/motion';
import { usePresenceList } from './usePresenceList';
import { useHoveredId, type HoverStore } from './hoverStore';
import type { Hub, Spoke } from './spokeGeometry';

interface Props {
  hubs: Hub[];
  spokes: Spoke[];
  selectedId: string | null; // pin id OR cluster key
  hover?: HoverStore;
  activeVerbunds: Set<string>;
  showAllEdges: boolean;
  /** Screen pixels per map unit (zoom × fit scale), for the selected spokes. */
  k?: number;
}

/** At most this many selected spokes run the dash flow animation. */
export const MAX_FLOW = 3;
const RETRACT_MS = exitMs('medium');
const LINE_WIDTH = 1.4; // screen pixels

function touches(spoke: Spoke, id: string | null): boolean {
  return id !== null && spoke.nodes.includes(id);
}

/** One batched path per key: all `d`s of a group concatenated. */
function batch<T extends { key: string; color: string; opacity: number }>(
  spokes: Spoke[],
  groupOf: (s: Spoke) => T | null,
): (T & { d: string })[] {
  const out = new Map<string, T & { d: string }>();
  for (const s of spokes) {
    const g = groupOf(s);
    if (!g) continue;
    const prev = out.get(g.key);
    if (prev) prev.d += s.d;
    else out.set(g.key, { ...g, d: s.d });
  }
  return [...out.values()];
}

function BatchedPath({ d, color, opacity }: { d: string; color: string; opacity: number }) {
  return (
    <path
      data-map-edge=""
      className="map-edge map-animate-edge-in"
      d={d}
      vectorEffect="non-scaling-stroke"
      strokeWidth={LINE_WIDTH}
      style={{ stroke: color, opacity }}
    />
  );
}

/** Spokes of the hovered node, re-rendered on hover only. */
const HoverSpokes = memo(function HoverSpokes({
  spokes,
  hover,
  selectedId,
}: {
  spokes: Spoke[];
  hover: HoverStore;
  selectedId: string | null;
}) {
  const hoveredId = useHoveredId(hover);
  const paths = useMemo(
    () =>
      hoveredId
        ? batch(spokes, (s) =>
            touches(s, hoveredId) && !touches(s, selectedId)
              ? { key: `${hoveredId}|${s.color}`, color: s.color, opacity: 0.55 }
              : null,
          )
        : [],
    [spokes, hoveredId, selectedId],
  );
  return (
    <>
      {paths.map((p) => (
        <BatchedPath key={p.key} d={p.d} color={p.color} opacity={p.opacity} />
      ))}
    </>
  );
});

const HubMarker = memo(function HubMarker({ hub }: { hub: Hub }) {
  const width = 16 + hub.label.length * 7;
  return (
    <g
      transform={`translate(${hub.x} ${hub.y})`}
      className="map-animate-edge-in"
      data-map-hub={hub.verbund}
    >
      <g className="map-counter-scale">
        <rect
          x={-width / 2}
          y={-10}
          width={width}
          height={20}
          rx={10}
          className="map-hub"
          style={{ stroke: hub.color }}
        />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          className="map-hub-label"
          style={{ fill: hub.color }}
        >
          {hub.label}
        </text>
      </g>
    </g>
  );
});

/** Hubs with a visible spoke; the hovered node's hubs join while hovered. */
const Hubs = memo(function Hubs({
  hubs,
  spokes,
  visible,
  hover,
}: {
  hubs: Hub[];
  spokes: Spoke[];
  visible: Set<string>;
  hover?: HoverStore;
}) {
  const hoveredId = useHoveredId(hover ?? NO_HOVER);
  const shown = useMemo(() => {
    if (!hoveredId) return visible;
    const next = new Set(visible);
    for (const s of spokes) if (touches(s, hoveredId)) next.add(s.verbund);
    return next;
  }, [visible, spokes, hoveredId]);
  return (
    <>
      {hubs
        .filter((h) => shown.has(h.verbund))
        .map((h) => (
          <HubMarker key={h.verbund} hub={h} />
        ))}
    </>
  );
});

const NO_HOVER: HoverStore = {
  get: () => null,
  set: () => {},
  subscribe: () => () => {},
};

export function GeoMapEdges({
  hubs,
  spokes,
  selectedId,
  hover,
  activeVerbunds,
  showAllEdges,
  k = 1,
}: Props) {
  const { selected, background, visibleHubs } = useMemo(() => {
    const sel = spokes
      .filter((s) => touches(s, selectedId))
      .map((s) => ({ ...s, key: `${selectedId}|${s.key}` }));
    const bg = batch(spokes, (s) => {
      if (touches(s, selectedId)) return null;
      const opacity = activeVerbunds.has(s.verbund)
        ? 0.45
        : showAllEdges
          ? selectedId
            ? 0.1
            : 0.22
          : 0;
      return opacity === 0 ? null : { key: `${s.verbund}|${opacity}`, color: s.color, opacity };
    });
    const vis = new Set<string>();
    for (const s of sel) vis.add(s.verbund);
    for (const s of spokes) if (activeVerbunds.has(s.verbund) || showAllEdges) vis.add(s.verbund);
    return { selected: sel, background: bg, visibleHubs: vis };
  }, [spokes, selectedId, activeVerbunds, showAllEdges]);

  const presentSelected = usePresenceList(selected, (s) => s.key, RETRACT_MS);
  const width = (LINE_WIDTH * 1.4) / k;
  let flowing = 0;

  return (
    <g style={{ pointerEvents: 'none' }} aria-hidden="true">
      {background.map((p) => (
        <BatchedPath key={p.key} d={p.d} color={p.color} opacity={p.opacity} />
      ))}
      {hover && <HoverSpokes spokes={spokes} hover={hover} selectedId={selectedId} />}
      {presentSelected.map(({ item: s, key, leaving }) => {
        const flow = !leaving && flowing++ < MAX_FLOW;
        return (
          <g key={key}>
            <path
              data-map-edge={leaving ? undefined : ''}
              className={`map-edge ${leaving ? 'map-animate-edge-retract' : 'map-animate-edge-draw'}`}
              d={s.d}
              pathLength={1}
              style={{ stroke: s.color, opacity: 0.85 }}
              strokeWidth={width}
            />
            {flow && (
              <path
                className="map-edge-flow"
                d={s.d}
                strokeWidth={LINE_WIDTH / k}
                style={
                  {
                    strokeDasharray: `${2 / k} ${8 / k}`,
                    '--flow': `${10 / k}px`,
                  } as CSSProperties
                }
              />
            )}
          </g>
        );
      })}
      <Hubs hubs={hubs} spokes={spokes} visible={visibleHubs} hover={hover} />
    </g>
  );
}
