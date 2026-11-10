/**
 * allow-list-incident-blocks.test.ts – An incident overrides the approved
 * state: a suspended organization is published as withdrawn, blocked
 * thumbprints are never published, and a member left without any thumbprint
 * is withdrawn instead of silently dropped.
 * Pure test: no database.
 * Dependencies: lib/allowListBundle (types), lib/allowListInput
 */
import type { AllowListMember } from '../lib/allowListBundle';
import { applyIncidentBlocks, type StoredAllowListInput } from '../lib/allowListInput';

const HUB = 'hub.example.de';

function member(identifier: string, thumbprints: string[]): AllowListMember {
  const endpoint = `dsf.${identifier}`;
  return {
    identifier,
    name: identifier,
    thumbprints,
    endpoints: [{ identifier: endpoint, name: null, address: `https://${endpoint}/fhir` }],
    affiliations: [{ parent: HUB, endpoint, roles: ['DIC'] }],
    removedAffiliations: [{ parent: 'old.example.de', endpoint }],
  };
}

const input: StoredAllowListInput = {
  members: [member('a.example.de', ['a1', 'a2']), member('b.example.de', ['b1'])],
  removed: [],
  parentNames: {},
};

describe('applyIncidentBlocks', () => {
  it('returns the input unchanged without suspensions or blocks', () => {
    expect(applyIncidentBlocks(input, new Set(), new Set())).toEqual(input);
  });

  it('withdraws a suspended organization with its endpoints and affiliations', () => {
    const out = applyIncidentBlocks(input, new Set(['a.example.de']), new Set());
    expect(out.members.map((m) => m.identifier)).toEqual(['b.example.de']);
    expect(out.removed).toEqual([
      {
        identifier: 'a.example.de',
        endpoints: ['dsf.a.example.de'],
        affiliations: [
          { parent: HUB, endpoint: 'dsf.a.example.de' },
          { parent: 'old.example.de', endpoint: 'dsf.a.example.de' },
        ],
      },
    ]);
  });

  it('strips blocked thumbprints and keeps the member while one is left', () => {
    const out = applyIncidentBlocks(input, new Set(), new Set(['a1']));
    expect(out.members.find((m) => m.identifier === 'a.example.de')?.thumbprints).toEqual(['a2']);
    expect(out.removed).toEqual([]);
  });

  it('withdraws a member whose every thumbprint is blocked', () => {
    const out = applyIncidentBlocks(input, new Set(), new Set(['b1']));
    expect(out.members.map((m) => m.identifier)).toEqual(['a.example.de']);
    expect(out.removed.map((r) => r.identifier)).toEqual(['b.example.de']);
  });

  it('does not withdraw the same organization twice', () => {
    const already = {
      ...input,
      removed: [{ identifier: 'a.example.de', endpoints: [], affiliations: [] }],
    };
    const out = applyIncidentBlocks(already, new Set(['a.example.de']), new Set());
    expect(out.removed.filter((r) => r.identifier === 'a.example.de')).toHaveLength(1);
  });
});
