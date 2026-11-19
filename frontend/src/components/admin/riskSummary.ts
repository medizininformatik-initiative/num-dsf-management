/**
 * riskSummary.ts — Turns the backend's risk assessment of a pending request into the pill(s) and
 * the compact text (at most two sentences) shown on the request card. Sentence 1 lists the risk
 * findings, highest severity first, joined with "; "; sentence 2 lists the mitigating and info
 * findings. Every finding code maps to an i18n template; codes this client does not know yet are
 * skipped. Pure: no React.
 * Dependencies: api/admin.api (types), i18n (TranslationKey), lib/statusColors (StatusTone)
 */
import type { RiskAssessment, RiskFinding } from '../../api/admin.api';
import type { TranslationKey } from '../../i18n/en';
import type { StatusTone } from '../../lib/statusColors';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Template per finding code; CERT_RENEWAL and the day counts get special handling below. */
const TEMPLATE: Record<string, TranslationKey> = {
  CERT_RENEWAL: 'riskCertRenewal',
  CERT_SHORT_VALIDITY: 'riskCertShortValidity',
  FIRST_REQUEST: 'riskFirstRequestText',
  NOTHING_CHANGED: 'riskNothingChanged',
  CERT_EARLY_REPLACE: 'riskCertEarlyReplace',
  CERT_ISSUER_CHANGED: 'riskCertIssuerChanged',
  CERT_CA_NOT_WHITELISTED: 'riskCertCaNotWhitelisted',
  CERT_CA_BLACKLISTED: 'riskCertCaBlacklisted',
  CERT_SUBJECT_MISMATCH: 'riskCertSubjectMismatch',
  CERT_ADDED: 'riskCertAdded',
  CERT_ALL_REPLACED: 'riskCertAllReplaced',
  ENDPOINT_ADDRESS_CHANGED: 'riskEndpointAddressChanged',
  ENDPOINT_FOREIGN_DOMAIN: 'riskEndpointForeignDomain',
  ENDPOINT_ADDED: 'riskEndpointAdded',
  ENDPOINT_REMOVED: 'riskEndpointRemoved',
  IP_ADDED: 'riskIpAdded',
  IP_REPLACED_ALL: 'riskIpReplacedAll',
  IP_PRIVATE: 'riskIpPrivate',
  IP_SHARED: 'riskIpShared',
  ORG_NAME_CHANGED: 'riskOrgNameChanged',
  ORG_DEACTIVATED: 'riskOrgDeactivated',
  CONTACT_DATA_CHANGED: 'riskContactDataChanged',
  CONTACTS_ALL_REPLACED: 'riskContactsAllReplaced',
  CONTACT_UNVALIDATED: 'riskContactUnvalidated',
  MEMBERSHIP_NEW_PARENT: 'riskMembershipNewParent',
  MEMBERSHIP_ROLE_ADDED: 'riskMembershipRoleAdded',
  MEMBERSHIP_REMOVED: 'riskMembershipRemoved',
  RECENT_REJECTIONS: 'riskRecentRejections',
  RECENT_WITHDRAWALS: 'riskRecentWithdrawals',
  NEW_SUBMIT_IP: 'riskNewSubmitIp',
  TAKEOVER_PATTERN: 'riskTakeoverPattern',
};

/** Codes whose `days` param follows "in" (dative in German: "in 12 Tagen"); the rest read nominative. */
const DATIVE_DAYS = new Set(['CERT_RENEWAL', 'CERT_SHORT_VALIDITY']);

function days(t: Translate, n: number, dative: boolean): string {
  const abs = Math.abs(n);
  if (abs === 1) return t(dative ? 'riskDaysOneDat' : 'riskDaysOneNom');
  return t(dative ? 'riskDaysManyDat' : 'riskDaysManyNom', { n: abs });
}

function fragment(finding: RiskFinding, t: Translate): string | null {
  let key = TEMPLATE[finding.code];
  if (!key) return null;
  const params: Record<string, string | number> = { ...finding.params };
  if (typeof params.days === 'number') {
    const n = params.days;
    if (finding.code === 'CERT_RENEWAL' && n < 0) key = 'riskCertRenewalExpired';
    params.days = days(t, n, DATIVE_DAYS.has(finding.code));
  }
  return t(key, params);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface RiskPill {
  tone: StatusTone;
  label: string;
  icon: string;
}

/** The pill(s) for the card: first-request marker and/or the level (LOW only when not first). */
export function riskPill(risk: RiskAssessment, t: Translate): RiskPill[] {
  const pills: RiskPill[] = [];
  if (risk.firstRequest) {
    pills.push({ tone: 'neutral', label: t('riskFirstRequest'), icon: 'fiber_new' });
  }
  if (risk.level === 'HIGH') {
    pills.push({ tone: 'danger', label: t('riskLevelHigh'), icon: 'gpp_maybe' });
  } else if (risk.level === 'MEDIUM') {
    pills.push({ tone: 'warning', label: t('riskLevelMedium'), icon: 'visibility' });
  } else if (!risk.firstRequest) {
    pills.push({ tone: 'success', label: t('riskLevelLow'), icon: 'check_circle' });
  }
  return pills;
}

/** At most two sentences covering every finding the client can word. */
export function buildRiskSummary(risk: RiskAssessment, t: Translate): string {
  const texts = (list: RiskFinding[]) =>
    list.map((f) => fragment(f, t)).filter((s): s is string => s !== null);
  const risky = texts(risk.findings.filter((f) => f.severity !== 'info'));
  const calm = texts(risk.findings.filter((f) => f.severity === 'info'));
  const sentences: string[] = [];
  if (risky.length > 0) {
    const lead =
      risk.level === 'HIGH'
        ? t('riskLeadHigh')
        : risk.level === 'MEDIUM'
          ? t('riskLeadMedium')
          : t('riskLeadLow');
    sentences.push(`${lead}: ${risky.join('; ')}.`);
  }
  if (calm.length > 0) sentences.push(`${capitalize(calm.join('; '))}.`);
  if (sentences.length === 0) return t('riskNoChange');
  return sentences.join(' ');
}
