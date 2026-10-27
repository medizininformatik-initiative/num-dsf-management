/**
 * allow-list-bundle.builder.test.ts – Pure tests for lib/allowListBundle.
 *
 * Golden test: fixtures/dsf-legacy-allow-list.json is an anonymized subset of
 * an allow list exported from the legacy portal's DSF test instance (same
 * entry shapes, key order and value formats; identifiers rewritten to
 * .example.de, telecom removed because this tool never publishes contact
 * data). The builder must produce identical entries for the same scenario.
 * Every bundle must also pass the DSF acceptance rules of the allow-list
 * process and the DSF FHIR server (helpers/dsfAllowListChecks).
 * Dependencies: lib/allowListBundle, helpers/dsfAllowListChecks, fs, path, crypto
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  buildAllowListBundle,
  type AllowListBundle,
  type AllowListInput,
  type AllowListMember,
} from '../lib/allowListBundle';
import { dsfAllowListViolations } from './helpers/dsfAllowListChecks';

interface Entry {
  fullUrl?: string;
  resource?: Record<string, unknown> & { resourceType: string };
  request: { method: string; url: string };
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'dsf-legacy-allow-list.json'), 'utf8'),
) as { entry: Entry[] } & Record<string, unknown>;

const MII = 'verbund-mii.example.de';
const NUM = 'verbund-num.example.de';
const EYE = 'verbund-eye.example.de';
const RECEIVER = 'klinik-empfang.example.de';
const RECEIVER_EP = 'dsf.klinik-empfang.example.de';

const thumb = (org: string, i: number) =>
  crypto.createHash('sha512').update(`thumbprint:${org}:${i}`).digest('hex');
const ep = (identifier: string) => ({
  identifier,
  name: null,
  address: `https://${identifier}/fhir`,
});

function member(
  identifier: string,
  name: string,
  thumbprints: number,
  endpoints: string[],
  affiliations: Array<[string, string, string[]]>,
  removed: Array<[string, string]> = [],
): AllowListMember {
  return {
    identifier,
    name,
    thumbprints: Array.from({ length: thumbprints }, (_, i) => thumb(identifier, i)),
    endpoints: endpoints.map(ep),
    affiliations: affiliations.map(([parent, endpoint, roles]) => ({ parent, endpoint, roles })),
    removedAffiliations: removed.map(([parent, endpoint]) => ({ parent, endpoint })),
  };
}

/** The scenario of the legacy fixture, expressed as builder input. */
function legacyScenario(): AllowListInput {
  return {
    parentNames: new Map([
      [EYE, 'Verbund Eye'],
      [MII, 'Verbund MII'],
      [NUM, 'Verbund NUM'],
    ]),
    receiver: {
      organization: RECEIVER,
      endpoint: RECEIVER_EP,
      affiliations: [EYE, MII, NUM].map((parent) => ({ parent, roles: ['DIC'] })),
      removedAffiliations: [],
    },
    members: [
      member(
        'klinik-a.example.de',
        'Klinik A',
        1,
        ['dsf.klinik-a.example.de'],
        [[MII, 'dsf.klinik-a.example.de', ['DIC', 'DMS']]],
        [[NUM, 'dsf.klinik-a.example.de']],
      ),
      member(
        'klinik-b.example.de',
        'Klinik B',
        3,
        ['nth.klinik-b.example.de', 'mii.klinik-b.example.de'],
        [
          [NUM, 'mii.klinik-b.example.de', ['AMS']],
          [NUM, 'nth.klinik-b.example.de', ['DTS']],
          [EYE, 'mii.klinik-b.example.de', ['AMS']],
          [MII, 'mii.klinik-b.example.de', ['AMS', 'DMS']],
        ],
      ),
      member(
        'klinik-c.example.de',
        'Klinik C',
        1,
        ['dsf.klinik-c.example.de'],
        [
          [MII, 'dsf.klinik-c.example.de', ['DIC', 'DMS']],
          [EYE, 'dsf.klinik-c.example.de', ['DIC']],
        ],
      ),
    ],
    // Withdrawn from the allow list: the legacy portal deletes it everywhere.
    removed: [
      {
        identifier: 'klinik-bx.example.de',
        endpoints: ['dsf.klinik-bx.example.de'],
        affiliations: [{ parent: MII, endpoint: 'dsf.klinik-bx.example.de' }],
      },
    ],
  };
}

