/**
 * allow-list-history.test.ts – Affiliations that an earlier version published
 * and the current state lacks are deleted again (moved endpoint), in every
 * later version and in the receiver view. Pure test: no database.
 * Dependencies: lib/allowListBundle, lib/allowListHistory, lib/allowListInput
 */
import crypto from 'crypto';
import {
  affiliationUrl,
  buildAllowListBundle,
  endpointUrl,
  parseAffiliationUrl,
  type AllowListMember,
} from '../lib/allowListBundle';
import { publishedAffiliations, withRetiredAffiliations } from '../lib/allowListHistory';
import { fullViewInput, receiverViewInput, type StoredAllowListInput } from '../lib/allowListInput';

const HUB = 'hub.example.de';
const thumb = (s: string) => crypto.createHash('sha512').update(s).digest('hex');

function member(identifier: string, endpoint: string, extra: string[] = []): AllowListMember {
  return {
    identifier,
    name: identifier,
    thumbprints: [thumb(identifier)],
    endpoints: [endpoint, ...extra].map((e) => ({
      identifier: e,
      name: null,
      address: `https://${e}/fhir`,
    })),
    affiliations: [{ parent: HUB, endpoint, roles: ['DIC'] }],
    removedAffiliations: [],
  };
}

const input = (members: AllowListMember[], removed: StoredAllowListInput['removed'] = []) => ({
  members,
  removed,
  parentNames: { [HUB]: 'Hub' },
});

const methodsAndUrls = (stored: StoredAllowListInput) =>
  (buildAllowListBundle(fullViewInput(stored)).entry ?? []).map(
    (e) => `${e.request.method} ${e.request.url}`,
  );

const oldUrl = affiliationUrl(HUB, 'm.example.de', 'old.m.example.de');
const newUrl = affiliationUrl(HUB, 'm.example.de', 'new.m.example.de');

describe('parseAffiliationUrl', () => {
  it('inverts affiliationUrl', () => {
    expect(parseAffiliationUrl(oldUrl)).toEqual({
      parent: HUB,
      member: 'm.example.de',
      endpoint: 'old.m.example.de',
    });
  });

  it('rejects other URLs', () => {
    expect(parseAffiliationUrl('Organization?identifier=x|y')).toBeNull();
    expect(parseAffiliationUrl(`${oldUrl}&x=1`)).toBeNull();
  });
});

describe('publishedAffiliations', () => {
  it('reads the PUT affiliations of a stored bundle and ignores DELETEs and garbage', () => {
    const bundle = JSON.stringify({
      entry: [
        { request: { method: 'PUT', url: oldUrl } },
        { request: { method: 'DELETE', url: newUrl } },
        { request: { method: 'PUT', url: 'Organization?identifier=x|y' } },
      ],
    });
    expect(publishedAffiliations(bundle)).toEqual([
      { parent: HUB, member: 'm.example.de', endpoint: 'old.m.example.de' },
    ]);
    expect(publishedAffiliations('not json')).toEqual([]);
    expect(publishedAffiliations('{}')).toEqual([]);
  });

  it('does not throw on a null entry element or a non-array entry', () => {
    expect(publishedAffiliations(JSON.stringify({ entry: [null] }))).toEqual([]);
    expect(publishedAffiliations(JSON.stringify({ entry: { request: {} } }))).toEqual([]);
    expect(publishedAffiliations(JSON.stringify({ entry: 'x' }))).toEqual([]);
    expect(publishedAffiliations('null')).toEqual([]);
  });
});

