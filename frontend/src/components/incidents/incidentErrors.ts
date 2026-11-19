/**
 * incidentErrors.ts – one message for a failed incident write: the incident
 * register's own refusals (wrong status, no site, already or not suspended,
 * already recorded) in words, a certificate step-up failure as elsewhere, and
 * the backend message or the fallback for everything else.
 * Dependencies: lib/getErrorMessage, i18n keys.
 */
import type { TranslationKey } from '../../i18n/en';
import { getErrorCode, getErrorMessageForStepUp } from '../../lib/getErrorMessage';

type T = (key: TranslationKey) => string;

const CODE_KEY: Record<string, TranslationKey> = {
  INVALID_STATUS: 'incidentErrorINVALID_STATUS',
  NO_ORGANIZATION: 'incidentErrorNO_ORGANIZATION',
  ALREADY_SUSPENDED: 'incidentErrorALREADY_SUSPENDED',
  NOT_SUSPENDED: 'incidentErrorNOT_SUSPENDED',
  STILL_SUSPENDED: 'incidentErrorSTILL_SUSPENDED',
  NOT_ARCHIVABLE: 'incidentErrorNOT_ARCHIVABLE',
  ALREADY_ARCHIVED: 'incidentErrorALREADY_ARCHIVED',
  ALREADY_ACKNOWLEDGED: 'incidentErrorALREADY_ACKNOWLEDGED',
  INTERIM_NOT_REQUESTED: 'incidentErrorINTERIM_NOT_REQUESTED',
  STAGE_NOT_DUE: 'incidentErrorSTAGE_NOT_DUE',
  NIS2_FIELDS_INCOMPLETE: 'incidentErrorNIS2_FIELDS_INCOMPLETE',
  NIS2_STAGE_WITHOUT_FIELDS: 'incidentErrorNIS2_STAGE_WITHOUT_FIELDS',
  NOT_FALSE_ALARM: 'incidentErrorNOT_FALSE_ALARM',
  NOTHING_TO_LIFT: 'incidentErrorNOTHING_TO_LIFT',
  LIFT_ALREADY_PENDING: 'incidentErrorLIFT_ALREADY_PENDING',
  LIFT_NOT_PENDING: 'incidentErrorLIFT_NOT_PENDING',
  SELF_CONFIRM: 'incidentErrorSELF_CONFIRM',
  SAME_SITE: 'incidentErrorSAME_SITE',
  NOT_REQUESTER: 'incidentErrorNOT_REQUESTER',
  REASON_REQUIRED: 'incidentErrorREASON_REQUIRED',
};

export function incidentErrorMessage(err: unknown, fallback: string, t: T): string {
  const code = getErrorCode(err);
  if (code && CODE_KEY[code]) return t(CODE_KEY[code]);
  return getErrorMessageForStepUp(err, fallback, t('certStepUpFailedToast'));
}
