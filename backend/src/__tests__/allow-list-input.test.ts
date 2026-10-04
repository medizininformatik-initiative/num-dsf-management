/**
 * allow-list-input.test.ts – A stored bundle-version input rebuilds the same
 * receiver view as the live input it was taken from, for every receiver.
 * Pure test: no database.
 * Dependencies: lib/allowListBundle, lib/allowListInput
 */
import crypto from 'crypto';
import { buildAllowListBundle, type AllowListMember } from '../lib/allowListBundle';
import {
  fullViewInput,
  parseAllowListInput,
  receiverViewInput,
  serializeAllowListInput,
  type StoredAllowListInput,
} from '../lib/allowListInput';

const HUB = 'hub.example.de';
const thumb = (s: string) => crypto.createHash('sha512').update(s).digest('hex');

function member(identifier: string, roles: string[], removedParent?: string): AllowListMember {
  const endpoint = `dsf.${identifier}`;
  return {
    identifier,
    name: `Klinik ${identifier}`,
    thumbprints: [thumb(identifier)],
    endpoints: [{ identifier: endpoint, name: null, address: `https://${endpoint}/fhir` }],
    affiliations: [{ parent: HUB, endpoint, roles }],
    removedAffiliations: removedParent ? [{ parent: removedParent, endpoint }] : [],
  };
}

const live: StoredAllowListInput = {
  members: [
    member('a.example.de', ['DIC']),
    member('b.example.de', ['DIC', 'HRP'], 'old-hub.example.de'),
    member('c.example.de', ['HRP']),
  ],
  removed: [
    {
      identifier: 'gone.example.de',
      endpoints: ['dsf.gone.example.de'],
      affiliations: [{ parent: HUB, endpoint: 'dsf.gone.example.de' }],
    },
  ],
  parentNames: { [HUB]: 'Hub', 'old-hub.example.de': 'Old Hub' },
};

// Deterministic ids so two renderings are comparable entry by entry.
const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};

describe('stored allow-list input', () => {
  const stored = parseAllowListInput(serializeAllowListInput(live));

  it('survives a serialization round trip unchanged', () => {
    expect(stored).toEqual(live);
  });

  it.each(['a.example.de', 'b.example.de', 'c.example.de'])(
    'rebuilds the receiver view of %s identically to the live view',
    (receiverOrg) => {
      const endpoint = `dsf.${receiverOrg}`;
      const self = live.members.find((m) => m.identifier === receiverOrg)!;
      const liveInput = {
        members: live.members.filter((m) => m.identifier !== receiverOrg),
        removed: live.removed,
        parentNames: new Map(Object.entries(live.parentNames)),
        receiver: {
          organization: receiverOrg,
          endpoint,
          affiliations: self.affiliations.map((a) => ({ parent: a.parent, roles: a.roles })),
          removedAffiliations: self.removedAffiliations.map((a) => ({ parent: a.parent })),
        },
      };
      expect(buildAllowListBundle(receiverViewInput(stored, receiverOrg, endpoint), ids())).toEqual(
        buildAllowListBundle(liveInput, ids()),
      );
    },
  );

  it('leaves out the receiver itself and keeps its affiliations conditional', () => {
    const bundle = buildAllowListBundle(
      receiverViewInput(stored, 'b.example.de', 'dsf.b.example.de'),
      ids(),
    );
    const urls = (bundle.entry ?? []).map((e) => e.request.url);
    expect(urls.some((u) => u.startsWith('Organization?') && u.endsWith('|b.example.de'))).toBe(
      false,
    );
    expect(
      urls.some(
        (u) => u.includes('participating-organization:identifier') && u.includes('|b.example.de&'),
      ),
    ).toBe(true);
    expect(
      urls
        .filter((u) => u.startsWith('OrganizationAffiliation'))
        .some((u) => u.includes('old-hub')),
    ).toBe(true);
  });

  it('gives a receiver that is not approved no affiliations and every member', () => {
    const view = receiverViewInput(stored, 'new.example.de', 'dsf.new.example.de');
    expect(view.receiver?.affiliations).toEqual([]);
    expect(view.members).toHaveLength(3);
  });

  it('renders the full view from the stored input like from the live one', () => {
    expect(buildAllowListBundle(fullViewInput(stored), ids())).toEqual(
      buildAllowListBundle(fullViewInput(live), ids()),
    );
  });

  it('rejects corrupt stored input', () => {
    expect(() => parseAllowListInput('not json')).toThrow('INPUT_CORRUPT');
    expect(() => parseAllowListInput('{"members":[]}')).toThrow('INPUT_CORRUPT');
  });
});
