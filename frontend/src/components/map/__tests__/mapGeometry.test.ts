import { describe, it, expect } from 'vitest';
import {
  FIT_VIEW,
  MAP_HEIGHT,
  MAP_WIDTH,
  ZOOM_MAX,
  clampView,
  clusterGroupFor,
  fanOutOffsets,
  focusView,
  initialsOf,
  nearestInDirection,
  placeOrganizations,
  worstStatus,
  zoomAround,
} from '../mapGeometry';
import type { MapOrganization } from '../../../api/network.api';

function org(
  id: string,
  city: string | null,
  over: Partial<MapOrganization> = {},
): MapOrganization {
  return {
    identifier: id,
    name: id,
    active: true,
    city,
    country_code: 'DE',
    cert_status: 'VALID',
    endpoints: [],
    memberships: [],
    ...over,
  };
}

describe('placeOrganizations', () => {
  it('places single-site cities as pins and multi-site cities as clusters, north first', () => {
    const placed = placeOrganizations(
      [
        org('a.example.de', 'München'),
        org('b.example.de', 'Hamburg'),
        org('c.example.de', 'Hamburg'),
      ],
      [
        org('a.example.de', 'München'),
        org('b.example.de', 'Hamburg'),
        org('c.example.de', 'Hamburg'),
      ],
    );
    expect(placed.map((p) => p.kind)).toEqual(['cluster', 'pin']); // Hamburg is north of Munich
    expect(placed[0].key).toBe('__cluster__hamburg|DE');
  });

  it('keeps a city a cluster when filters leave only one visible site', () => {
    const all = [org('b.example.de', 'Hamburg'), org('c.example.de', 'Hamburg')];
    const [only] = placeOrganizations([all[0]], all);
    expect(only.kind).toBe('cluster');
    expect(only.kind === 'cluster' && only.totalMembers).toBe(2);
  });

  it('leaves international organizations off the map', () => {
    expect(placeOrganizations([org('x.example.at', 'Wien', { country_code: 'AT' })], [])).toEqual(
      [],
    );
  });
});

describe('clusterGroupFor / worstStatus', () => {
  it('rebuilds the city group behind a cluster key with its worst status', () => {
    const list = [
      org('a.example.de', 'Berlin', { cert_status: 'EXPIRING' }),
      org('b.example.de', 'Berlin', { cert_status: 'EXPIRED' }),
      org('c.example.de', 'Köln'),
    ];
    const group = clusterGroupFor('__cluster__berlin|DE', list);
    expect(group?.members.map((m) => m.identifier)).toEqual(['a.example.de', 'b.example.de']);
    expect(group?.worstStatus).toBe('EXPIRED');
    expect(clusterGroupFor('a.example.de', list)).toBeNull();
    expect(worstStatus([org('n', null, { cert_status: 'NONE' })])).toBe('NONE');
  });
});

describe('fanOutOffsets', () => {
  it('spreads members evenly on a ring, starting at the top', () => {
    const offsets = fanOutOffsets(4);
    expect(offsets).toHaveLength(4);
    expect(offsets[0][0]).toBe(0);
    expect(offsets[0][1]).toBeLessThan(0);
    const radii = offsets.map(([x, y]) => Math.round(Math.hypot(x, y)));
    expect(new Set(radii).size).toBe(1);
  });

  it('widens the ring for many members', () => {
    const r = ([x, y]: [number, number]) => Math.hypot(x, y);
    expect(r(fanOutOffsets(20)[0])).toBeGreaterThan(r(fanOutOffsets(3)[0]));
  });
});

describe('view maths', () => {
  it('clamps zoom to the allowed range and keeps the map within reach', () => {
    expect(clampView({ k: 0.2, tx: 999, ty: -999 })).toEqual({ k: 1, tx: 80, ty: -80 });
    expect(clampView({ k: 99, tx: 0, ty: 0 }).k).toBe(ZOOM_MAX);
  });

  it('centres a point when focusing', () => {
    const v = focusView(MAP_WIDTH / 2, MAP_HEIGHT / 2, 2);
    expect(v.k).toBe(2);
    expect(v.tx).toBe(MAP_WIDTH / 2 - 2 * (MAP_WIDTH / 2));
    expect(v.ty).toBe(MAP_HEIGHT / 2 - 2 * (MAP_HEIGHT / 2));
  });

  it('keeps the anchor point fixed when zooming around it', () => {
    const v = zoomAround(FIT_VIEW, 2, 300, 400);
    // Screen position of the anchor: k * p + t stays the same.
    expect(2 * 300 + v.tx).toBeCloseTo(300);
    expect(2 * 400 + v.ty).toBeCloseTo(400);
  });
});

describe('nearestInDirection', () => {
  const nodes = [
    { id: 'c', x: 100, y: 100 },
    { id: 'e', x: 200, y: 110 },
    { id: 'far-e', x: 400, y: 100 },
    { id: 's', x: 105, y: 200 },
    { id: 'ne', x: 160, y: 20 },
  ];

  it('picks the closest node inside the direction cone', () => {
    expect(nearestInDirection(nodes[0], nodes, 'right')?.id).toBe('e');
    expect(nearestInDirection(nodes[0], nodes, 'down')?.id).toBe('s');
    expect(nearestInDirection(nodes[0], nodes, 'up')?.id).toBe('ne');
  });

  it('returns null when nothing lies that way', () => {
    expect(nearestInDirection(nodes[0], nodes, 'left')).toBeNull();
  });
});

describe('initialsOf', () => {
  it('takes the first letters of the first two name parts', () => {
    expect(initialsOf({ name: 'Uni Klinikum Muenster', identifier: 'ukm.de' })).toBe('UK');
    expect(initialsOf({ name: '', identifier: 'charite.de' })).toBe('CD');
  });
});
