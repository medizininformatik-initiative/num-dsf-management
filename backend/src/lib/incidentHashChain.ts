/**
 * incidentHashChain.ts – SHA-256 hash chain over the incident timeline
 * (incident_events, migration 035). Every event stores the hash of its
 * predecessor (prev_hash; GENESIS_HASH for the first) and its own hash over
 * prev_hash + the canonical JSON of its content, so changing, removing or
 * reordering any stored event breaks the chain from there on.
 * The canonical JSON sorts object keys, because MySQL JSON columns do not keep
 * the key order an event was written with. A valid chain starts with the
 * REPORTED event; an empty chain is not valid.
 * The incident row itself is covered through field hashes: REPORTED records
 * the SHA-256 of title, description, organization and detection time
 * (details.fieldSha256), an UPDATED event that of the field it changes, and
 * verifyFields compares the stored row with the latest recorded hashes.
 * Pure: no database. Dependencies: crypto.
 */
import { createHash } from 'crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainEventContent {
  incidentId: string;
  seq: number;
  at: Date;
  actorEmail: string;
  type: string;
  details: unknown;
}

export interface ChainedEvent extends ChainEventContent {
  prevHash: string;
  hash: string;
}

/** JSON with object keys sorted at every level; undefined values are dropped as JSON.stringify does. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function eventHash(prevHash: string, event: ChainEventContent): string {
  const content = canonicalJson({
    incidentId: event.incidentId,
    seq: event.seq,
    at: event.at.toISOString(),
    actorEmail: event.actorEmail,
    type: event.type,
    details: event.details ?? null,
  });
  return createHash('sha256')
    .update(prevHash + content)
    .digest('hex');
}

export interface ChainVerification {
  valid: boolean;
  /** seq of the first event that does not verify; null when the chain is intact. */
  brokenAt: number | null;
}

/** Verify events of one incident, ordered by seq. */
export function verifyChain(events: ChainedEvent[]): ChainVerification {
  if (events.length === 0 || events[0].type !== 'REPORTED') return { valid: false, brokenAt: 1 };
  let prev = GENESIS_HASH;
  for (const [i, event] of events.entries()) {
    if (event.seq !== i + 1 || event.prevHash !== prev || eventHash(prev, event) !== event.hash) {
      return { valid: false, brokenAt: event.seq };
    }
    prev = event.hash;
  }
  return { valid: true, brokenAt: null };
}

/** Incident fields covered by the chain, as their canonical values. */
export const HASHED_FIELDS = [
  'title',
  'description',
  'organizationId',
  'detectedAt',
  'nis2EarlyWarning',
  'nis2Notification',
  'nis2FinalReport',
] as const;
export type HashedField = (typeof HASHED_FIELDS)[number];
/**
 * The nis2* fields are the canonical JSON of a stage's report fields (null
 * when empty); a field no event recorded a hash for is not checked.
 */
export type HashedFields = Record<
  'title' | 'description' | 'organizationId' | 'detectedAt',
  string | null
> &
  Partial<Record<'nis2EarlyWarning' | 'nis2Notification' | 'nis2FinalReport', string | null>>;

/** SHA-256 over the canonical JSON of one field value. */
export function fieldHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** The fieldSha256 detail of an event recording these fields. */
export function fieldHashes(fields: Partial<HashedFields>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, fieldHash(v)]),
  );
}

/**
 * Fields of the stored incident that differ from the latest hash the timeline
 * recorded for them (events ordered by seq). A field no event recorded a
 * hash for is not checked.
 */
export function verifyFields(
  events: Array<{ type: string; details: unknown }>,
  current: HashedFields,
): HashedField[] {
  const latest: Partial<Record<HashedField, string>> = {};
  for (const event of events) {
    const details = event.details as { fieldSha256?: Record<string, unknown> } | null;
    const hashes = details?.fieldSha256;
    if (!hashes || typeof hashes !== 'object') continue;
    for (const field of HASHED_FIELDS) {
      if (typeof hashes[field] === 'string') latest[field] = hashes[field] as string;
    }
  }
  return HASHED_FIELDS.filter(
    (field) => latest[field] !== undefined && latest[field] !== fieldHash(current[field] ?? null),
  );
}
