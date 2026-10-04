/**
 * diffModel.test.ts — mapping of a raw bundle diff to the grouped view model:
 * organization status, endpoint / certificate / membership changes, folding of
 * PUT+DELETE pairs, endpoint-to-organization resolution and the summary counts.
 */
import { describe, it, expect } from 'vitest';
import { mapBundleDiff } from '../diffModel';

const ORG = 'http://dsf.dev/sid/organization-identifier';
const EP = 'http://dsf.dev/sid/endpoint-identifier';
const TP = 'http://dsf.dev/fhir/StructureDefinition/extension-certificate-thumbprint';
const PARENT_PROFILE = 'http://dsf.dev/fhir/StructureDefinition/organization-parent';

const orgUrl = (id: string) => `Organization?identifier=${ORG}|${id}`;
const epUrl = (id: string) => `Endpoint?identifier=${EP}|${id}`;
const affUrl = (parent: string, member: string, ep: string) =>
  `OrganizationAffiliation?primary-organization:identifier=${ORG}|${parent}` +
  `&participating-organization:identifier=${ORG}|${member}&endpoint:identifier=${EP}|${ep}`;

function org(
  id: string,
  name = id,
  thumbs: string[] = [],
  opts: { parent?: boolean; fullUrl?: string; endpoints?: string[] } = {},
) {
  return {
    fullUrl: opts.fullUrl ?? `urn:uuid:${id}`,
    resource: {
      resourceType: 'Organization',
      meta: opts.parent ? { profile: [PARENT_PROFILE] } : {},
      extension: thumbs.map((valueString) => ({ url: TP, valueString })),
      identifier: [{ system: ORG, value: id }],
      name,
      endpoint: (opts.endpoints ?? []).map((reference) => ({ reference })),
    },
    request: { method: 'PUT', url: orgUrl(id) },
  };
}

function endpoint(id: string, address: string, managing?: string, name = `EP ${id}`) {
  return {
    fullUrl: `urn:uuid:ep-${id}`,
    resource: {
      resourceType: 'Endpoint',
      identifier: [{ system: EP, value: id }],
      name,
      address,
      ...(managing ? { managingOrganization: { reference: managing } } : {}),
    },
    request: { method: 'PUT', url: epUrl(id) },
  };
}

function affiliation(parent: string, member: string, ep: string, roles: string[]) {
  return {
    fullUrl: `urn:uuid:aff-${parent}-${member}-${ep}`,
    resource: {
      resourceType: 'OrganizationAffiliation',
      code: roles.map((code) => ({ coding: [{ code }] })),
    },
    request: { method: 'PUT', url: affUrl(parent, member, ep) },
  };
}

const del = (url: string) => ({ request: { method: 'DELETE', url } });
const diff = (
  d: Partial<{
    added: unknown[];
    removed: unknown[];
    changed: Array<{ before: unknown; after: unknown }>;
  }>,
) => ({
  added: [],
  removed: [],
  changed: [],
  ...d,
});

