// Purpose: Executable acceptance rules of the DSF allow-list chain, used by
// the bundle tests. A bundle must pass every rule, or the DSF process
// DownloadAllowList fails at the receiving site:
//  - dsf-process-allow-list CheckAllowList: type transaction/batch, only
//    Organization/Endpoint/OrganizationAffiliation via PUT, DELETE only on
//    those three types;
//  - DSF FHIR server UpdateCommand/DeleteCommand: conditional URLs, urn:uuid
//    fullUrl, no resource.id besides that urn (parsers run with
//    setOverrideResourceIdWithBundleEntryFullUrl(false)), one PUT per
//    conditional URL;
//  - DSF 2.0 profiles (dsf-organization, -organization-parent, -endpoint,
//    -organization-affiliation, -extension-certificate-thumbprint, -meta);
//  - references: urn:uuid targets exist in the bundle; conditional references
//    only point at resources the receiver already holds.
// Dependencies: none (pure)

export interface DsfCheckOptions {
  /** Conditional references the receiving DSF server can resolve (own org/endpoint). */
  receiverOrganization?: string;
  receiverEndpoint?: string;
}

type Json = Record<string, unknown>;

const ORG_SID = 'http://dsf.dev/sid/organization-identifier';
const EP_SID = 'http://dsf.dev/sid/endpoint-identifier';
const THUMBPRINT_URL = 'http://dsf.dev/fhir/StructureDefinition/extension-certificate-thumbprint';
const READ_ACCESS = 'http://dsf.dev/fhir/CodeSystem/read-access-tag';
const PROFILES: Record<string, string[]> = {
  Organization: [
    'http://dsf.dev/fhir/StructureDefinition/organization',
    'http://dsf.dev/fhir/StructureDefinition/organization-parent',
  ],
  Endpoint: ['http://dsf.dev/fhir/StructureDefinition/endpoint'],
  OrganizationAffiliation: ['http://dsf.dev/fhir/StructureDefinition/organization-affiliation'],
};
const ALLOWED_TYPES = Object.keys(PROFILES);

