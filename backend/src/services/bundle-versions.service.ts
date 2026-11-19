/**
 * bundle-versions.service.ts – persist + diff full federation bundle
 * snapshots. createSnapshot is called from approveRequest after the
 * outer transaction commits, so generateFullBundle sees the new
 * APPROVED state.
 *
 * Diff is computed over bundle.entry, keyed by a STABLE business
 * identity (see keyOf) — NOT resource.id, which generateFullBundle
 * regenerates as a fresh uuid on every run, so id-keyed diffs would
 * report every entry as added+removed. Added / removed / changed
 * buckets are returned as raw FHIR entries so the admin UI can render
 * them inline.
 *
 * Storage: every snapshot stores the signed full JSON plus the builder input
 * it was rendered from (input_json, migration 024). The input makes every
 * receiver view of every version reproducible, which backs the published
 * allow list (current version + history, read by the DSF process) and the
 * restore of an old version. ~50-100 KB / version.
 * A new version also deletes affiliations earlier versions published for an
 * endpoint that the member no longer has (lib/allowListHistory).
 */
import { db } from '../db/connection';
import { v4 as uuidv4 } from 'uuid';
import {
  generateBundle,
  loadAllowListInput,
  renderFullBundle,
  renderReceiverBundle,
  resolveReceiver,
  applyCurrentOverrides,
} from './fhir.service';
import {
  parseAllowListInput,
  serializeAllowListInput,
  type StoredAllowListInput,
} from '../lib/allowListInput';
import type { AllowListBundle } from '../lib/allowListBundle';
import {
  publishedAffiliations,
  withRetiredAffiliations,
  type AffiliationTriple,
} from '../lib/allowListHistory';
import { createPurgeCollector, purgeBundleFromEntries } from '../lib/allowListPurge';
import { signBundle } from './bundle-signing.service';
import { writeAuditLog } from './audit.service';

export type TriggeredBy = 'APPROVAL' | 'MANUAL' | 'RESTORE';

export interface BundleVersionRow {
  id: string;
  version_number: number;
  created_at: Date;
  triggered_by: TriggeredBy;
  approval_request_id: string | null;
  triggered_by_email: string;
  content_hash: string;
  signature: string;
  bundle_json: string;
  notes: string | null;
  input_json: string | null;
}

interface SnapshotArgs {
  triggeredBy: TriggeredBy;
  triggeredByEmail: string;
  approvalRequestId?: string;
  notes?: string;
  /** Network state to store instead of the live one (restore). */
  input?: StoredAllowListInput;
  restoredFromVersion?: number;
}

export interface SnapshotResult {
  id: string;
  versionNumber: number;
  contentHash: string;
}

/**
 * Receivers may skip versions, so an affiliation any earlier version
 * published for an endpoint its member no longer has is deleted again (see
 * lib/allowListHistory). Done once per created version; the result is stored.
 */
async function withHistoricRetirements(input: StoredAllowListInput): Promise<StoredAllowListInput> {
  return withRetiredAffiliations(input, await historicAffiliations());
}

// A stored bundle never changes, so the affiliations parsed from it are kept per
// (id, content hash) and only bundles not seen yet are loaded and parsed.
const affiliationsByVersion = new Map<string, AffiliationTriple[]>();

/** Affiliations every stored version published. */
export async function historicAffiliations(): Promise<AffiliationTriple[]> {
  const versions: Array<{ id: string; content_hash: string }> = await db('bundle_versions').select(
    'id',
    'content_hash',
  );
  const cacheKey = (v: { id: string; content_hash: string }) => `${v.id}:${v.content_hash}`;
  const missing = versions.filter((v) => !affiliationsByVersion.has(cacheKey(v)));
  if (missing.length > 0) {
    const rows: Array<{ id: string; bundle_json: string }> = await db('bundle_versions')
      .select('id', 'bundle_json')
      .whereIn(
        'id',
        missing.map((v) => v.id),
      );
    const bodies = new Map(rows.map((r) => [r.id, r.bundle_json]));
    for (const v of missing) {
      affiliationsByVersion.set(cacheKey(v), publishedAffiliations(bodies.get(v.id) ?? ''));
    }
  }
  return versions.flatMap((v) => affiliationsByVersion.get(cacheKey(v)) ?? []);
}