/**
 * Canonical form of every entry: urn:uuid values replaced by the identity of
 * the entry they point at, so two bundles with different random uuids but
 * the same content and key order compare equal. The order of an
 * Organization's endpoint references carries no meaning and is sorted.
 */
function canonicalEntries(bundle: { entry?: Entry[] }): string[] {
  const entries = bundle.entry ?? [];
  const identity = new Map<string, string>();
  for (const e of entries) {
    if (!e.fullUrl || !e.resource) continue;
    const ids = e.resource.identifier as Array<{ value: string }> | undefined;
    identity.set(e.fullUrl, ids ? `${e.resource.resourceType}:${ids[0].value}` : e.request.url);
  }
  return entries.map((e) => {
    const resolved = JSON.parse(
      JSON.stringify(e, (key, value) => {
        if (key === 'fullUrl') return 'urn:uuid:<self>';
        if (typeof value === 'string' && identity.has(value)) return `<${identity.get(value)}>`;
        return value;
      }),
    ) as Entry;
    const refs = resolved.resource?.endpoint as Array<{ reference: string }> | undefined;
    if (resolved.resource?.resourceType === 'Organization' && refs) {
      refs.sort((a, b) => a.reference.localeCompare(b.reference));
    }
    return JSON.stringify(resolved);
  });
}

/** Coarse block sequence: which organization each entry belongs to, and its kind. */
function blockSequence(bundle: { entry?: Entry[] }): string[] {
  return (bundle.entry ?? []).map((e) => {
    const url = decodeURI(e.request.url);
    const r = e.resource;
    if (e.request.method === 'DELETE') {
      return `DELETE ${url.split('?')[0]} ${url.split('|').pop()}`;
    }
    if (r?.resourceType === 'OrganizationAffiliation') {
      return `OA ${url.split('participating-organization:identifier=')[1].split('&')[0]}`;
    }
    if (r?.resourceType === 'Endpoint') return 'Endpoint';
    const meta = r?.meta as { profile: string[] };
    return `${meta.profile[0].split('/').pop()} ${url.split('|')[1]}`;
  });
}

function entriesOf(bundle: AllowListBundle): Entry[] {
  return (bundle.entry ?? []) as Entry[];
}

function sequentialIds() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

describe('buildAllowListBundle – legacy allow-list format', () => {
  const bundle = buildAllowListBundle(legacyScenario(), sequentialIds());

  it('produces exactly the entries of the legacy portal (minus telecom)', () => {
    expect([...canonicalEntries(bundle)].sort()).toEqual([...canonicalEntries(fixture)].sort());
  });

  it('follows the legacy block order: parents, receiver affiliations, members by identifier', () => {
    expect(blockSequence(bundle)).toEqual(blockSequence(fixture));
  });

  it('keeps the legacy envelope exactly (meta tag, type, no identifier)', () => {
    const { entry: _ours, ...envelope } = bundle;
    const { entry: _theirs, ...legacyEnvelope } = fixture;
    expect(JSON.stringify(envelope)).toBe(JSON.stringify(legacyEnvelope));
  });

  it('passes every DSF acceptance rule for the receiver', () => {
    expect(
      dsfAllowListViolations(bundle, {
        receiverOrganization: RECEIVER,
        receiverEndpoint: RECEIVER_EP,
      }),
    ).toEqual([]);
  });

  it('the legacy fixture itself passes the same rules (sanity check of the checker)', () => {
    expect(
      dsfAllowListViolations(fixture, {
        receiverOrganization: RECEIVER,
        receiverEndpoint: RECEIVER_EP,
      }),
    ).toEqual([]);
  });

  it('passes every DSF acceptance rule as a network-wide bundle (no receiver)', () => {
    const full = buildAllowListBundle({ ...legacyScenario(), receiver: undefined });
    expect(dsfAllowListViolations(full)).toEqual([]);
    expect(
      entriesOf(full).some(
        (e) =>
          e.request.url.includes('Organization?identifier') && e.request.url.includes(RECEIVER),
      ),
    ).toBe(false);
  });
});

