/**
 * incidents.api.ts – the incident register: report and read incidents (any
 * signed-in user), save NIS2 report fields, request an interim report, tick
 * NIS2 stages and "DPO informed" (admins, the reporter and users of the
 * affected site), and the admin actions (confirm, suspend the
 * site, lift the suspension, close, comment, edit, export). Writes marked
 * step-up carry `totpCode` in OTP sessions and omit it in certificate sessions.
 * Dependencies: axios, auth.store.
 */
import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeader() {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type IncidentStatus = 'REPORTED' | 'CONFIRMED' | 'CLOSED' | 'FALSE_ALARM';
export type EscalationLevel = 1 | 2 | 3;
export type Nis2Stage =
  | 'EARLY_WARNING'
  | 'NOTIFICATION'
  | 'INTERIM_REPORT'
  | 'PROGRESS_REPORT'
  | 'FINAL_REPORT';
/** Stages that carry report fields (the progress report shares the final report's). */
export type Nis2FieldStage = 'EARLY_WARNING' | 'NOTIFICATION' | 'FINAL_REPORT';
export type TriState = 'yes' | 'no' | 'unknown';
export type Nis2Severity = 'low' | 'medium' | 'high' | 'critical';
export type SuspendMeasure = 'BLOCK_CERTIFICATES' | 'REMOVE_LOGINS' | 'WITHDRAW' | 'MAIL_SITES';
export type IncidentEventType =
  | 'REPORTED'
  | 'CONFIRMED'
  | 'SUSPENDED'
  | 'MEASURE'
  | 'COMMENT'
  | 'SUSPENSION_LIFTED'
  | 'CLOSED'
  | 'FALSE_ALARM'
  | 'UPDATED';

export const NIS2_STAGES: readonly Nis2Stage[] = [
  'EARLY_WARNING',
  'NOTIFICATION',
  'INTERIM_REPORT',
  'PROGRESS_REPORT',
  'FINAL_REPORT',
];
export const SUSPEND_MEASURES: readonly SuspendMeasure[] = [
  'BLOCK_CERTIFICATES',
  'REMOVE_LOGINS',
  'WITHDRAW',
  'MAIL_SITES',
];

export interface IncidentSite {
  identifier: string;
  name: string;
}

export interface Nis2Entry {
  stage: Nis2Stage;
  /** Null for the interim report (the BSI requests it) and for a final report that waits for the closure. */
  dueAt: string | null;
  /** Final report only: the date still rests on the 72 h deadline, not on a ticked notification. */
  provisional: boolean;
  reportedAt: string | null;
  reportedBy: string | null;
  /** Interim report only: when the BSI asked for it. */
  requestedAt?: string | null;
  requestedBy?: string | null;
  /** Report fields; null for callers who may not see them and for stages without fields. */
  fields: Record<string, string> | null;
}

/** The report fields of the three stages that carry some (all optional while a draft). */
export interface Nis2FieldValues {
  suspectedMalicious?: TriState;
  crossBorder?: TriState;
  affectedServices?: string;
  severity?: Nis2Severity;
  impact?: string;
  iocs?: string;
  rootCause?: string;
  mitigation?: string;
  crossBorderFinal?: TriState;
}

export interface Incident {
  id: string;
  title: string;
  /** Admins and the reporter only; null for everyone else. */
  description: string | null;
  status: IncidentStatus;
  escalationLevel: EscalationLevel;
  organization: IncidentSite | null;
  reportedBy: string | null;
  /** Set when the report came through this organization's certificate session. */
  reportedByOrganization: string | null;
  reportedAt: string;
  detectedAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  suspended: boolean;
  zulipUrl: string | null;
  /** The NIS2 stages in the order of BSIG 32; the progress report only once it is due. */
  nis2: Nis2Entry[];
  /** `by` is null when it would name a reporter hidden from the caller. */
  dpoInformed: { at: string; by: string | null } | null;
  /** The caller may tick NIS2 stages and "DPO informed". */
  canAcknowledge: boolean;
  /** The caller reported it. */
  isMine: boolean;
}

export interface IncidentEvent {
  id: string;
  seq: number;
  at: string;
  actorEmail: string | null;
  type: IncidentEventType;
  details: Record<string, unknown> | null;
  prevHash: string;
  hash: string;
}

export interface IncidentChain {
  valid: boolean;
  brokenAt: number | null;
  /** Incident fields whose stored value no longer matches the timeline. */
  tamperedFields?: string[];
}

export interface IncidentDetail {
  incident: Incident;
  events: IncidentEvent[];
  chain: IncidentChain;
}

export interface ReportIncidentBody {
  organizationId?: string | null;
  title: string;
  description: string;
  escalationLevel: EscalationLevel;
  detectedAt?: string;
  dpoInformed?: boolean;
  zulipUrl?: string;
}

export interface MeasureResult {
  measure: SuspendMeasure;
  [key: string]: unknown;
}

export interface UpdateIncidentBody {
  escalationLevel?: EscalationLevel;
  detectedAt?: string;
  zulipUrl?: string | null;
}

export interface LiftSuspensionBody {
  causeFixed: true;
  fixTested: true;
  releasedByTechBoard: true;
  note: string;
}

export type CloseOutcome = 'CLOSED' | 'FALSE_ALARM';
export type ExportFormat = 'json' | 'csv';

/** Body with the step-up code when the session has one, without the key otherwise. */
function withCode<T extends object>(body: T, totpCode?: string): T & { totpCode?: string } {
  return totpCode !== undefined ? { ...body, totpCode } : body;
}

const USER = `${BASE}/incidents`;
const ADMIN = `${BASE}/admin/incidents`;

export const incidentsApi = {
  organizations: () =>
    axios.get<{ data: IncidentSite[] }>(`${USER}/organizations`, { headers: authHeader() }),
  list: () => axios.get<{ data: Incident[] }>(USER, { headers: authHeader() }),
  get: (id: string) =>
    axios.get<{ data: IncidentDetail }>(`${USER}/${id}`, { headers: authHeader() }),
  report: (body: ReportIncidentBody) =>
    axios.post<{ data: Incident }>(USER, body, { headers: authHeader() }),
  acknowledgeNis2: (id: string, stage: Nis2Stage) =>
    axios.post<{ data: Incident }>(`${USER}/${id}/nis2/${stage}`, undefined, {
      headers: authHeader(),
    }),
  /** Save report fields of a stage (a draft; an empty text clears a field). */
  saveNis2Fields: (id: string, stage: Nis2Stage, fields: Nis2FieldValues) =>
    axios.put<{ data: Incident }>(`${USER}/${id}/nis2/${stage}/fields`, fields, {
      headers: authHeader(),
    }),
  /** The BSI asked for an interim report on this date. */
  requestNis2Interim: (id: string, requestedAt: string) =>
    axios.post<{ data: Incident }>(
      `${USER}/${id}/nis2/interim-request`,
      { requestedAt },
      { headers: authHeader() },
    ),
  acknowledgeDpo: (id: string) =>
    axios.post<{ data: Incident }>(`${USER}/${id}/dpo-informed`, undefined, {
      headers: authHeader(),
    }),

  confirm: (id: string, totpCode?: string) =>
    axios.post<{ data: Incident }>(`${ADMIN}/${id}/confirm`, withCode({}, totpCode), {
      headers: authHeader(),
    }),
  suspend: (
    id: string,
    body: { measures: SuspendMeasure[]; confirm?: boolean },
    totpCode?: string,
  ) =>
    axios.post<{ data: { incident: Incident; results: MeasureResult[] } }>(
      `${ADMIN}/${id}/suspend`,
      withCode(body, totpCode),
      { headers: authHeader() },
    ),
  liftSuspension: (id: string, body: LiftSuspensionBody, totpCode?: string) =>
    axios.post<{ data: Incident }>(
      `${ADMIN}/${id}/lift-suspension`,
      withCode(body, totpCode),
      { headers: authHeader() },
    ),
  close: (id: string, body: { outcome: CloseOutcome; note: string }, totpCode?: string) =>
    axios.post<{ data: Incident }>(`${ADMIN}/${id}/close`, withCode(body, totpCode), {
      headers: authHeader(),
    }),
  comment: (id: string, text: string) =>
    axios.post<{ data: IncidentEvent }>(`${ADMIN}/${id}/comment`, { text }, {
      headers: authHeader(),
    }),
  /** Changing detectedAt or zulipUrl needs the step-up code. */
  update: (id: string, body: UpdateIncidentBody, totpCode?: string) =>
    axios.patch<{ data: Incident }>(`${ADMIN}/${id}`, withCode(body, totpCode), {
      headers: authHeader(),
    }),
  export: (id: string, format: ExportFormat) =>
    axios.get<Blob>(`${ADMIN}/${id}/export`, {
      headers: authHeader(),
      params: { format },
      responseType: 'blob',
    }),
};
