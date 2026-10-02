/**
 * fhir-bundle-meta.test.ts
 * Regression: the DSF spec requires every emitted resource — and the Bundle
 * envelope itself — to carry a read-access-tag and a meta.profile that picks
 * the strict validator on the receiver side. Without these, DSF FHIR servers
 * either reject the bundle outright or fall back to generic R4 validation
 * (which misses DSF-specific cardinalities and bindings).
 */
import { generateBundle, generateFullBundle } from '../services/fhir.service';
import { removeSites, seedSite } from './helpers/allowListSites';

const TAG_SYSTEM = 'http://dsf.dev/fhir/CodeSystem/read-access-tag';
const PROFILE_ORG = 'http://dsf.dev/fhir/StructureDefinition/organization';
const PROFILE_ORG_PARENT = 'http://dsf.dev/fhir/StructureDefinition/organization-parent';
const PROFILE_ENDPOINT = 'http://dsf.dev/fhir/StructureDefinition/endpoint';
const PROFILE_AFFILIATION = 'http://dsf.dev/fhir/StructureDefinition/organization-affiliation';

interface MetaTag {
  system: string;
  code: string;
}
interface Meta {
  tag?: MetaTag[];
  profile?: string[];
}
interface FhirResource {
  resourceType?: string;
  meta?: Meta;
  extension?: unknown[];
}
interface FhirEntry {
  resource?: FhirResource;
  request: { method: string; url: string };
}
interface FhirBundle {
  meta?: Meta;
  entry?: FhirEntry[];
}

function hasReadAccessTag(meta: Meta | undefined): boolean {
  return !!meta?.tag?.some((t) => t.system === TAG_SYSTEM && t.code === 'ALL');
}

describe('Bundle meta + per-resource meta (Phase A)', () => {
  it('Bundle envelope carries read-access-tag ALL', async () => {
    const bundle = (await generateFullBundle()) as FhirBundle;
    expect(hasReadAccessTag(bundle.meta)).toBe(true);
  });

  it('every emitted resource carries read-access-tag ALL', async () => {
    const bundle = (await generateFullBundle()) as FhirBundle;
    for (const entry of bundle.entry ?? []) {
      if (!entry.resource) continue; // DELETE entries have no resource
      expect(hasReadAccessTag(entry.resource.meta)).toBe(true);
    }
  });

  it('Organization resources carry the correct DSF profile', async () => {
    const bundle = (await generateFullBundle()) as FhirBundle;
    const orgs = (bundle.entry ?? []).filter((e) => e.resource?.resourceType === 'Organization');
    for (const o of orgs) {
      const profiles = o.resource!.meta?.profile ?? [];
      const isParent = !(o.resource!.extension ?? []).length;
      expect(profiles).toContain(isParent ? PROFILE_ORG_PARENT : PROFILE_ORG);
    }
  });

  it('Endpoint resources carry the endpoint profile', async () => {
    const bundle = (await generateFullBundle()) as FhirBundle;
    const eps = (bundle.entry ?? []).filter((e) => e.resource?.resourceType === 'Endpoint');
    for (const ep of eps) {
      expect(ep.resource!.meta?.profile).toContain(PROFILE_ENDPOINT);
    }
  });

  it('OrganizationAffiliation resources carry the affiliation profile', async () => {
    const bundle = (await generateFullBundle()) as FhirBundle;
    const affs = (bundle.entry ?? []).filter(
      (e) => e.resource?.resourceType === 'OrganizationAffiliation',
    );
    for (const a of affs) {
      expect(a.resource!.meta?.profile).toContain(PROFILE_AFFILIATION);
    }
  });

  it('Bundle envelope carries only the read-access tag, as the legacy portal and UpdateAllowList do', async () => {
    const bundle = (await generateFullBundle()) as FhirBundle;
    expect(bundle.meta).toEqual({
      tag: [{ system: TAG_SYSTEM, code: 'ALL', display: 'everybody' }],
    });
  });

  it('tenant-scoped generateBundle carries the tags and never the receiver itself', async () => {
    const receiver = await seedSite({ label: 'meta-receiver', approval: null });
    const peer = await seedSite({
      label: 'meta-peer',
      memberships: [{ parent: 'meta-verbund.example.de', roles: ['DIC'] }],
    });
    try {
      const bundle = (await generateBundle(
        receiver.instanceId,
        receiver.endpointIds[0],
      )) as FhirBundle;
      expect(hasReadAccessTag(bundle.meta)).toBe(true);
      const entries = bundle.entry ?? [];
      for (const entry of entries) {
        if (entry.resource) expect(hasReadAccessTag(entry.resource.meta)).toBe(true);
      }
      // The receiver's DSF server already holds its own Organization/Endpoint.
      expect(entries.filter((e) => e.request.url.endsWith(`|${receiver.orgId}`))).toEqual([]);
      expect(entries.some((e) => e.request.url.endsWith(`|${peer.orgId}`))).toBe(true);
    } finally {
      await removeSites([receiver, peer]);
    }
  });
});