describe('buildAllowListBundle – DSF rules', () => {
  it('never emits resource.id and always marks affiliations active', () => {
    const entries = entriesOf(buildAllowListBundle(legacyScenario()));
    expect(entries.filter((e) => e.resource && 'id' in e.resource)).toEqual([]);
    const affiliations = entries.filter(
      (e) => e.resource?.resourceType === 'OrganizationAffiliation',
    );
    expect(affiliations.length).toBeGreaterThan(0);
    expect(affiliations.every((e) => e.resource!.active === true)).toBe(true);
  });

  it('merges memberships with the same parent and endpoint into one affiliation', () => {
    const input: AllowListInput = {
      parentNames: new Map(),
      members: [
        member(
          'klinik-d.example.de',
          'Klinik D',
          1,
          ['fhir.klinik-d.example.de'],
          [
            [MII, 'fhir.klinik-d.example.de', ['DIC']],
            [MII, 'fhir.klinik-d.example.de', ['HRP', 'DIC']],
          ],
        ),
      ],
    };
    const bundle = buildAllowListBundle(input);
    const oas = entriesOf(bundle).filter(
      (e) => e.resource?.resourceType === 'OrganizationAffiliation',
    );
    expect(oas).toHaveLength(1);
    expect(oas[0].resource!.code).toEqual([
      { coding: [{ system: 'http://dsf.dev/fhir/CodeSystem/organization-role', code: 'DIC' }] },
      { coding: [{ system: 'http://dsf.dev/fhir/CodeSystem/organization-role', code: 'HRP' }] },
    ]);
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });

  it('leaves out members without thumbprint or endpoint, with their affiliations and parents', () => {
    const input: AllowListInput = {
      parentNames: new Map(),
      members: [
        member(
          'no-cert.example.de',
          'No Cert',
          0,
          ['fhir.no-cert.example.de'],
          [[NUM, 'fhir.no-cert.example.de', ['DIC']]],
        ),
        member('no-endpoint.example.de', 'No Endpoint', 1, [], []),
        member(
          'ok.example.de',
          'OK',
          1,
          ['fhir.ok.example.de'],
          [[MII, 'fhir.ok.example.de', ['DIC']]],
        ),
      ],
    };
    const bundle = buildAllowListBundle(input);
    const urls = entriesOf(bundle)
      .map((e) => e.request.url)
      .join('\n');
    expect(urls).not.toContain('no-cert.example.de');
    expect(urls).not.toContain('no-endpoint.example.de');
    expect(urls).not.toContain(NUM);
    expect(urls).toContain('ok.example.de');
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });

  it('drops an affiliation whose endpoint is not one of the member endpoints', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [
        member(
          'klinik-e.example.de',
          'Klinik E',
          1,
          ['fhir.klinik-e.example.de'],
          [[MII, 'fhir.someone-else.example.de', ['DIC']]],
        ),
      ],
    });
    expect(entriesOf(bundle).map((e) => e.resource?.resourceType)).toEqual([
      'Organization',
      'Endpoint',
    ]);
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });

  it('deletes removed affiliations once, never next to an active PUT for the same triple', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [
        member(
          'klinik-f.example.de',
          'Klinik F',
          1,
          ['fhir.klinik-f.example.de'],
          [[MII, 'fhir.klinik-f.example.de', ['DIC']]],
          [
            [NUM, 'fhir.klinik-f.example.de'],
            [NUM, 'fhir.klinik-f.example.de'],
            [MII, 'fhir.klinik-f.example.de'],
          ],
        ),
      ],
    });
    const deletes = entriesOf(bundle).filter((e) => e.request.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toEqual({
      request: {
        method: 'DELETE',
        url:
          'OrganizationAffiliation?primary-organization:identifier=http://dsf.dev/sid/organization-identifier|verbund-num.example.de' +
          '&participating-organization:identifier=http://dsf.dev/sid/organization-identifier|klinik-f.example.de' +
          '&endpoint:identifier=http://dsf.dev/sid/endpoint-identifier|fhir.klinik-f.example.de',
      },
    });
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });

  it('never emits the receiver itself, even when it is passed as a member', () => {
    const input = legacyScenario();
    input.members.push(
      member(RECEIVER, 'Empfang', 1, [RECEIVER_EP], [[MII, RECEIVER_EP, ['DIC']]]),
    );
    const entries = entriesOf(buildAllowListBundle(input));
    const own = entries.filter(
      (e) =>
        e.resource?.resourceType !== 'OrganizationAffiliation' &&
        e.request.url.endsWith(`|${RECEIVER}`),
    );
    expect(own).toEqual([]);
    const receiverOas = entries.filter((e) =>
      e.request.url.includes(
        `participating-organization:identifier=http://dsf.dev/sid/organization-identifier|${RECEIVER}&`,
      ),
    );
    expect(receiverOas).toHaveLength(3);
    expect(receiverOas[0].resource!.participatingOrganization).toEqual({
      reference: `Organization?identifier=http://dsf.dev/sid/organization-identifier|${RECEIVER}`,
      type: 'Organization',
    });
    expect(receiverOas[0].resource!.endpoint).toEqual([
      {
        reference: `Endpoint?identifier=http://dsf.dev/sid/endpoint-identifier|${RECEIVER_EP}`,
        type: 'Endpoint',
      },
    ]);
  });

  it('references a parent that is also a member instead of emitting it twice', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [
        member('hub.example.de', 'Hub', 1, ['fhir.hub.example.de'], []),
        member(
          'klinik-g.example.de',
          'Klinik G',
          1,
          ['fhir.klinik-g.example.de'],
          [['hub.example.de', 'fhir.klinik-g.example.de', ['DIC']]],
        ),
      ],
    });
    const hubPuts = entriesOf(bundle).filter((e) => e.request.url.endsWith('|hub.example.de'));
    expect(hubPuts).toHaveLength(1);
    const oa = entriesOf(bundle).find(
      (e) => e.resource?.resourceType === 'OrganizationAffiliation',
    )!;
    expect((oa.resource!.organization as { reference: string }).reference).toBe(hubPuts[0].fullUrl);
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });

  it('falls back to DIC for role-less memberships and to the identifier as parent name', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [
        member(
          'klinik-h.example.de',
          'Klinik H',
          1,
          ['fhir.klinik-h.example.de'],
          [[NUM, 'fhir.klinik-h.example.de', []]],
        ),
      ],
    });
    const parent = entriesOf(bundle)[0];
    expect(parent.resource!.name).toBe(NUM);
    const oa = entriesOf(bundle).find(
      (e) => e.resource?.resourceType === 'OrganizationAffiliation',
    )!;
    expect(oa.resource!.code).toEqual([
      { coding: [{ system: 'http://dsf.dev/fhir/CodeSystem/organization-role', code: 'DIC' }] },
    ]);
  });

  it('omits entry when there is nothing to publish (FHIR JSON forbids empty arrays)', () => {
    const bundle = buildAllowListBundle({ parentNames: new Map(), members: [] });
    expect('entry' in bundle).toBe(false);
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });
});