function arr(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** FHIR JSON forbids empty arrays, empty objects, empty strings and null values. */
function emptyValuePaths(value: unknown, path: string, out: string[]): void {
  if (value === null) out.push(`${path} is null`);
  else if (value === '') out.push(`${path} is an empty string`);
  else if (Array.isArray(value)) {
    if (value.length === 0) out.push(`${path} is an empty array`);
    value.forEach((v, i) => emptyValuePaths(v, `${path}[${i}]`, out));
  } else if (typeof value === 'object') {
    const keys = Object.keys(value as Json);
    if (keys.length === 0) out.push(`${path} is an empty object`);
    keys.forEach((k) => emptyValuePaths((value as Json)[k], `${path}.${k}`, out));
  }
}

function dsfIdentifiers(resource: Json, system: string): string[] {
  return arr(resource.identifier)
    .filter((i) => i.system === system)
    .map((i) => str(i.value) ?? '');
}

function checkOrganization(r: Json, profile: string, at: string, v: string[]): void {
  const ids = dsfIdentifiers(r, ORG_SID);
  if (ids.length !== 1 || !ids[0]) v.push(`${at}: needs exactly one ${ORG_SID} identifier`);
  if (typeof r.active !== 'boolean') v.push(`${at}: Organization.active is required`);
  if (profile.endsWith('/organization-parent')) return;
  const thumbprints = arr(r.extension).filter((e) => e.url === THUMBPRINT_URL);
  if (thumbprints.length === 0) v.push(`${at}: certificate thumbprint extension is required`);
  thumbprints.forEach((e) => {
    if (!/^[a-f0-9]{128}$/.test(String(e.valueString ?? ''))) {
      v.push(`${at}: thumbprint must be 128 lower-case hex (SHA-512)`);
    }
  });
  const endpoints = arr(r.endpoint);
  if (endpoints.length === 0) v.push(`${at}: Organization.endpoint is required`);
  if (endpoints.some((e) => !str(e.reference))) v.push(`${at}: endpoint.reference is required`);
}

function checkEndpoint(r: Json, at: string, v: string[]): void {
  const ids = dsfIdentifiers(r, EP_SID);
  if (ids.length !== 1 || !ids[0]) v.push(`${at}: needs exactly one ${EP_SID} identifier`);
  if (!str(r.status)) v.push(`${at}: Endpoint.status is required`);
  if (!str(r.address)) v.push(`${at}: Endpoint.address is required`);
  const ct = (r.connectionType ?? {}) as Json;
  if (
    ct.system !== 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type' ||
    ct.code !== 'hl7-fhir-rest'
  ) {
    v.push(`${at}: connectionType must be endpoint-connection-type|hl7-fhir-rest`);
  }
  if (!str((r.managingOrganization as Json | undefined)?.reference)) {
    v.push(`${at}: managingOrganization.reference is required`);
  }
  const task = arr(r.payloadType).filter((p) => {
    const coding = arr(p.coding);
    return (
      coding.length === 1 &&
      coding[0].system === 'http://hl7.org/fhir/resource-types' &&
      coding[0].code === 'Task'
    );
  });
  if (task.length !== 1) v.push(`${at}: payloadType needs exactly one resource-types|Task`);
  const mime = Array.isArray(r.payloadMimeType) ? [...(r.payloadMimeType as string[])].sort() : [];
  if (mime.join(',') !== 'application/fhir+json,application/fhir+xml') {
    v.push(`${at}: payloadMimeType must be exactly fhir+json and fhir+xml`);
  }
}

function checkAffiliation(r: Json, at: string, v: string[]): void {
  if (typeof r.active !== 'boolean') v.push(`${at}: OrganizationAffiliation.active is required`);
  if (!str((r.organization as Json | undefined)?.reference)) {
    v.push(`${at}: organization.reference is required`);
  }
  if (!str((r.participatingOrganization as Json | undefined)?.reference)) {
    v.push(`${at}: participatingOrganization.reference is required`);
  }
  const codes = arr(r.code);
  if (codes.length === 0) v.push(`${at}: code is required`);
  codes.forEach((c) => {
    const coding = arr(c.coding);
    if (coding.length === 0 || coding.some((x) => !str(x.system) || !str(x.code))) {
      v.push(`${at}: every code needs a coding with system and code`);
    }
  });
  const endpoints = arr(r.endpoint);
  if (endpoints.length !== 1 || !str(endpoints[0].reference)) {
    v.push(`${at}: exactly one endpoint reference is required`);
  }
}

function collectReferences(value: unknown, out: string[]): void {
  if (Array.isArray(value)) value.forEach((v) => collectReferences(v, out));
  else if (value && typeof value === 'object') {
    const o = value as Json;
    if (typeof o.reference === 'string') out.push(o.reference);
    Object.values(o).forEach((v) => collectReferences(v, out));
  }
}

function isConditional(url: string): boolean {
  const [path, query] = url.split('?');
  return !!query && path.length > 0 && !path.includes('/');
}

/** Every rule violation of `bundle`; an empty list means DSF accepts it. */
export function dsfAllowListViolations(bundle: unknown, opts: DsfCheckOptions = {}): string[] {
  const v: string[] = [];
  const b = (bundle ?? {}) as Json;
  if (b.resourceType !== 'Bundle') v.push('resourceType must be Bundle');
  if (b.type !== 'transaction' && b.type !== 'batch') v.push('type must be transaction or batch');
  emptyValuePaths(b, 'Bundle', v);

  const entries = arr(b.entry);
  const fullUrls = new Set(entries.map((e) => e.fullUrl).filter((u): u is string => !!str(u)));
  const putUrls = new Map<string, number>();
  const deleteUrls: string[] = [];
  const allowedConditional = new Set<string>();
  if (opts.receiverOrganization) {
    allowedConditional.add(`Organization?identifier=${ORG_SID}|${opts.receiverOrganization}`);
  }
  if (opts.receiverEndpoint) {
    allowedConditional.add(`Endpoint?identifier=${EP_SID}|${opts.receiverEndpoint}`);
  }

  entries.forEach((entry, index) => {
    const at = `entry[${index}]`;
    const request = (entry.request ?? {}) as Json;
    const method = request.method;
    const url = str(request.url) ?? '';
    const resource = entry.resource as Json | undefined;

    if (method !== 'PUT' && method !== 'DELETE') v.push(`${at}: method must be PUT or DELETE`);
    if (!isConditional(url)) v.push(`${at}: request.url must be a conditional URL (Type?query)`);
    const urlType = url.split('?')[0];
    if (!ALLOWED_TYPES.includes(urlType)) v.push(`${at}: ${urlType} not allowed in an allow list`);

    if (method === 'DELETE') {
      if (resource) v.push(`${at}: DELETE must not carry a resource`);
      deleteUrls.push(url);
      return;
    }
    if (!resource) {
      v.push(`${at}: PUT needs a resource`);
      return;
    }
    putUrls.set(url, (putUrls.get(url) ?? 0) + 1);
    const type = String(resource.resourceType ?? '');
    if (type !== urlType) v.push(`${at}: resourceType ${type} does not match ${urlType}`);
    if (!str(entry.fullUrl)?.startsWith('urn:uuid:')) v.push(`${at}: fullUrl must be urn:uuid`);
    if ('id' in resource) v.push(`${at}: resource.id must be absent (DSF rejects it)`);

    const meta = (resource.meta ?? {}) as Json;
    const profiles = Array.isArray(meta.profile) ? (meta.profile as string[]) : [];
    const profile = profiles[0] ?? '';
    if (profiles.length !== 1 || !(PROFILES[type] ?? []).includes(profile)) {
      v.push(`${at}: unexpected meta.profile ${profiles.join(',')}`);
    }
    if (!arr(meta.tag).some((t) => t.system === READ_ACCESS && t.code === 'ALL')) {
      v.push(`${at}: read-access-tag ALL is required`);
    }

    if (type === 'Organization') checkOrganization(resource, profile, at, v);
    else if (type === 'Endpoint') checkEndpoint(resource, at, v);
    else if (type === 'OrganizationAffiliation') checkAffiliation(resource, at, v);

    const refs: string[] = [];
    collectReferences(resource, refs);
    refs.forEach((ref) => {
      if (ref.startsWith('urn:uuid:')) {
        if (!fullUrls.has(ref)) v.push(`${at}: dangling reference ${ref}`);
      } else if (!allowedConditional.has(ref)) {
        v.push(`${at}: reference ${ref} cannot be resolved at the receiver`);
      }
    });
  });

  putUrls.forEach((count, url) => {
    if (count > 1) v.push(`duplicate PUT for ${url} (${count}x)`);
  });
  deleteUrls.forEach((url) => {
    if (putUrls.has(url)) v.push(`DELETE and PUT for the same ${url}`);
  });
  return v;
}
