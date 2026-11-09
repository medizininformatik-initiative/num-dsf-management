/**
 * peerEdges.test.ts – Unit tests for Verbund grouping (hub-and-spoke model)
 */
import { describe, it, expect } from 'vitest';
import { deriveVerbunds, verbundsByOrg } from '../peerEdges';
import type { MapOrganization } from '../../api/network.api';

function org(identifier: string, parents: string[]): MapOrganization {
  return {
    identifier,
    name: identifier,
    active: true,
    city: 'Berlin',
    country_code: 'DE',
    cert_status: 'VALID',
    endpoints: [],
    memberships: parents.map((p) => ({ parent_organization: p, roles: [] })),
  };
}

describe('deriveVerbunds', () => {
  it('returns no groups for orgs without memberships', () => {
    expect(deriveVerbunds([org('a', []), org('b', [])])).toEqual([]);
  });

  it('groups members by parent organization, in input order', () => {
    expect(deriveVerbunds([org('a', ['mii']), org('b', ['mii'])])).toEqual([
      { verbund: 'mii', members: ['a', 'b'] },
    ]);
  });

  it('lists an org in every Verbund it belongs to', () => {
    const groups = deriveVerbunds([org('a', ['mii', 'num']), org('b', ['num'])]);
    expect(groups).toEqual([
      { verbund: 'mii', members: ['a'] },
      { verbund: 'num', members: ['a', 'b'] },
    ]);
  });

  it('lists an org once even with two memberships under the same parent', () => {
    const groups = deriveVerbunds([org('a', ['mii', 'mii']), org('b', ['mii', 'mii'])]);
    expect(groups).toEqual([{ verbund: 'mii', members: ['a', 'b'] }]);
  });

  it('grows linearly: n members, n entries (no pairwise expansion)', () => {
    const many = Array.from({ length: 52 }, (_, i) => org(`o${i}`, ['mii']));
    const [group] = deriveVerbunds(many);
    expect(group.members).toHaveLength(52);
  });
});

describe('verbundsByOrg', () => {
  it('maps each org to the Verbunds it belongs to', () => {
    const map = verbundsByOrg(deriveVerbunds([org('a', ['mii', 'num']), org('b', ['num'])]));
    expect(map.get('a')).toEqual(['mii', 'num']);
    expect(map.get('b')).toEqual(['num']);
    expect(map.get('c')).toBeUndefined();
  });
});