describe('buildAllowListBundle – withdrawn organizations', () => {
  const withdrawn = {
    identifier: 'klinik-alt.example.de',
    endpoints: ['dsf2.klinik-alt.example.de', 'dsf.klinik-alt.example.de'],
    affiliations: [
      { parent: MII, endpoint: 'dsf.klinik-alt.example.de' },
      { parent: MII, endpoint: 'dsf.klinik-alt.example.de' },
    ],
  };

  it('deletes the organization, then its endpoints, then its affiliations, once each', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [],
      removed: [withdrawn],
    });
    expect(entriesOf(bundle)).toEqual([
      {
        request: {
          method: 'DELETE',
          url: 'Organization?identifier=http://dsf.dev/sid/organization-identifier|klinik-alt.example.de',
        },
      },
      {
        request: {
          method: 'DELETE',
          url: 'Endpoint?identifier=http://dsf.dev/sid/endpoint-identifier|dsf.klinik-alt.example.de',
        },
      },
      {
        request: {
          method: 'DELETE',
          url: 'Endpoint?identifier=http://dsf.dev/sid/endpoint-identifier|dsf2.klinik-alt.example.de',
        },
      },
      {
        request: {
          method: 'DELETE',
          url:
            'OrganizationAffiliation?primary-organization:identifier=http://dsf.dev/sid/organization-identifier|verbund-mii.example.de' +
            '&participating-organization:identifier=http://dsf.dev/sid/organization-identifier|klinik-alt.example.de' +
            '&endpoint:identifier=http://dsf.dev/sid/endpoint-identifier|dsf.klinik-alt.example.de',
        },
      },
    ]);
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });

  it('never deletes the receiver itself', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [],
      removed: [withdrawn],
      receiver: {
        organization: withdrawn.identifier,
        endpoint: 'dsf.klinik-alt.example.de',
        affiliations: [],
        removedAffiliations: [],
      },
    });
    expect('entry' in bundle).toBe(false);
  });

  it('never deletes what the bundle still publishes', () => {
    // The withdrawn organization is still the parent of a member's affiliation.
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [
        member(
          'klinik-k.example.de',
          'Klinik K',
          1,
          ['dsf.klinik-k.example.de'],
          [[withdrawn.identifier, 'dsf.klinik-k.example.de', ['DIC']]],
        ),
      ],
      removed: [withdrawn],
    });
    const urls = entriesOf(bundle).map((e) => `${e.request.method} ${e.request.url}`);
    expect(urls).toContain(
      'PUT Organization?identifier=http://dsf.dev/sid/organization-identifier|klinik-alt.example.de',
    );
    expect(urls).not.toContain(
      'DELETE Organization?identifier=http://dsf.dev/sid/organization-identifier|klinik-alt.example.de',
    );
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });

  it('ignores a withdrawal for an organization that is published as a member', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [member(withdrawn.identifier, 'Alt', 1, ['dsf.klinik-alt.example.de'], [])],
      removed: [withdrawn],
    });
    expect(entriesOf(bundle).filter((e) => e.request.method === 'DELETE')).toEqual([]);
  });
});

