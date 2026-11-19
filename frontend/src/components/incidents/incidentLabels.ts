/**
 * incidentLabels.ts – translation keys and status tones of the incident
 * register's enums (status, NIS2 stage, event type, suspend measure, edited
 * field), plus the localized countdown text, so every incident view words and
 * colours them the same way.
 * Dependencies: incidents.api types, i18n keys, lib/statusColors, lib/nis2.
 */
import type {
  IncidentEventType,
  IncidentStatus,
  Nis2Stage,
  SuspendMeasure,
} from '../../api/incidents.api';
import type { TranslationKey } from '../../i18n/en';
import type { StatusTone } from '../../lib/statusColors';
import { splitDuration } from '../../lib/nis2';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

export const STATUS_KEY: Record<IncidentStatus, TranslationKey> = {
  REPORTED: 'incidentStatusREPORTED',
  CONFIRMED: 'incidentStatusCONFIRMED',
  CLOSED: 'incidentStatusCLOSED',
  FALSE_ALARM: 'incidentStatusFALSE_ALARM',
};

export const STATUS_TONE: Record<IncidentStatus, StatusTone> = {
  REPORTED: 'warning',
  CONFIRMED: 'danger',
  CLOSED: 'neutral',
  FALSE_ALARM: 'neutral',
};

export const STATUS_ICON: Record<IncidentStatus, string> = {
  REPORTED: 'flag',
  CONFIRMED: 'gpp_bad',
  CLOSED: 'task_alt',
  FALSE_ALARM: 'do_not_disturb_on',
};

export const STAGE_KEY: Record<Nis2Stage, TranslationKey> = {
  EARLY_WARNING: 'incidentNis2EARLY_WARNING',
  NOTIFICATION: 'incidentNis2NOTIFICATION',
  INTERIM_REPORT: 'incidentNis2INTERIM_REPORT',
  PROGRESS_REPORT: 'incidentNis2PROGRESS_REPORT',
  FINAL_REPORT: 'incidentNis2FINAL_REPORT',
};

export const EVENT_KEY: Record<IncidentEventType, TranslationKey> = {
  REPORTED: 'incidentEventREPORTED',
  CONFIRMED: 'incidentEventCONFIRMED',
  SUSPENDED: 'incidentEventSUSPENDED',
  MEASURE: 'incidentEventMEASURE',
  COMMENT: 'incidentEventCOMMENT',
  SUSPENSION_LIFTED: 'incidentEventSUSPENSION_LIFTED',
  CLOSED: 'incidentEventCLOSED',
  FALSE_ALARM: 'incidentEventFALSE_ALARM',
  UPDATED: 'incidentEventUPDATED',
  ARCHIVED: 'incidentEventARCHIVED',
};

export const EVENT_ICON: Record<IncidentEventType, string> = {
  REPORTED: 'flag',
  CONFIRMED: 'gpp_bad',
  SUSPENDED: 'block',
  MEASURE: 'build',
  COMMENT: 'chat',
  SUSPENSION_LIFTED: 'lock_open',
  CLOSED: 'task_alt',
  FALSE_ALARM: 'do_not_disturb_on',
  UPDATED: 'edit',
  ARCHIVED: 'inventory_2',
};

export const MEASURE_KEY: Record<SuspendMeasure, TranslationKey> = {
  BLOCK_CERTIFICATES: 'incidentMeasureBLOCK_CERTIFICATES',
  REMOVE_LOGINS: 'incidentMeasureREMOVE_LOGINS',
  WITHDRAW: 'incidentMeasureWITHDRAW',
  MAIL_SITES: 'incidentMeasureMAIL_SITES',
};

export const FIELD_KEY: Record<string, TranslationKey> = {
  escalationLevel: 'incidentFieldescalationLevel',
  detectedAt: 'incidentFielddetectedAt',
  zulipUrl: 'incidentFieldzulipUrl',
  nis2: 'incidentFieldnis2',
  nis2Fields: 'incidentFieldnis2Fields',
  nis2InterimRequest: 'incidentFieldnis2InterimRequest',
  dpoInformed: 'incidentFielddpoInformed',
};

/** "2 d 4 h" from a day on, "3 h 15 min" below. */
export function formatDuration(ms: number, t: T): string {
  const { days, hours, minutes } = splitDuration(ms);
  return days > 0
    ? t('incidentDurationDays', { d: days, h: hours })
    : t('incidentDurationHours', { h: hours, m: minutes });
}

/** Open = not closed and not a false alarm. */
export function isOpen(status: IncidentStatus): boolean {
  return status === 'REPORTED' || status === 'CONFIRMED';
}
