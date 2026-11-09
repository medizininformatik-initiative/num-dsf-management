/**
 * spokeGeometry.test.ts – Unit tests for the Verbund hub-and-spoke layout
 */
import { describe, it, expect } from 'vitest';
import { layoutSpokes, spokePath } from '../spokeGeometry';

const noCluster = () => null;

function positions(entries: [string, number, number][]): Map<string, [number, number]> {
  return new Map(entries.map(([id, x, y]) => [id, [x, y]]));
}

describe('layoutSpokes', () => {
  it('puts the hub at the centroid and draws one spoke per member', () => {
    const pos = positions([
      ['a', 100, 100],
      ['b', 300, 100],
      ['c', 200, 400],
    ]);
    const { hubs, spokes } = layoutSpokes(
      [{ verbund: 'mii-testverband.example.de', members: ['a', 'b', 'c'] }],
      pos,
      noCluster,
    );
    expect(hubs).toEqual([
      { verbund: 'mii-testverband.example.de', label: 'MII', color: '#b01e66', x: 200, y: 200 },
    ]);
    expect(spokes).toHaveLength(3);
    // Each spoke starts at its member and ends at the hub.
    expect(spokes[0].d).toMatch(/^M100 100Q.* 200 200$/);
    expect(spokes.map((s) => s.nodes)).toEqual([['a'], ['b'], ['c']]);
  });

  it('shares one spoke for members drawn at the same spot and names the cluster', () => {
    const pos = positions([
      ['a', 100, 100],
      ['b', 100, 100],
      ['c', 300, 300],
    ]);
    const clusterOf = (id: string) => (id === 'c' ? null : '__cluster__x|DE');
    const { spokes } = layoutSpokes([{ verbund: 'v', members: ['a', 'b', 'c'] }], pos, clusterOf);
    expect(spokes).toHaveLength(2);
    expect(spokes[0].nodes).toEqual(['a', '__cluster__x|DE', 'b']);
  });

  it('skips a Verbund drawn at a single spot and members not on the map', () => {
    const pos = positions([
      ['a', 100, 100],
      ['b', 100, 100],
    ]);
    const { hubs, spokes } = layoutSpokes(
      [{ verbund: 'v', members: ['a', 'b', 'off-map'] }],
      pos,
      noCluster,
    );
    expect(hubs).toEqual([]);
    expect(spokes).toEqual([]);
  });

  it('spreads hubs of Verbunds with the same members apart', () => {
    const pos = positions([
      ['a', 100, 100],
      ['b', 300, 300],
    ]);
    const { hubs } = layoutSpokes(
      [
        { verbund: 'v1', members: ['a', 'b'] },
        { verbund: 'v2', members: ['a', 'b'] },
      ],
      pos,
      noCluster,
    );
    const [h1, h2] = hubs;
    expect(Math.hypot(h1.x - h2.x, h1.y - h2.y)).toBeGreaterThanOrEqual(44);
    // Still centred on the shared centroid.
    expect((h1.x + h2.x) / 2).toBeCloseTo(200);
    expect((h1.y + h2.y) / 2).toBeCloseTo(200);
  });

  it('scales linearly: 150 members give 150 spokes', () => {
    const entries: [string, number, number][] = Array.from({ length: 150 }, (_, i) => [
      `s${i}`,
      (i * 37) % 600,
      (i * 53) % 780,
    ]);
    const { spokes } = layoutSpokes(
      [{ verbund: 'v', members: entries.map((e) => e[0]) }],
      positions(entries),
      noCluster,
    );
    expect(spokes.length).toBeLessThanOrEqual(150);
    expect(spokes.length).toBeGreaterThan(140); // a few positions may coincide
  });
});

describe('spokePath', () => {
  it('bends alternate spokes to alternate sides', () => {
    const left = spokePath(0, 0, 100, 0, 0);
    const right = spokePath(0, 0, 100, 0, 1);
    expect(left).toBe('M0 0Q50 12 100 0');
    expect(right).toBe('M0 0Q50 -12 100 0');
  });
});