describe('buildAllowListBundle – endpoints removed from an active organization', () => {
  const base = (removedEndpoints?: string[]): AllowListMember => ({
    ...member(
      'klinik-m.example.de',
      'Klinik M',
      1,
      ['dsf.klinik-m.example.de'],
      [[MII, 'dsf.klinik-m.example.de', ['DIC']]],
      [[MII, 'dsf-alt.klinik-m.example.de']],
    ),
    ...(removedEndpoints ? { removedEndpoints } : {}),
  });
  const deletes = (b: { entry?: Entry[] }) =>
    (b.entry ?? [])
      .filter((e) => e.request.method === 'DELETE')
      .map((e) => `DELETE ${e.request.url.split('?')[0]} ${e.request.url.split('|').pop()}`);

  it('emits DELETE Endpoint after the affiliation DELETE', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [base(['dsf-alt.klinik-m.example.de'])],
    });
    expect(deletes(bundle)).toEqual([
      'DELETE OrganizationAffiliation dsf-alt.klinik-m.example.de',
      'DELETE Endpoint dsf-alt.klinik-m.example.de',
    ]);
    expect(dsfAllowListViolations(bundle)).toEqual([]);
  });

  it('renders a member without the field (or with an empty list) exactly as before', () => {
    const without = buildAllowListBundle({ parentNames: new Map(), members: [base()] }, () => 'x');
    const empty = buildAllowListBundle({ parentNames: new Map(), members: [base([])] }, () => 'x');
    expect(empty).toEqual(without);
    expect(deletes(without)).toEqual([
      'DELETE OrganizationAffiliation dsf-alt.klinik-m.example.de',
    ]);
  });

  it('never deletes an endpoint the member still publishes', () => {
    const bundle = buildAllowListBundle({
      parentNames: new Map(),
      members: [base(['dsf.klinik-m.example.de'])],
    });
    expect(deletes(bundle).some((d) => d.startsWith('DELETE Endpoint'))).toBe(false);
  });
});

describe('dsfAllowListViolations – rejects the shape emitted before this fix', () => {
  it('flags resource ids, inactive-less affiliations and duplicate conditional PUTs', () => {
    const oaUrl =
      'OrganizationAffiliation?primary-organization:identifier=http://dsf.dev/sid/organization-identifier|hub.example.de' +
      '&participating-organization:identifier=http://dsf.dev/sid/organization-identifier|klinik-1.example.de' +
      '&endpoint:identifier=http://dsf.dev/sid/endpoint-identifier|fhir.klinik-1.example.de';
    const oa = (id: string, role: string) => ({
      fullUrl: `urn:uuid:${id}`,
      resource: {
        resourceType: 'OrganizationAffiliation',
        id,
        meta: {
          profile: ['http://dsf.dev/fhir/StructureDefinition/organization-affiliation'],
          tag: [{ system: 'http://dsf.dev/fhir/CodeSystem/read-access-tag', code: 'ALL' }],
        },
        organization: { reference: 'urn:uuid:p', type: 'Organization' },
        participatingOrganization: { reference: 'urn:uuid:p', type: 'Organization' },
        code: [
          { coding: [{ system: 'http://dsf.dev/fhir/CodeSystem/organization-role', code: role }] },
        ],
        endpoint: [{ reference: 'urn:uuid:p', type: 'Endpoint' }],
      },
      request: { method: 'PUT', url: oaUrl },
    });
    const violations = dsfAllowListViolations({
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [oa('a1', 'DIC'), oa('a2', 'HRP')],
    });
    expect(violations).toEqual(
      expect.arrayContaining([
        'entry[0]: resource.id must be absent (DSF rejects it)',
        'entry[0]: OrganizationAffiliation.active is required',
        `duplicate PUT for ${oaUrl} (2x)`,
      ]),
    );
  });
});