export async function createSnapshot(args: SnapshotArgs): Promise<SnapshotResult> {
  const input = await withHistoricRetirements(args.input ?? (await loadAllowListInput()));
  const bundle = renderFullBundle(input);
  const { signature, contentHash, json } = signBundle(bundle);
  const id = uuidv4();
  await db('bundle_versions').insert({
    id,
    triggered_by: args.triggeredBy,
    triggered_by_email: args.triggeredByEmail,
    approval_request_id: args.approvalRequestId ?? null,
    content_hash: contentHash,
    signature,
    bundle_json: json,
    input_json: serializeAllowListInput(input),
    notes: args.notes ?? null,
  });
  const row = await db<BundleVersionRow>('bundle_versions').where({ id }).first();
  await writeAuditLog({
    userEmail: args.triggeredByEmail,
    resourceType: 'APPROVAL',
    resourceId: id,
    operation: 'CREATE',
    diffJson: {
      action: 'bundle_snapshot',
      versionNumber: row!.version_number,
      triggeredBy: args.triggeredBy,
      approvalRequestId: args.approvalRequestId ?? null,
      ...(args.restoredFromVersion ? { restoredFromVersion: args.restoredFromVersion } : {}),
    },
  });
  return { id, versionNumber: row!.version_number, contentHash };
}

type VersionListRow = Pick<
  BundleVersionRow,
  | 'id'
  | 'version_number'
  | 'created_at'
  | 'triggered_by'
  | 'triggered_by_email'
  | 'content_hash'
  | 'notes'
  | 'approval_request_id'
> & { has_input: number | boolean };

/**
 * Versions newest first. `restorable` marks versions that stored their input;
 * `isCurrent` marks the version the allow list is published from, which is the
 * latest one while it carries an input.
 */
export async function listVersions(opts: { page: number; limit: number }) {
  const { page, limit } = opts;
  const [raw, latest] = await Promise.all([
    db('bundle_versions')
      .select(
        'id',
        'version_number',
        'created_at',
        'triggered_by',
        'triggered_by_email',
        'content_hash',
        'notes',
        'approval_request_id',
        db.raw('(input_json IS NOT NULL) AS has_input'),
      )
      .orderBy('version_number', 'desc')
      .limit(limit)
      .offset((page - 1) * limit) as Promise<VersionListRow[]>,
    currentVersionNumber(),
  ]);
  const rows = raw.map(({ has_input, ...row }) => ({
    ...row,
    restorable: Boolean(has_input),
    isCurrent: row.version_number === latest,
  }));
  const [{ total }] = await db('bundle_versions').count<[{ total: number }]>({ total: '*' });
  return { rows, total: Number(total) };
}

/** Version the allow list is published from; null before the first stored input. */
export async function currentVersionNumber(): Promise<number | null> {
  const row = await db('bundle_versions')
    .select('version_number', db.raw('(input_json IS NOT NULL) AS has_input'))
    .orderBy('version_number', 'desc')
    .first();
  return row && row.has_input ? row.version_number : null;
}

export interface PublishedReceiverBundle {
  bundle: AllowListBundle;
  /** Null when the bundle was built from the live state (no stored input yet). */
  version: { number: number; createdAt: Date } | null;
}

/**
 * Receiver view of the published allow list. Without `versionNumber` that is
 * the latest version's stored input, falling back to the live state while no
 * version stored an input (before the first approval after migration 024).
 * @throws ORGANIZATION_NOT_FOUND / ENDPOINT_NOT_FOUND / VERSION_NOT_FOUND
 */
export async function getPublishedReceiverBundle(
  instanceId: string,
  endpointId: string,
  versionNumber?: number,
): Promise<PublishedReceiverBundle> {
  const { organization, endpoint } = await resolveReceiver(instanceId, endpointId);
  const query = db('bundle_versions').select('version_number', 'created_at', 'input_json');
  const row = await (versionNumber === undefined
    ? query.orderBy('version_number', 'desc').first()
    : query.where({ version_number: versionNumber }).first());
  if (versionNumber !== undefined && (!row || !row.input_json)) {
    throw new Error('VERSION_NOT_FOUND');
  }
  if (!row || !row.input_json) {
    return { bundle: await generateBundle(instanceId, endpointId), version: null };
  }
  const version = { number: row.version_number as number, createdAt: row.created_at as Date };
  const input = parseAllowListInput(row.input_json);
  return { bundle: renderReceiverBundle(input, organization, endpoint, version), version };
}

