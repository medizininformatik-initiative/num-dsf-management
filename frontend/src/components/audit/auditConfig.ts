/**
 * auditConfig.ts – shared constants of the audit components: filter form shape,
 * resource / operation options and their labels and tones.
 * Dependencies: i18n keys (en.ts), statusColors (tones)
 */
import type { TranslationKey } from '../../i18n/en';
import type { StatusTone } from '../../lib/statusColors';

export interface AuditFilterForm {
  from: string;
  to: string;
  actor: string;
  instanceId: string;
  resource: string;
  operation: string;
  q: string;
  flaggedOnly: boolean;
}

export const EMPTY_FILTERS: AuditFilterForm = {
  from: '',
  to: '',
  actor: '',
  instanceId: '',
  resource: '',
  operation: '',
  q: '',
  flaggedOnly: false,
};

export const RESOURCE: Record<string, TranslationKey> = {
  ORGANIZATION: 'shellEntityOrganization',
  CONTACT: 'shellEntityContact',
  ENDPOINT: 'shellEntityEndpoint',
  CERTIFICATE: 'shellEntityCertificate',
  MEMBERSHIP: 'shellEntityMembership',
  AUTH: 'shellEntityAuth',
  APPROVAL: 'shellEntityApproval',
  MARKETPLACE: 'shellEntityMarketplace',
  AUDIT: 'auditEntityAudit',
};

export const OPERATION: Record<string, { tone: StatusTone; label: TranslationKey }> = {
  CREATE: { tone: 'success', label: 'shellOpCreate' },
  UPDATE: { tone: 'info', label: 'shellOpUpdate' },
  DELETE: { tone: 'danger', label: 'shellOpDelete' },
  APPROVE: { tone: 'success', label: 'shellOpApprove' },
  REJECT: { tone: 'warning', label: 'shellOpReject' },
  LOGIN: { tone: 'info', label: 'shellOpLogin' },
  LOGOUT: { tone: 'neutral', label: 'shellOpLogout' },
  OTP_REQUEST: { tone: 'neutral', label: 'shellOpOtpRequest' },
  OTP_VERIFY: { tone: 'info', label: 'shellOpOtpVerify' },
  TOTP_SETUP: { tone: 'info', label: 'shellOpTotpSetup' },
  TOTP_VERIFY: { tone: 'info', label: 'shellOpTotpVerify' },
  FAILED_LOGIN: { tone: 'danger', label: 'shellOpFailedLogin' },
  WITHDRAW: { tone: 'neutral', label: 'shellOpWithdraw' },
  DENIED: { tone: 'danger', label: 'auditOpDenied' },
  STEP_UP_FAILED: { tone: 'danger', label: 'auditOpStepUpFailed' },
  RATE_LIMITED: { tone: 'warning', label: 'auditOpRateLimited' },
  EXPORT: { tone: 'info', label: 'auditOpExport' },
};

export const RESOURCE_OPTIONS: Array<[string, TranslationKey]> = Object.entries(RESOURCE);

export const OPERATION_OPTIONS: Array<[string, TranslationKey]> = Object.entries(OPERATION).map(
  ([value, { label }]) => [value, label],
);
