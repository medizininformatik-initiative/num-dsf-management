/**
 * riskSummary.ts — Turns the backend's risk assessment of a pending request into the pill(s) and
 * the compact text (at most two sentences) shown on the request card. Sentence 1 lists the risk
 * findings, highest severity first (the five most severe, then "+n more"), joined with "; ";
 * sentence 2 lists the mitigating and info findings. Every finding code maps to an i18n template;
 * a code this client does not know yet is shown generically. Site-supplied strings (names,
 * hosts, addresses) are stripped of control characters, collapsed and truncated before they are
 * interpolated. Pure: no React.
 * Dependencies: api/admin.api (types), i18n (TranslationKey), lib/statusColors (StatusTone)
 */
import type { RiskAssessment, RiskFinding, RiskSeverity } from '../../api/admin.api';
import type { TranslationKey } from '../../i18n/en';
import type { StatusTone } from '../../lib/statusColors';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Template per finding code; the day counts and a few codes get special handling below. */
const TEMPLATE: Record<string, TranslationKey> = {
  CERT_RENEWAL: 'riskCertRenewal',
  CERT_SHORT_VALIDITY: 'riskCertShortValidity',
  CERT_EXPIRED: 'riskCertExpired',
  CERT_NOT_COMPARABLE: 'riskCertNotComparable',
  CERT_SUBJECT_CHANGED: 'riskCertSubjectChanged',
  FIRST_REQUEST: 'riskFirstRequestText',
  NOTHING_CHANGED: 'riskNothingChanged',
  SNAPSHOT_UNREADABLE: 'riskSnapshotUnreadable',
  CERT_EARLY_REPLACE: 'riskCertEarlyReplace',
  CERT_ISSUER_CHANGED: 'riskCertIssuerChanged',
  CERT_CA_NOT_WHITELISTED: 'riskCertCaNotWhitelisted',
  CERT_CA_BLACKLISTED: 'riskCertCaBlacklisted',
  CERT_SUBJECT_MISMATCH: 'riskCertSubjectMismatch',
  CERT_ADDED: 'riskCertAdded',
  CERT_ALL_REPLACED: 'riskCertAllReplaced',
  ENDPOINT_ADDRESS_CHANGED: 'riskEndpointAddressChanged',
  ENDPOINT_SCHEME_DOWNGRADE: 'riskEndpointSchemeDowngrade',
  ENDPOINT_URL_CHANGED: 'riskEndpointUrlChanged',
  ENDPOINT_ADDRESS_UNREADABLE: 'riskEndpointAddressUnreadable',
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
  CONTACT_DATA_NOT_COMPARABLE: 'riskContactDataNotComparable',
  CONTACTS_ALL_REPLACED: 'riskContactsAllReplaced',
  CONTACT_UNVALIDATED: 'riskContactUnvalidated',
  CONTACT_ROLE_CHANGED: 'riskContactRoleChanged',
  MEMBERSHIP_NEW_PARENT: 'riskMembershipNewParent',
  MEMBERSHIP_ROLE_ADDED: 'riskMembershipRoleAdded',
  MEMBERSHIP_REMOVED: 'riskMembershipRemoved',
  RECENT_REJECTIONS: 'riskRecentRejections',
  RECENT_WITHDRAWALS: 'riskRecentWithdrawals',
  NEW_SUBMIT_IP: 'riskNewSubmitIp',
  TAKEOVER_PATTERN: 'riskTakeoverPattern',
};

/** Codes whose `days` param follows "in" / "seit" (dative in German: "in 12 Tagen"). */
const DATIVE_DAYS = new Set(['CERT_RENEWAL', 'CERT_SHORT_VALIDITY', 'CERT_EXPIRED']);

const MAX_RISKS = 5;
const MAX_CALM = 3;
const MAX_PARAM_LENGTH = 40;
const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 3, medium: 2, low: 1, info: 0 };

// Control and bidirectional-formatting characters a site could smuggle into a name.
const UNSAFE_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]',
  'g',
);

/** Site-supplied text made safe for one line of the summary. */
function clean(value: string | number): string | number {
  if (typeof value === 'number') return value;
  const text = value.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_PARAM_LENGTH ? `${text.slice(0, MAX_PARAM_LENGTH - 1)}…` : text;
}

function days(t: Translate, n: number, dative: boolean): string {
  const abs = Math.abs(n);
  if (abs === 1) return t(dative ? 'riskDaysOneDat' : 'riskDaysOneNom');
  return t(dative ? 'riskDaysManyDat' : 'riskDaysManyNom', { n: abs });
}

function fragment(finding: RiskFinding, t: Translate): string {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(finding.params ?? {})) params[k] = clean(v);
  let key = TEMPLATE[finding.code];
  if (!key) return t('riskUnknownFinding', { code: clean(finding.code) });
  if (typeof params.days === 'number') {
    const n = params.days;
    if (finding.code === 'CERT_RENEWAL' && n < 0) key = 'riskCertRenewalExpired';
    else if (finding.code === 'CERT_RENEWAL' && n === 0) key = 'riskCertRenewalToday';
    else if (finding.code === 'CERT_SHORT_VALIDITY' && n < 0) key = 'riskCertExpired';
    params.days = days(t, n, DATIVE_DAYS.has(finding.code));
  }
  if (finding.code === 'CERT_NOT_COMPARABLE' && !params.cn) key = 'riskCertNotComparableAll';
  if (finding.code === 'TAKEOVER_PATTERN') {
    if (params.after === 'contact') key = 'riskTakeoverSplitContact';
    else if (params.after === 'endpoint') key = 'riskTakeoverSplitEndpoint';
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

/** The first `max` fragments, then "+n more" for the rest. */
function capped(items: string[], max: number, t: Translate): string[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), t('riskMore', { n: items.length - max })];
}

/** At most two sentences covering every finding. */
export function buildRiskSummary(risk: RiskAssessment, t: Translate): string {
  const sorted = [...risk.findings].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
  const risky = sorted.filter((f) => f.severity !== 'info').map((f) => fragment(f, t));
  const calm = sorted.filter((f) => f.severity === 'info').map((f) => fragment(f, t));
  const sentences: string[] = [];
  if (risky.length > 0) {
    const lead =
      risk.level === 'HIGH'
        ? t('riskLeadHigh')
        : risk.level === 'MEDIUM'
          ? t('riskLeadMedium')
          : t('riskLeadLow');
    sentences.push(`${lead}: ${capped(risky, MAX_RISKS, t).join('; ')}.`);
  }
  if (calm.length > 0) sentences.push(`${capitalize(capped(calm, MAX_CALM, t).join('; '))}.`);
  // Findings that are all info (or none) while the data did change: say so, never "nothing".
  if (sentences.length === 0) return t('riskNoChange');
  return sentences.join(' ');
}