export interface ReceiverHistoryEntry {
  versionNumber: number;
  createdAt: Date;
  triggeredBy: TriggeredBy;
  notes: string | null;
  isCurrent: boolean;
}

/** Versions a receiver can read (those with a stored input), newest first. */
export async function listReceiverHistory(opts: {
  limit: number;
  offset?: number;
}): Promise<ReceiverHistoryEntry[]> {
  const [rows, current] = await Promise.all([
    db('bundle_versions')
      .whereNotNull('input_json')
      .select('version_number', 'created_at', 'triggered_by', 'notes')
      .orderBy('version_number', 'desc')
      .limit(opts.limit)
      .offset(opts.offset ?? 0),
    currentVersionNumber(),
  ]);
  return rows.map((r) => ({
    versionNumber: r.version_number as number,
    createdAt: r.created_at as Date,
    triggeredBy: r.triggered_by as TriggeredBy,
    notes: (r.notes as string | null) ?? null,
    isCurrent: r.version_number === current,
  }));
}

/** Stored bundles of every version, oldest first, loaded in small batches. */
async function* storedBundles(): AsyncGenerator<string> {
  const ids: string[] = await db('bundle_versions').orderBy('version_number', 'asc').pluck('id');
  const BATCH = 25;
  for (let i = 0; i < ids.length; i += BATCH) {
    const rows: Array<{ bundle_json: string }> = await db('bundle_versions')
      .whereIn('id', ids.slice(i, i + BATCH))
      .select('bundle_json');
    for (const row of rows) yield row.bundle_json;
  }
}

/**
 * The purge bundle of one endpoint's site: conditional DELETEs for every Organization, Endpoint
 * and OrganizationAffiliation any stored version ever published, except the site's own
 * Organization and Endpoints (lib/allowListPurge). Not a version of the allow list.
 * @throws ORGANIZATION_NOT_FOUND / ENDPOINT_NOT_FOUND
 */
export async function getPurgeBundle(
  instanceId: string,
  endpointId: string,
): Promise<AllowListBundle> {
  const { organization } = await resolveReceiver(instanceId, endpointId);
  const endpoints: string[] = await db('endpoints')
    .where({ organization_id: organization })
    .pluck('identifier');
  // One stored bundle at a time: only the distinct URLs are kept, not every bundle's JSON.
  const collector = createPurgeCollector({ organization, endpoints });
  for await (const json of storedBundles()) collector.add(json);
  return purgeBundleFromEntries(collector.entries());
}

/** Signed network-wide bundle of the current version, or of the live state as fallback. */
export async function getPublishedFullBundle(): Promise<{
  json: string;
  signature: string;
  contentHash: string;
  versionNumber: number | null;
}> {
  const row = await db<BundleVersionRow>('bundle_versions')
    .select('version_number', 'bundle_json', 'signature', 'content_hash', 'input_json')
    .orderBy('version_number', 'desc')
    .first();
  if (row && row.input_json) {
    return {
      json: row.bundle_json,
      signature: row.signature,
      contentHash: row.content_hash,
      versionNumber: row.version_number,
    };
  }
  const signed = signBundle(renderFullBundle(await loadAllowListInput()));
  return {
    json: signed.json,
    signature: signed.signature,
    contentHash: signed.contentHash,
    versionNumber: null,
  };
}

/**
 * Publish an old version again: a NEW version (triggered_by RESTORE) with the
 * stored input of the source, re-rendered and re-signed. The restored list is
 * the current one until the next approval snapshots the live state.
 * @throws NOT_FOUND / VERSION_NOT_RESTORABLE / INPUT_CORRUPT
 */
