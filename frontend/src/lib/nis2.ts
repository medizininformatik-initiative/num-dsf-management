/**
 * nis2.ts – state of a NIS2 reporting deadline (24 h early warning, 72 h
 * notification, final report one month after the notification, each counted
 * by the backend; the early warning and the notification from the time the
 * site became aware): reported, overdue, due soon (less than six hours left),
 * open, or pending without a deadline (interim report, final report awaiting
 * the closure), plus the remaining or overdue time split into days, hours and
 * minutes for the countdown. Pure functions; the caller passes "now".
 * Dependencies: incidents.api types.
 */
import type { Nis2Entry } from '../api/incidents.api';

export const NIS2_SOON_MS = 6 * 60 * 60 * 1000;

export type Nis2State =
  | { kind: 'reported'; at: string; by: string | null }
  | { kind: 'overdue'; ms: number }
  | { kind: 'soon'; ms: number }
  | { kind: 'open'; ms: number }
  /** No deadline: an interim report the BSI requests, a final report that waits for the closure. */
  | { kind: 'pending' };

export function nis2State(entry: Nis2Entry, now: number): Nis2State {
  if (entry.reportedAt) return { kind: 'reported', at: entry.reportedAt, by: entry.reportedBy };
  if (!entry.dueAt) return { kind: 'pending' };
  const left = new Date(entry.dueAt).getTime() - now;
  if (Number.isNaN(left)) return { kind: 'open', ms: 0 };
  if (left <= 0) return { kind: 'overdue', ms: -left };
  return { kind: left < NIS2_SOON_MS ? 'soon' : 'open', ms: left };
}

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
}

/** Whole days, hours and minutes of a duration (minutes rounded up, never 0 h 0 min). */
export function splitDuration(ms: number): DurationParts {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}
