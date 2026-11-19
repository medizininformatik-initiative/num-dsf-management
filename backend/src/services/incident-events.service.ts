/**
 * incident-events.service.ts – The append-only, hash-chained timeline of an
 * incident (incident_events, migration 035). Events are only ever inserted,
 * never updated or deleted. appendEvent runs inside the caller's transaction
 * and first locks the incident row (SELECT ... FOR UPDATE), so two concurrent
 * events of one incident are chained one after the other instead of forking
 * the chain; the unique (incident_id, seq) index is the backstop.
 * Dependencies: db/connection, lib/incidentHashChain, uuid
 */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import {
  GENESIS_HASH,
  eventHash,
  verifyChain,
  verifyFields,
  type ChainVerification,
  type ChainedEvent,
  type HashedFields,
} from '../lib/incidentHashChain';

export const INCIDENT_EVENT_TYPES = [
  'REPORTED',
  'CONFIRMED',
  'SUSPENDED',
  'MEASURE',
  'COMMENT',
  'SUSPENSION_LIFTED',
  'CLOSED',
  'FALSE_ALARM',
  'UPDATED',
  'ARCHIVED',
  'BLOCK_LIFT_REQUESTED',
  'BLOCKS_LIFTED',
] as const;
export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number];

export interface IncidentEvent {
  id: string;
  seq: number;
  at: Date;
  actorEmail: string;
  type: IncidentEventType;
  details: Record<string, unknown> | null;
  prevHash: string;
  hash: string;
}

interface EventRow {
  id: string;
  incident_id: string;
  seq: number;
  at: Date;
  actor_email: string;
  type: IncidentEventType;
  details: unknown;
  prev_hash: string;
  hash: string;
}

function parseDetails(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Append one event to the chain. Must run inside a transaction. */
export async function appendEvent(
  trx: Knex.Transaction,
  incidentId: string,
  actorEmail: string,
  type: IncidentEventType,
  details: Record<string, unknown> | null = null,
): Promise<IncidentEvent> {
  const incident = await trx('incidents').where({ id: incidentId }).forUpdate().first('id');
  if (!incident) throw new Error('INCIDENT_NOT_FOUND');
  const last = (await trx('incident_events')
    .where({ incident_id: incidentId })
    .orderBy('seq', 'desc')
    .first('seq', 'hash')) as { seq: number; hash: string } | undefined;
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  // Millisecond precision, as DATETIME(3) stores it.
  const at = new Date();
  const hash = eventHash(prevHash, { incidentId, seq, at, actorEmail, type, details });
  const id = uuidv4();
  await trx('incident_events').insert({
    id,
    incident_id: incidentId,
    seq,
    at,
    actor_email: actorEmail,
    type,
    details: details === null ? null : JSON.stringify(details),
    prev_hash: prevHash,
    hash,
  });
  return { id, seq, at, actorEmail, type, details, prevHash, hash };
}

export async function listEvents(incidentId: string): Promise<IncidentEvent[]> {
  const rows: EventRow[] = await db('incident_events')
    .where({ incident_id: incidentId })
    .orderBy('seq', 'asc');
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    at: new Date(r.at),
    actorEmail: r.actor_email,
    type: r.type,
    details: parseDetails(r.details),
    prevHash: r.prev_hash,
    hash: r.hash,
  }));
}

export interface IncidentVerification extends ChainVerification {
  /** Incident fields whose stored value does not match the timeline's hash. */
  tamperedFields: string[];
}

/** Verify the chain and, given the stored incident fields, their recorded hashes. */
export function verifyEvents(
  incidentId: string,
  events: IncidentEvent[],
  fields?: HashedFields,
): IncidentVerification {
  const chained: ChainedEvent[] = events.map((e) => ({ ...e, incidentId }));
  const chain = verifyChain(chained);
  const tamperedFields = fields ? verifyFields(events, fields) : [];
  return { ...chain, valid: chain.valid && tamperedFields.length === 0, tamperedFields };
}

/** The newest event of an incident (the chain head), or null. */
export async function chainHead(incidentId: string): Promise<{ seq: number; hash: string } | null> {
  const row = (await db('incident_events')
    .where({ incident_id: incidentId })
    .orderBy('seq', 'desc')
    .first('seq', 'hash')) as { seq: number; hash: string } | undefined;
  return row ? { seq: row.seq, hash: row.hash } : null;
}