export async function restoreVersion(
  id: string,
  reason: string,
  adminEmail: string,
): Promise<SnapshotResult & { restoredFromVersion: number }> {
  const source = await db<BundleVersionRow>('bundle_versions')
    .select('version_number', 'input_json')
    .where({ id })
    .first();
  if (!source) throw new Error('NOT_FOUND');
  if (!source.input_json) throw new Error('VERSION_NOT_RESTORABLE');
  // A restored version never brings back a removed or suspended site or a blocked thumbprint.
  const input = await applyCurrentOverrides(parseAllowListInput(source.input_json));
  const snapshot = await createSnapshot({
    triggeredBy: 'RESTORE',
    triggeredByEmail: adminEmail,
    notes: `Restored from v${source.version_number}: ${reason}`,
    input,
    restoredFromVersion: source.version_number,
  });
  return { ...snapshot, restoredFromVersion: source.version_number };
}

export async function getVersion(id: string) {
  const row = await db<BundleVersionRow>('bundle_versions').where({ id }).first();
  if (!row) throw new Error('NOT_FOUND');
  // A corrupt stored bundle must surface as a clean business error, not a raw
  // SyntaxError that crashes the caller (e.g. the raw-download route).
  let bundle: unknown;
  try {
    bundle = JSON.parse(row.bundle_json);
  } catch {
    throw new Error('BUNDLE_CORRUPT');
  }
  // The stored input is internal (restore, receiver views); keep it out of the API.
  const { input_json: _input, ...rest } = row;
  return { ...rest, restorable: _input !== null, bundle };
}

interface FhirEntry {
  resource?: {
    id?: string;
    resourceType?: string;
    identifier?: Array<{ value?: string }>;
  };
  request?: { url?: string };
  fullUrl?: string;
}
interface FhirBundle {
  entry?: FhirEntry[];
}

// Stable identity for an entry, in priority order:
//  1. resource.identifier[0].value — the sid/FQDN of Organization & Endpoint
//     resources (stable across regenerations).
//  2. request.url — the conditional PUT/DELETE URL, built from FQDN
//     identifiers; covers OrganizationAffiliation and DELETE entries that
//     carry no top-level identifier.
//  3. resource.id — only as a fallback (e.g. synthetic test fixtures);
//     real bundle ids are random uuids and must not be the primary key.
//  4. fullUrl — last resort.
function keyOf(entry: FhirEntry): string {
  const r = entry.resource;
  const identValue = r?.identifier?.[0]?.value;
  if (identValue) return `${r?.resourceType ?? 'Unknown'}:${identValue}`;
  if (entry.request?.url) return entry.request.url;
  if (r?.id) return `${r?.resourceType ?? 'Unknown'}:${r.id}`;
  return entry.fullUrl ?? '';
}

// Content fingerprint for change detection. generateFullBundle regenerates
// fullUrl, resource.id, and every urn:uuid: cross-reference built from them
// on each run, so all three are volatile and must be neutralised — otherwise
// two snapshots of unchanged data would report every matched entry as
// changed (the same random-id defect this diff fixes, in the changed bucket).
function stableJson(entry: FhirEntry): string {
  const clone = JSON.parse(JSON.stringify(entry)) as FhirEntry & { fullUrl?: string };
  delete clone.fullUrl;
  if (clone.resource) delete clone.resource.id;
  return JSON.stringify(clone).replace(/urn:uuid:[0-9a-f-]+/gi, 'urn:uuid:*');
}

export async function diffVersions(idA: string, idB: string) {
  const [a, b] = await Promise.all([getVersion(idA), getVersion(idB)]);
  const aMap = new Map<string, FhirEntry>(
    (a.bundle as FhirBundle).entry?.map((e) => [keyOf(e), e]) ?? [],
  );
  const bMap = new Map<string, FhirEntry>(
    (b.bundle as FhirBundle).entry?.map((e) => [keyOf(e), e]) ?? [],
  );
  const added: FhirEntry[] = [];
  const removed: FhirEntry[] = [];
  const changed: Array<{ before: FhirEntry; after: FhirEntry }> = [];
  for (const [k, entry] of bMap) {
    const before = aMap.get(k);
    if (!before) added.push(entry);
    else if (stableJson(before) !== stableJson(entry)) changed.push({ before, after: entry });
  }
  for (const [k, entry] of aMap) {
    if (!bMap.has(k)) removed.push(entry);
  }
  return { added, removed, changed };
}