describe('mapBundleDiff', () => {
  it('reports an empty diff as empty', () => {
    const m = mapBundleDiff(diff({}));
    expect(m.isEmpty).toBe(true);
    expect(m.organizations).toEqual([]);
    expect(Object.values(m.summary).every((n) => n === 0)).toBe(true);
  });

  it('maps an added organization with its endpoint, thumbprints and membership', () => {
    const o = org('klinik.example.de', 'Klinik Eins', ['aa11', 'bb22'], {
      endpoints: ['urn:uuid:ep-fhir.klinik.example.de'],
    });
    const e = endpoint(
      'fhir.klinik.example.de',
      'https://fhir.klinik.example.de/fhir',
      'urn:uuid:klinik.example.de',
    );
    const a = affiliation('parent.example.de', 'klinik.example.de', 'fhir.klinik.example.de', [
      'DIC',
    ]);
    const m = mapBundleDiff(diff({ added: [o, e, a] }));
    expect(m.organizations).toHaveLength(1);
    const g = m.organizations[0];
    expect(g.id).toBe('klinik.example.de');
    expect(g.name).toBe('Klinik Eins');
    expect(g.status).toBe('added');
    expect(g.changes.map((c) => c.kind).sort()).toEqual([
      'endpoint-added',
      'membership-added',
      'thumbprint-added',
      'thumbprint-added',
    ]);
    expect(m.summary).toMatchObject({
      orgsAdded: 1,
      endpointsChanged: 1,
      certificatesChanged: 2,
      membershipsChanged: 1,
    });
  });

  it('maps a removed organization', () => {
    const m = mapBundleDiff(diff({ removed: [org('weg.example.de', 'Weg', ['cc33'])] }));
    expect(m.organizations[0].status).toBe('removed');
    expect(m.summary.orgsRemoved).toBe(1);
    expect(m.organizations[0].changes[0]).toMatchObject({
      kind: 'thumbprint-removed',
      value: 'cc33',
    });
  });

  it('folds a removed PUT plus an added DELETE into one withdrawn organization', () => {
    const m = mapBundleDiff(
      diff({
        removed: [
          org('w.example.de', 'W'),
          endpoint('fhir.w.example.de', 'https://fhir.w.example.de/fhir'),
        ],
        added: [
          del(orgUrl('w.example.de')),
          del(epUrl('fhir.w.example.de')),
          del(affUrl('p.example.de', 'w.example.de', 'fhir.w.example.de')),
        ],
      }),
    );
    const w = m.organizations.find((g) => g.id === 'w.example.de');
    expect(w?.status).toBe('withdrawn');
    expect(m.summary.orgsWithdrawn).toBe(1);
    expect(m.summary.orgsRemoved).toBe(0);
    // Endpoint removal counted once, not once for the PUT and once for the DELETE.
    expect(m.summary.endpointsChanged).toBe(1);
    expect(m.summary.membershipsChanged).toBe(1);
  });

  it('does not double count a membership removed as PUT and DELETE', () => {
    const m = mapBundleDiff(
      diff({
        removed: [affiliation('p', 'm', 'e', ['DIC'])],
        added: [del(affUrl('p', 'm', 'e'))],
      }),
    );
    expect(m.summary.membershipsChanged).toBe(1);
    expect(m.organizations[0].changes[0]).toMatchObject({
      kind: 'membership-removed',
      parent: 'p',
    });
  });

  it('shows a lifted withdrawal', () => {
    const m = mapBundleDiff(diff({ removed: [del(orgUrl('back.example.de'))] }));
    expect(m.organizations[0].changes[0].kind).toBe('withdrawal-lifted');
    expect(m.organizations[0].status).toBe('changed');
  });

  it('maps an endpoint address change under the organization found via the affiliation URL', () => {
    const before = endpoint('fhir.k.example.de', 'https://old.k.example.de/fhir');
    const after = endpoint('fhir.k.example.de', 'https://new.k.example.de/fhir');
    const aff = affiliation('p.example.de', 'k.example.de', 'fhir.k.example.de', ['DIC']);
    const m = mapBundleDiff(diff({ added: [aff], changed: [{ before, after }] }));
    const g = m.organizations.find((x) => x.id === 'k.example.de');
    expect(g?.changes).toContainEqual({
      kind: 'endpoint-address',
      id: 'fhir.k.example.de',
      before: 'https://old.k.example.de/fhir',
      after: 'https://new.k.example.de/fhir',
    });
  });

  it('resolves an endpoint through managingOrganization pointing at an organization in the diff', () => {
    const o = org('k.example.de', 'Klinik', [], { fullUrl: 'urn:uuid:org-k' });
    const before = endpoint('e1', 'https://a/fhir', 'urn:uuid:org-k');
    const after = endpoint('e1', 'https://b/fhir', 'urn:uuid:org-k');
    const m = mapBundleDiff(diff({ added: [o], changed: [{ before, after }] }));
    expect(m.organizations).toHaveLength(1);
    expect(m.organizations[0].changes.map((c) => c.kind)).toContain('endpoint-address');
  });

  it('resolves a conditional managingOrganization reference', () => {
    const e = endpoint('e1', 'https://a/fhir', orgUrl('k.example.de'));
    const m = mapBundleDiff(diff({ added: [e] }));
    expect(m.organizations[0].id).toBe('k.example.de');
  });

  it('puts endpoints it cannot place into the unassigned group, sorted last', () => {
    const m = mapBundleDiff(
      diff({ added: [endpoint('lost', 'https://lost/fhir'), org('a.example.de')] }),
    );
    expect(m.organizations.map((g) => g.id)).toEqual(['a.example.de', null]);
    expect(m.summary.orgsAdded).toBe(1);
    // The unassigned group is not an organization.
    expect(m.summary.orgsChanged).toBe(0);
  });

  it('maps thumbprint additions and removals on a changed organization, and a rename', () => {
    const before = org('k.example.de', 'Alt', ['aa', 'bb']);
    const after = org('k.example.de', 'Neu', ['bb', 'cc']);
    const m = mapBundleDiff(diff({ changed: [{ before, after }] }));
    const kinds = m.organizations[0].changes.map((c) => `${c.kind}`);
    expect(kinds).toContain('org-name');
    expect(m.organizations[0].changes).toContainEqual({ kind: 'thumbprint-added', value: 'cc' });
    expect(m.organizations[0].changes).toContainEqual({ kind: 'thumbprint-removed', value: 'aa' });
    expect(m.organizations[0].status).toBe('changed');
    expect(m.summary).toMatchObject({ orgsChanged: 1, certificatesChanged: 2 });
  });

  it('maps role changes of a membership with added and removed roles', () => {
    const before = affiliation('p', 'm', 'e', ['DIC', 'HRP']);
    const after = affiliation('p', 'm', 'e', ['DIC', 'DMS']);
    const m = mapBundleDiff(diff({ changed: [{ before, after }] }));
    expect(m.organizations[0].changes[0]).toEqual({
      kind: 'membership-roles',
      parent: 'p',
      endpoint: 'e',
      roles: ['DIC', 'DMS'],
      rolesAdded: ['DMS'],
      rolesRemoved: ['HRP'],
    });
  });

  it('ignores a changed membership whose roles are identical', () => {
    const a = affiliation('p', 'm', 'e', ['DIC']);
    const m = mapBundleDiff(diff({ changed: [{ before: a, after: a }] }));
    expect(m.isEmpty).toBe(true);
  });

  it('marks parent organizations', () => {
    const m = mapBundleDiff(diff({ added: [org('p.example.de', 'Parent', [], { parent: true })] }));
    expect(m.organizations[0].isParent).toBe(true);
  });

  it('sorts organizations by identifier and tolerates malformed entries', () => {
    const m = mapBundleDiff(
      diff({ added: [org('b.example.de'), org('a.example.de'), null, 'x', {}] }),
    );
    expect(m.organizations.map((g) => g.id)).toEqual(['a.example.de', 'b.example.de']);
  });
});
