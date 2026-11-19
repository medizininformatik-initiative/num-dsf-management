/**
 * mapGeometry.ts – Pure geometry for the network map: city buckets and their
 * placement (single pins vs. city clusters), the worst certificate status of
 * a group, the fan-out ring of an expanded cluster, the zoom/pan view maths
 * and directional keyboard navigation between nodes.
 * Coordinates are in the map's SVG user space (viewBox 0 0 700 800); fan-out
 * offsets are in screen pixels because markers keep their on-screen size.
 * Dependencies: network.api types, lib/germanCities, GeoMapCluster key.
 */
import type { MapClusterGroup, MapOrganization } from '../../api/network.api';
import { cityBucketKey, getPinCoord } from '../../lib/germanCities';

export const MAP_WIDTH = 700;
export const MAP_HEIGHT = 800;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
/** Zoom used when focusing a selected organization or cluster. */
export const FOCUS_ZOOM = 2.2;
/** Id of the soft radial shadow under markers (defined once by GeoMap). */
export const PIN_SHADOW_GRADIENT_ID = 'map-pin-shadow';

/** Up to two initials from an organization's name (or identifier). */
export function initialsOf(org: Pick<MapOrganization, 'name' | 'identifier'>): string {
  return (org.name || org.identifier)
    .split(/[\s\-.]+/)
    .slice(0, 2)
    .map((s) => s[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const STATUS_PRIORITY: Record<MapOrganization['cert_status'], number> = {
  EXPIRED: 4,
  EXPIRING: 3,
  NONE: 2,
  VALID: 1,
};

/** Worst certificate status (EXPIRED > EXPIRING > NONE > VALID) of a group. */
export function worstStatus(orgs: MapOrganization[]): MapOrganization['cert_status'] {
  let worst: MapOrganization['cert_status'] = 'VALID';
  for (const o of orgs)
    if (STATUS_PRIORITY[o.cert_status] > STATUS_PRIORITY[worst]) worst = o.cert_status;
  return worst;
}

export function clusterKeyOf(group: Pick<MapClusterGroup, 'city' | 'country_code'>): string {
  return `__cluster__${cityBucketKey(group.city, group.country_code)}`;
}

/** The city group behind a cluster key, or null when the key is no cluster. */
export function clusterGroupFor(
  key: string | null,
  organizations: MapOrganization[],
): MapClusterGroup | null {
  if (!key || !key.startsWith('__cluster__')) return null;
  const bucket = key.slice('__cluster__'.length);
  const members = organizations.filter((o) => cityBucketKey(o.city, o.country_code) === bucket);
  if (members.length === 0) return null;
  const first = members[0];
  return {
    city: first.city,
    country_code: first.country_code,
    members,
    worstStatus: worstStatus(members),
  };
}

export function isOnMap(o: Pick<MapOrganization, 'country_code'>): boolean {
  return (o.country_code ?? 'DE') === 'DE';
}

export interface PlacedPin {
  kind: 'pin';
  key: string;
  org: MapOrganization;
  x: number;
  y: number;
  known: boolean;
}
export interface PlacedCluster {
  kind: 'cluster';
  key: string;
  group: MapClusterGroup; // visible members only
  totalMembers: number; // unfiltered count
  x: number;
  y: number;
}
export type Placed = PlacedPin | PlacedCluster;

function bucketByCity(orgs: MapOrganization[]): Map<string, MapOrganization[]> {
  const buckets = new Map<string, MapOrganization[]>();
  for (const o of orgs) {
    const key = cityBucketKey(o.city, o.country_code);
    const list = buckets.get(key) ?? [];
    list.push(o);
    buckets.set(key, list);
  }
  return buckets;
}

/**
 * Places the visible German organizations: a city with one site (counting the
 * unfiltered set) becomes a pin, a city with several sites a cluster. Sorted
 * north to south so a staggered entrance sweeps down the map.
 */
export function placeOrganizations(visible: MapOrganization[], all: MapOrganization[]): Placed[] {
  const visibleBuckets = bucketByCity(visible.filter(isOnMap));
  const totalBuckets = bucketByCity(all.filter(isOnMap));
  const out: Placed[] = [];
  for (const [bucketKey, members] of visibleBuckets) {
    const totalMembers = (totalBuckets.get(bucketKey) ?? members).length;
    const first = members[0];
    const { coord, known } = getPinCoord(first.city, first.postal_code);
    if (totalMembers >= 2) {
      const group: MapClusterGroup = {
        city: first.city,
        country_code: first.country_code,
        members,
        worstStatus: worstStatus(members),
      };
      out.push({
        kind: 'cluster',
        key: clusterKeyOf(group),
        group,
        totalMembers,
        x: coord[0],
        y: coord[1],
      });
    } else {
      out.push({ kind: 'pin', key: first.identifier, org: first, x: coord[0], y: coord[1], known });
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Screen-pixel offsets of n members fanned out on a ring around a cluster. */
export function fanOutOffsets(n: number): [number, number][] {
  if (n <= 0) return [];
  const radius = Math.max(40, (n * 32) / (2 * Math.PI));
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)];
  });
}

export interface MapView {
  k: number; // zoom factor
  tx: number; // translation in SVG units
  ty: number;
}

export const FIT_VIEW: MapView = { k: 1, tx: 0, ty: 0 };

const PAN_SLACK = 80;

/** Clamps zoom to [ZOOM_MIN, ZOOM_MAX] and keeps the map within reach. */
export function clampView(v: MapView): MapView {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k));
  const clampAxis = (t: number, size: number) =>
    Math.min(PAN_SLACK, Math.max(size - size * k - PAN_SLACK, t));
  return { k, tx: clampAxis(v.tx, MAP_WIDTH), ty: clampAxis(v.ty, MAP_HEIGHT) };
}

/** View that centres the SVG point (x, y) at zoom k. */
export function focusView(x: number, y: number, k: number): MapView {
  return clampView({ k, tx: MAP_WIDTH / 2 - k * x, ty: MAP_HEIGHT / 2 - k * y });
}

/** Zooms by `factor` keeping the SVG point (px, py) fixed on screen. */
export function zoomAround(v: MapView, factor: number, px: number, py: number): MapView {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * factor));
  const ratio = k / v.k;
  return clampView({ k, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio });
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface NodePoint {
  id: string;
  x: number;
  y: number;
}

/**
 * The nearest node in a direction: candidates must lie within a 45° cone
 * around it; distance along the axis counts once, sideways drift twice.
 */
export function nearestInDirection(
  from: NodePoint,
  nodes: NodePoint[],
  dir: Direction,
): NodePoint | null {
  let best: NodePoint | null = null;
  let bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === from.id) continue;
    const dx = n.x - from.x;
    const dy = n.y - from.y;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0 || across > along) continue;
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}
