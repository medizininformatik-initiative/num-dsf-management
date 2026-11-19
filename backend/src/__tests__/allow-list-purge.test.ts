/**
 * allow-list-purge.test.ts – The purge bundle (lib/allowListPurge): only conditional DELETEs in
 * the builder's URL format, for everything any stored version ever mentioned (also what a later
 * version deleted), without the receiver's own Organization and Endpoints, deduplicated and in a
 * stable, reference-safe order (affiliations, endpoints, organizations).
 * Dependencies: lib/allowListPurge, lib/allowListBundle
 */
import {
  affiliationUrl,
  buildAllowListBundle,
  endpointUrl,
  organizationUrl,
  type AllowListMember,
} from '../lib/allowListBundle';
import { buildPurgeBundle, purgeEntries } from '../lib/allowListPurge';

const member = (id: string, endpoint = `dsf.${id}`): AllowListMember => ({
  identifier: id,
  name: id,
  thumbprints: ['a'.repeat(128)],
  endpoints: [{ identifier: endpoint, name: null, address: `https://${endpoint}/fhir` }],
  affiliations: [{ parent: 'parent.example.de', endpoint, roles: ['DIC'] }],
  removedAffiliations: [],
});

const json = (members: AllowListMember[], removed: Parameters<typeof input>[1] = []) =>
  JSON.stringify(buildAllowListBundle(input(members, removed)));

function input(
  members: AllowListMember[],
  removed: Array<{
    identifier: string;
    endpoints: string[];
    affiliations: Array<{ parent: string; endpoint: string }>;
  }>,
) {
  return {
    members,
    removed,
    parentNames: new Map([['parent.example.de', 'Parent']]),
  };
}

const self = { organization: 'self.example.de', endpoints: ['dsf.self.example.de'] };
const urls = (b: ReturnType<typeof buildPurgeBundle>) => (b.entry ?? []).map((e) => e.request.url);

describe('purge bundle', () => {
  const v1 = json([member('self.example.de'), member('a.example.de'), member('b.example.de')]);

  it('contains only conditional DELETEs without a resource, in the builder URL format', () => {
    const bundle = buildPurgeBundle([v1], self);
    expect(bundle.type).toBe('transaction');
    for (const e of bundle.entry ?? []) {
      expect(e.request.method).toBe('DELETE');
      expect(e).toEqual({ request: { method: 'DELETE', url: e.request.url } });
    }
    expect(urls(bundle)).toEqual(
      expect.arrayContaining([
        organizationUrl('a.example.de'),
        endpointUrl('dsf.a.example.de'),
        affiliationUrl('parent.example.de', 'a.example.de', 'dsf.a.example.de'),
        organizationUrl('parent.example.de'),
      ]),
    );
  });

  it('leaves out the own organization and own endpoints but deletes the own affiliations', () => {
    const list = urls(buildPurgeBundle([v1], self));
    expect(list).not.toContain(organizationUrl('self.example.de'));
    expect(list).not.toContain(endpointUrl('dsf.self.example.de'));
    expect(list).toContain(
      affiliationUrl('parent.example.de', 'self.example.de', 'dsf.self.example.de'),
    );
  });

  it('includes what an earlier version published and a later one deleted', () => {
    const v2 = json(
      [member('self.example.de')],
      [
        {
          identifier: 'a.example.de',
          endpoints: ['dsf.a.example.de'],
          affiliations: [{ parent: 'parent.example.de', endpoint: 'dsf.a.example.de' }],
        },
      ],
    );
    const onlyOld = json([member('gone.example.de')]);
    const list = urls(buildPurgeBundle([onlyOld, v2], self));
    expect(list).toContain(organizationUrl('gone.example.de'));
    expect(list).toContain(organizationUrl('a.example.de'));
  });

  it('lists each URL once, affiliations before endpoints before organizations, sorted', () => {
    const list = urls(buildPurgeBundle([v1, v1], self));
    expect(new Set(list).size).toBe(list.length);
    const kind = (u: string) =>
      u.startsWith('OrganizationAffiliation') ? 0 : u.startsWith('Endpoint') ? 1 : 2;
    expect(list.map(kind)).toEqual([...list.map(kind)].sort());
    expect(urls(buildPurgeBundle([v1], self))).toEqual(urls(buildPurgeBundle([v1], self)));
  });

  it('compares the own identifiers case-insensitively', () => {
    const list = urls(
      buildPurgeBundle([v1], {
        organization: 'SELF.example.de',
        endpoints: ['DSF.self.example.de'],
      }),
    );
    expect(list).not.toContain(organizationUrl('self.example.de'));
    expect(list).not.toContain(endpointUrl('dsf.self.example.de'));
  });

  it('skips unreadable bundles and has no entry array when nothing is left to delete', () => {
    expect(purgeEntries(['not json', '{}'], self)).toEqual([]);
    const empty = buildPurgeBundle([json([member('self.example.de')])].slice(0, 0), self);
    expect(empty.entry).toBeUndefined();
  });
});
