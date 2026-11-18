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
});

describe('withRetiredAffiliations', () => {
  const previous = [{ parent: HUB, member: 'm.example.de', endpoint: 'old.m.example.de' }];

  it('moved endpoint: DELETE old, PUT new', () => {
    const urls = methodsAndUrls(
      withRetiredAffiliations(
        input([member('m.example.de', 'new.m.example.de', ['old.m.example.de'])]),
        previous,
      ),
    );
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).toContain(`PUT ${newUrl}`);
  });

  it('unchanged affiliation: no DELETE, and the input object is returned as is', () => {
    const current = input([member('m.example.de', 'old.m.example.de')]);
    expect(withRetiredAffiliations(current, previous)).toBe(current);
    expect(methodsAndUrls(current).some((u) => u.startsWith('DELETE'))).toBe(false);
  });

  it('keeps the DELETE in later versions that build on a stored version', () => {
    const v2 = withRetiredAffiliations(
      input([member('m.example.de', 'new.m.example.de')]),
      previous,
    );
    // v3: its history is v1 (old PUT) and v2 (new PUT, old DELETE).
    const v3 = withRetiredAffiliations(input([member('m.example.de', 'new.m.example.de')]), [
      ...previous,
      ...publishedAffiliations(JSON.stringify(buildAllowListBundle(fullViewInput(v2)))),
    ]);
    expect(methodsAndUrls(v3)).toContain(`DELETE ${oldUrl}`);
    expect(methodsAndUrls(v3).filter((u) => u === `DELETE ${oldUrl}`)).toHaveLength(1);
  });

  it('does not duplicate an already removed affiliation', () => {
    const m = member('m.example.de', 'new.m.example.de');
    m.removedAffiliations = [{ parent: HUB, endpoint: 'old.m.example.de' }];
    const current = input([m]);
    expect(withRetiredAffiliations(current, previous)).toBe(current);
  });

  it('a withdrawn member is deleted through its removal, once', () => {
    const removed = [
      { identifier: 'm.example.de', endpoints: ['new.m.example.de'], affiliations: [] },
    ];
    const urls = methodsAndUrls(withRetiredAffiliations(input([], removed), previous));
    expect(urls.filter((u) => u === `DELETE ${oldUrl}`)).toHaveLength(1);
  });

  it('ignores organizations that are neither member nor withdrawn', () => {
    const current = input([member('other.example.de', 'e.other.example.de')]);
    expect(withRetiredAffiliations(current, previous)).toBe(current);
  });

  it('does not delete an affiliation an old version published that is active again', () => {
    const current = input([member('m.example.de', 'old.m.example.de')]);
    const urls = methodsAndUrls(withRetiredAffiliations(current, previous));
    expect(urls).toContain(`PUT ${oldUrl}`);
    expect(urls).not.toContain(`DELETE ${oldUrl}`);
  });

  it('receiver view: its own old endpoint is deleted, the new one published', () => {
    const stored = withRetiredAffiliations(
      input([member('m.example.de', 'new.m.example.de', ['old.m.example.de'])]),
      previous,
    );
    const bundle = buildAllowListBundle(
      receiverViewInput(stored, 'm.example.de', 'new.m.example.de'),
    );
    const urls = (bundle.entry ?? []).map((e) => `${e.request.method} ${e.request.url}`);
    expect(urls).toContain(`DELETE ${oldUrl}`);
    expect(urls).toContain(`PUT ${newUrl}`);
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