describe('withRetiredAffiliations', () => {
  const previous = [{ parent: HUB, member: 'm.example.de', endpoint: 'old.m.example.de' }];
  const moved = () => input([member('m.example.de', 'new.m.example.de')]);

  it('moved endpoint: DELETE old, PUT new', () => {
    const urls = methodsAndUrls(withRetiredAffiliations(moved(), previous));
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).toContain(`PUT ${newUrl}`);
  });

  it('moved endpoint: the old Endpoint is deleted too (DSF refuses a duplicate address)', () => {
    // The new endpoint may keep the old address; DSF rejects the create while the old
    // Endpoint exists, and deletes run before creates within the transaction.
    const urls = methodsAndUrls(withRetiredAffiliations(moved(), previous));
    expect(urls).toContain(`DELETE ${endpointUrl('old.m.example.de')}`);
    expect(urls).not.toContain(`DELETE ${endpointUrl('new.m.example.de')}`);
  });

  it('unchanged affiliation: no DELETE, and the input object is returned as is', () => {
    const current = input([member('m.example.de', 'old.m.example.de')]);
    expect(withRetiredAffiliations(current, previous)).toBe(current);
    expect(methodsAndUrls(current).some((u) => u.startsWith('DELETE'))).toBe(false);
  });

  it('in-place edit e1 -> e2 while the member keeps e1: DELETE the old affiliation, keep the endpoint', () => {
    const current = input([member('m.example.de', 'new.m.example.de', ['old.m.example.de'])]);
    const urls = methodsAndUrls(withRetiredAffiliations(current, previous));
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).toContain(`PUT ${newUrl}`);
    expect(urls).not.toContain(`DELETE ${endpointUrl('old.m.example.de')}`);
    expect(urls).toContain(`PUT ${endpointUrl('old.m.example.de')}`);
  });

  it('in-place parent change hub -> hub2 on the same endpoint: DELETE the old triple only', () => {
    const m = member('m.example.de', 'old.m.example.de');
    m.affiliations = [{ parent: 'hub2.example.de', endpoint: 'old.m.example.de', roles: ['DIC'] }];
    const urls = methodsAndUrls(withRetiredAffiliations(input([m]), previous));
    const hub2Url = affiliationUrl('hub2.example.de', 'm.example.de', 'old.m.example.de');
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).toContain(`PUT ${hub2Url}`);
    expect(urls).not.toContain(`DELETE ${endpointUrl('old.m.example.de')}`);
  });

  it('an endpoint now owned by another organization is not deleted', () => {
    const other = member('o.example.de', 'old.m.example.de');
    const stored = withRetiredAffiliations(
      input([member('m.example.de', 'new.m.example.de'), other]),
      previous,
    );
    const urls = methodsAndUrls(stored);
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).not.toContain(`DELETE ${endpointUrl('old.m.example.de')}`);
    const m = stored.members.find((x) => x.identifier === 'm.example.de')!;
    expect(m.removedEndpoints ?? []).toEqual([]);
  });

  it('keeps the DELETE in later versions that build on a stored version', () => {
    const v2 = withRetiredAffiliations(moved(), previous);
    // v3: its history is v1 (old PUT) and v2 (new PUT, old DELETE).
    const v3 = withRetiredAffiliations(moved(), [
      ...previous,
      ...publishedAffiliations(JSON.stringify(buildAllowListBundle(fullViewInput(v2)))),
    ]);
    expect(methodsAndUrls(v3).filter((u) => u === `DELETE ${oldUrl}`)).toHaveLength(1);
  });

  it('does not duplicate an already removed affiliation', () => {
    const m = member('m.example.de', 'new.m.example.de');
    m.removedAffiliations = [{ parent: HUB, endpoint: 'old.m.example.de' }];
    const [retired] = withRetiredAffiliations(input([m]), previous).members;
    expect(retired.removedAffiliations).toHaveLength(1);
    expect(retired.removedEndpoints).toEqual(['old.m.example.de']);
  });

  it('a withdrawn member also loses what earlier versions published for it', () => {
    const removed = [
      {
        identifier: 'm.example.de',
        endpoints: ['new.m.example.de'],
        affiliations: [{ parent: HUB, endpoint: 'new.m.example.de' }],
      },
    ];
    const urls = methodsAndUrls(withRetiredAffiliations(input([], removed), previous));
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).toContain(`DELETE ${endpointUrl('old.m.example.de')}`);
    expect(urls).toContain(`DELETE ${newUrl}`);
  });

  it('a withdrawn member: an endpoint now owned by another member is kept', () => {
    const removed = [{ identifier: 'm.example.de', endpoints: [], affiliations: [] }];
    const stored = withRetiredAffiliations(
      input([member('o.example.de', 'old.m.example.de')], removed),
      previous,
    );
    const urls = methodsAndUrls(stored);
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).not.toContain(`DELETE ${endpointUrl('old.m.example.de')}`);
  });

  it('a withdrawn member: applying twice changes nothing more', () => {
    const removed = [{ identifier: 'm.example.de', endpoints: [], affiliations: [] }];
    const once = withRetiredAffiliations(input([], removed), previous);
    expect(withRetiredAffiliations(once, previous)).toBe(once);
  });

  it('a member temporarily absent from the input gets no DELETE', () => {
    const current = input([member('other.example.de', 'e.other.example.de')]);
    expect(withRetiredAffiliations(current, previous)).toBe(current);
  });

  it('receiver view: its own old endpoint is deleted, the new one published', () => {
    const bundle = buildAllowListBundle(
      receiverViewInput(
        withRetiredAffiliations(moved(), previous),
        'm.example.de',
        'new.m.example.de',
      ),
    );
    const urls = (bundle.entry ?? []).map((e) => `${e.request.method} ${e.request.url}`);
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).toContain(`PUT ${newUrl}`);
  });

  it('receiver view: a soft-deleted affiliation of a still existing other endpoint is not deleted', () => {
    const m = member('m.example.de', 'new.m.example.de', ['old.m.example.de']);
    m.removedAffiliations = [{ parent: HUB, endpoint: 'old.m.example.de' }];
    const bundle = buildAllowListBundle(
      receiverViewInput(input([m]), 'm.example.de', 'new.m.example.de'),
    );
    expect((bundle.entry ?? []).map((e) => e.request.url)).not.toContain(oldUrl);
  });

  it('receiver view: other members still get their own DELETE', () => {
    const stored = withRetiredAffiliations(
      input([
        member('m.example.de', 'new.m.example.de'),
        member('r.example.de', 'dsf.r.example.de'),
      ]),
      previous,
    );
    const bundle = buildAllowListBundle(
      receiverViewInput(stored, 'r.example.de', 'dsf.r.example.de'),
    );
    expect((bundle.entry ?? []).map((e) => `${e.request.method} ${e.request.url}`)).toContain(
      `DELETE ${oldUrl}`,
    );
  });
});
