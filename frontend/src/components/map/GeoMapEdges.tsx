/**
 * GeoMapEdges.tsx – SVG layer of peer edges (shared network/Verbund) as thin
 * quadratic curves in the Verbund colour. The layer is `pointer-events: none`
 * so it never steals hover/click from markers.
 *
 * Background edges fade in at low opacity when triggered:
 *   - `hoveredId` matches one endpoint   → 0.55
 *   - `activeVerbunds` includes the edge → 0.45
 *   - `showAllEdges` is true             → 0.22 (0.1 while a node is selected)
 * Edges of the selected node (or of every member of a selected cluster) draw
 * on from the selected end, then a dash flow runs along them; when the
 * selection goes they retract towards it, faster than they came. Under Reduce
 * Motion the draw and retract are crossfades and the flow stands still.
 *
 * endpointPos maps org.identifier → [x, y] (a clustered member maps to its
 * cluster, or to its fanned-out position while the cluster is expanded);
 * clusterKeyForOrg lets a cluster key select the edges of all its members.
 * Stroke widths are divided by the zoom `k` so lines stay hairline-thin.
 */
import { useMemo, type CSSProperties } from 'react';
import { verbundColor } from '../../lib/peerEdges';
import type { PeerEdge } from '../../lib/peerEdges';
import { exitMs } from '../../lib/motion';
import { usePresenceList } from './usePresenceList';

interface Props {
  edges: PeerEdge[];
  endpointPos: Map<string, [number, number]>;
  selectedId: string | null; // pin id OR cluster key
  hoveredId: string | null;
  activeVerbunds: Set<string>;
  showAllEdges: boolean;
  clusterKeyForOrg: (orgId: string) => string | null;
  k?: number;
}

interface DrawnEdge {
  key: string;
  d: string;
  color: string;
}

const RETRACT_MS = exitMs('medium');

function bezierBetween(x1: number, y1: number, x2: number, y2: number, idx: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const offset = 0.18 * len * (idx % 2 === 0 ? 1 : -1);
  return `M ${x1} ${y1} Q ${mx + nx * offset} ${my + ny * offset} ${x2} ${y2}`;
}

export function GeoMapEdges({
  edges,
  endpointPos,
  selectedId,
  hoveredId,
  activeVerbunds,
  showAllEdges,
  clusterKeyForOrg,
  k = 1,
}: Props) {
  const { selected, background } = useMemo(() => {
    const sel: DrawnEdge[] = [];
    const bg: (DrawnEdge & { opacity: number })[] = [];
    edges.forEach((e, i) => {
      const fromPos = endpointPos.get(e.from);
      const toPos = endpointPos.get(e.to);
      if (!fromPos || !toPos) return;
      // Skip self-edges that arise when both endpoints map to the same cluster pin.
      if (fromPos[0] === toPos[0] && fromPos[1] === toPos[1]) return;
      const fromKey = clusterKeyForOrg(e.from);
      const toKey = clusterKeyForOrg(e.to);
      const touches = (id: string | null, org: string, key: string | null) =>
        id !== null && (id === org || id === key);
      const selFrom = touches(selectedId, e.from, fromKey);
      const selTo = touches(selectedId, e.to, toKey);
      const color = verbundColor(e.verbund);
      const baseKey = `${e.from}|${e.to}|${e.verbund}|${i}`;
      if (selFrom || selTo) {
        // Draw away from the selected end.
        const [a, b] = selFrom ? [fromPos, toPos] : [toPos, fromPos];
        sel.push({
          key: `${selectedId}|${baseKey}`,
          d: bezierBetween(a[0], a[1], b[0], b[1], i),
          color,
        });
        return;
      }
      const hovered = touches(hoveredId, e.from, fromKey) || touches(hoveredId, e.to, toKey);
      const opacity = hovered
        ? 0.55
        : activeVerbunds.has(e.verbund)
          ? 0.45
          : showAllEdges
            ? selectedId
              ? 0.1
              : 0.22
            : 0;
      if (opacity === 0) return;
      bg.push({
        key: baseKey,
        d: bezierBetween(fromPos[0], fromPos[1], toPos[0], toPos[1], i),
        color,
        opacity,
      });
    });
    return { selected: sel, background: bg };
  }, [edges, endpointPos, selectedId, hoveredId, activeVerbunds, showAllEdges, clusterKeyForOrg]);

  const presentSelected = usePresenceList(selected, (e) => e.key, RETRACT_MS);
  const width = 1.4 / k;

  return (
    <g style={{ pointerEvents: 'none' }} aria-hidden="true">
      {background.map((e) => (
        <path
          key={e.key}
          data-map-edge=""
          className="map-edge map-animate-edge-in"
          d={e.d}
          style={{ stroke: e.color, opacity: e.opacity }}
          strokeWidth={width}
        />
      ))}
      {presentSelected.map(({ item: e, key, leaving }) => (
        <g key={key}>
          <path
            data-map-edge={leaving ? undefined : ''}
            className={`map-edge ${leaving ? 'map-animate-edge-retract' : 'map-animate-edge-draw'}`}
            d={e.d}
            pathLength={1}
            style={{ stroke: e.color, opacity: 0.85 }}
            strokeWidth={width * 1.4}
          />
          {!leaving && (
            <path
              className="map-edge-flow"
              d={e.d}
              strokeWidth={width}
              style={
                {
                  strokeDasharray: `${2 / k} ${8 / k}`,
                  '--flow': `${10 / k}px`,
                } as CSSProperties
              }
            />
          )}
        </g>
      ))}
    </g>
  );
}
