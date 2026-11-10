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
  ALREADY_ACKNOWLEDGED: 'incidentErrorALREADY_ACKNOWLEDGED',
};

export function incidentErrorMessage(err: unknown, fallback: string, t: T): string {
  const code = getErrorCode(err);
  if (code && CODE_KEY[code]) return t(CODE_KEY[code]);
  return getErrorMessageForStepUp(err, fallback, t('certStepUpFailedToast'));
}
