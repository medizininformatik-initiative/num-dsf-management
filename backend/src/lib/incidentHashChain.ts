/**
 * incidentHashChain.ts – SHA-256 hash chain over the incident timeline
 * (incident_events, migration 035). Every event stores the hash of its
 * predecessor (prev_hash; GENESIS_HASH for the first) and its own hash over
 * prev_hash + the canonical JSON of its content, so changing, removing or
 * reordering any stored event breaks the chain from there on.
 * The canonical JSON sorts object keys, because MySQL JSON columns do not keep
 * the key order an event was written with.
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
  let prev = GENESIS_HASH;
  for (const [i, event] of events.entries()) {
    if (event.seq !== i + 1 || event.prevHash !== prev || eventHash(prev, event) !== event.hash) {
      return { valid: false, brokenAt: event.seq };
    }
    prev = event.hash;
  }
  return { valid: true, brokenAt: null };
}
