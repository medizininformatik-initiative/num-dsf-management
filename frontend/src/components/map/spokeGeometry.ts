/**
 * spokeGeometry.ts – Pure layout of the Verbund hub-and-spoke lines: one hub
 * per Verbund at the centroid of its members' positions, and one gently
 * curved spoke from every member position to its hub. Members drawn at the
 * same spot (a city cluster) share one spoke. Hubs that would sit on top of
 * each other (Verbunds with largely the same members) are spread on a small
 * circle around their common centre so every label stays readable.
 * Coordinates are map units (viewBox 0 0 700 800).
 * Dependencies: lib/peerEdges.
 */
import { verbundColor, verbundLabel, type VerbundGroup } from '../../lib/peerEdges';

export interface Hub {
  verbund: string;
  label: string;
  color: string;
  x: number;
  y: number;
}

export interface Spoke {
  key: string;
  verbund: string;
  color: string;
  /** Path from the member position to the hub (draws away from the member). */
  d: string;
  /** Node ids at the member end: organization identifiers and cluster keys. */
  nodes: string[];
}

/** Hubs closer than this (map units) are spread apart. */
const HUB_MIN_GAP = 44;
const HUB_SPREAD_RADIUS = 30;
const BEND = 0.12;

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

export function spokePath(x1: number, y1: number, x2: number, y2: number, idx: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const offset = BEND * len * (idx % 2 === 0 ? 1 : -1);
  const cx = (x1 + x2) / 2 + (-dy / len) * offset;
  const cy = (y1 + y2) / 2 + (dx / len) * offset;
  return `M${round(x1)} ${round(y1)}Q${round(cx)} ${round(cy)} ${round(x2)} ${round(y2)}`;
}

/** Moves hubs that crowd each other onto a circle around their mean. */
function spreadHubs(hubs: Hub[]): void {
  const done = new Set<number>();
  for (let i = 0; i < hubs.length; i++) {
    if (done.has(i)) continue;
    const crowd = [i];
    for (let j = i + 1; j < hubs.length; j++) {
      if (done.has(j)) continue;
      if (crowd.some((c) => Math.hypot(hubs[c].x - hubs[j].x, hubs[c].y - hubs[j].y) < HUB_MIN_GAP))
        crowd.push(j);
    }
    crowd.forEach((c) => done.add(c));
    if (crowd.length < 2) continue;
    const mx = crowd.reduce((s, c) => s + hubs[c].x, 0) / crowd.length;
    const my = crowd.reduce((s, c) => s + hubs[c].y, 0) / crowd.length;
    crowd.forEach((c, n) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * n) / crowd.length;
      hubs[c].x = mx + HUB_SPREAD_RADIUS * Math.cos(angle);
      hubs[c].y = my + HUB_SPREAD_RADIUS * Math.sin(angle);
    });
  }
}

export function layoutSpokes(
  groups: VerbundGroup[],
  endpointPos: Map<string, [number, number]>,
  clusterKeyForOrg: (orgId: string) => string | null,
): { hubs: Hub[]; spokes: Spoke[] } {
  const hubs: Hub[] = [];
  const memberSpots: Map<string, { x: number; y: number; nodes: string[] }>[] = [];
  for (const g of groups) {
    const spots = new Map<string, { x: number; y: number; nodes: string[] }>();
    for (const id of g.members) {
      const pos = endpointPos.get(id);
      if (!pos) continue;
      const spotKey = `${pos[0]},${pos[1]}`;
      const spot = spots.get(spotKey) ?? { x: pos[0], y: pos[1], nodes: [] };
      spot.nodes.push(id);
      const cluster = clusterKeyForOrg(id);
      if (cluster && !spot.nodes.includes(cluster)) spot.nodes.push(cluster);
      spots.set(spotKey, spot);
    }
    // A Verbund drawn at one spot only (a single site, or all in one city)
    // has nothing to connect.
    if (spots.size < 2) continue;
    let sx = 0;
    let sy = 0;
    for (const s of spots.values()) {
      sx += s.x;
      sy += s.y;
    }
    hubs.push({
      verbund: g.verbund,
      label: verbundLabel(g.verbund),
      color: verbundColor(g.verbund),
      x: sx / spots.size,
      y: sy / spots.size,
    });
    memberSpots.push(spots);
  }
  spreadHubs(hubs);

  const spokes: Spoke[] = [];
  hubs.forEach((hub, h) => {
    let idx = 0;
    for (const [spotKey, spot] of memberSpots[h]) {
      spokes.push({
        key: `${hub.verbund}|${spotKey}`,
        verbund: hub.verbund,
        color: hub.color,
        d: spokePath(spot.x, spot.y, hub.x, hub.y, idx++),
        nodes: spot.nodes,
      });
    }
  });
  return { hubs, spokes };
}
