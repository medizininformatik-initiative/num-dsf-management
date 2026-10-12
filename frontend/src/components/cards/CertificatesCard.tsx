/**
 * CertificatesCard.tsx — entity card listing the organization's certificates. Each row shows
 * its validity state (certValidity: valid / expiring / renew now / expired) as a StatusPill, a
 * validity bar in the same tone and the days left or since expiry, whether DSF trusts the
 * issuer, the full DSF fingerprint (SHA-512) with copy, and the SHA-256 fingerprint in a
 * collapsed disclosure; the header lock follows the worst certificate. Rows stagger in, carry
 * data-entity-row="certificates:<id>" for relation targets, and the body shows a skeleton or
 * an error with retry while the query loads or fails. Supports renew/add (via useModals) and
 * confirmed, cross-user-guarded deletion that warns before the last valid certificate goes.
 * A certificate that may log in as the organization carries a "Login" badge; admins get a
 * switch to allow/withdraw it (step-up dialog), and login fingerprints without an uploaded
 * certificate (onboarding/migration) are listed below the certificates.
 * Dependencies: useCertificates, useLoginCertificates, useMe, useOrganization, lib/certStatus, lib/dateUtils, confirmDelete,
 * EntityCard, FkLink, CertificateFingerprint, StatusPill, Button, Icon.
 */
import { useId, useState, type CSSProperties } from 'react';
import { useCertificates, useDeleteCertificate } from '../../hooks/useCertificates';
import { useOrganization } from '../../hooks/useOrganization';
import { useLoginCertificates } from '../../hooks/useLoginCertificates';
import { useMe } from '../../hooks/useMe';
import { LoginBadge, LoginFingerprintEntries, LoginSwitch } from './LoginCertificateControls';
import { useLoginCertificateActions } from './useLoginCertificateActions';
import { EntityCard } from './EntityCard';
import { FkLink } from './FkLink';
import { Details, DetailsToggle } from './CardDetails';
import { useCardDetails } from '../../hooks/useCardDetails';
import { CertificateFingerprint, CERTTOOL_COMMAND } from './CertificateFingerprint';
import { useModals } from '../../hooks/useModals';
import { formatDate } from '../../lib/dateUtils';
import {
  CERT_CRITICAL_DAYS,
  CERT_STATE_TONE,
  CERT_WARNING_DAYS,
  certValidity,
  type CertState,
} from '../../lib/certStatus';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import type { ApiCertificate } from '../../api/entities.api';
import type { LoginCertificate } from '../../api/loginCertificates.api';
import { useConfirmDelete } from '../../lib/confirmDelete';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

type CertRow = Pick<
  ApiCertificate,
  | 'id'
  | 'subject'
  | 'valid_until'
  | 'thumbprint'
  | 'thumbprintSha512'
  | 'issuerDn'
  | 'issuerTrusted'
>;

type CertTone = (typeof CERT_STATE_TONE)[CertState];

/** Ascending severity, for the card's overall (worst) state. */
const SEVERITY: CertState[] = ['valid', 'warning', 'critical', 'expired'];

const STATE_LABEL: Record<CertState, TranslationKey> = {
  valid: 'certCardStateValid',
  warning: 'certCardStateWarning',
  critical: 'certCardStateCritical',
  expired: 'certCardStateExpired',
};

const STATE_ICON: Record<CertState, string> = {
  valid: 'check_circle',
  warning: 'schedule',
  critical: 'error',
  expired: 'cancel',
};

const HEADER_ICON: Record<CertState, string> = {
  valid: 'lock',
  warning: 'lock_clock',
  critical: 'lock_clock',
  expired: 'lock_open',
};

const TONE_TEXT: Record<CertTone, string> = {
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
};

const TONE_FILL: Record<CertTone, string> = {
  success: 'bg-success-fg',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg',
};

export function CertificatesCard({ instanceId }: { instanceId: string }) {
  const { t, lang } = useI18n();
  const { data, isLoading, isError, refetch } = useCertificates(instanceId);
  const certs: CertRow[] = data ?? [];
  const { data: org } = useOrganization(instanceId);
  const isAdmin = useMe().data?.isAdmin === true;
  const loginEntries: LoginCertificate[] = useLoginCertificates(instanceId).data ?? [];
  const loginActions = useLoginCertificateActions(instanceId, org?.identifier);
  const loginOf = (cert: CertRow) =>
    loginEntries.find(
      (e) => e.certificateId === cert.id || e.fingerprint === cert.thumbprintSha512,
    );
  // Login entries that no listed certificate explains (onboarding / migration).
  const fingerprintOnly = loginEntries.filter(
    (e) => !certs.some((c) => e.certificateId === c.id || e.fingerprint === c.thumbprintSha512),
  );
  const deleteMut = useDeleteCertificate(instanceId);
  const confirmDelete = useConfirmDelete();
  const details = useCardDetails();

  const worst = certs.reduce<CertState | null>((acc, cert) => {
    const { state } = certValidity(cert.valid_until);
    return acc === null || SEVERITY.indexOf(state) > SEVERITY.indexOf(acc) ? state : acc;
  }, null);
  const overallLabel =
    worst === 'expired'
      ? t('certCardOverallExpired')
      : worst === 'critical'
        ? t('certCardOverallSoon', { n: CERT_CRITICAL_DAYS })
        : worst === 'warning'
          ? t('certCardOverallSoon', { n: CERT_WARNING_DAYS })
          : t('certCardOverallValid');
  const needsRenewal = worst === 'critical' || worst === 'expired';

  function requestDelete(cert: CertRow) {
    const name = cert.subject || t('certCardFallbackName');
    const stillValid = (c: CertRow) => certValidity(c.valid_until).state !== 'expired';
    const lastValid = stillValid(cert) && certs.filter(stillValid).length === 1;
    void confirmDelete({
      label: name,
      title: t('certCardDeleteTitle'),
      message: t('certCardDeleteMessage', { name, date: formatDate(cert.valid_until, lang) }),
      consequence: lastValid ? t('certCardDeleteLastValid') : t('certCardDeleteConsequence'),
      confirmLabel: t('certRemoveBtn'),
      remove: () => deleteMut.mutateAsync(cert.id),
    });
  }

  return (
    <EntityCard
      id="certificates"
      title={t('certificates')}
      borderColor="#f5a623"
      iconColor="var(--tone-warning-fg)"
      icon="verified_user"
      status={isLoading ? 'loading' : isError && !data ? 'error' : 'ready'}
      onRetry={() => void refetch()}
      badge={
        worst && (
          <Icon
            name={HEADER_ICON[worst]}
            size={18}
            label={overallLabel}
            title={overallLabel}
            className={TONE_TEXT[CERT_STATE_TONE[worst]]}
          />
        )
      }
      headerRight={
        certs.length > 0 && (
          <Button
            variant={needsRenewal ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => useModals.getState().openModal('cert-renew')}
          >
            {t('certRenewBtn')}
          </Button>
        )
      }
      onAdd={() => useModals.getState().openModal('certificate-add')}
    >
      {org && (
        <FkLink
          label={t('certCardFkOrganization')}
          targetEntity="organization"
          value={org.identifier}
        />
      )}

      {certs.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-3">
          {certs.map((cert, index) => {
            const login = loginOf(cert);
            return (
              <CertificateItem
                key={cert.id}
                cert={cert}
                index={index}
                detailed={details.detailed}
                isLogin={!!login}
                canManageLogin={isAdmin && !!org}
                onToggleLogin={() =>
                  loginActions.request(
                    login
                      ? {
                          kind: 'disable',
                          fingerprint: login.fingerprint,
                          name: cert.subject || t('certCardFallbackName'),
                        }
                      : {
                          kind: 'enable',
                          certificateId: cert.id,
                          name: cert.subject || t('certCardFallbackName'),
                        },
                  )
                }
                onRemove={() => requestDelete(cert)}
              />
            );
          })}
        </ul>
      ) : (
        fingerprintOnly.length === 0 && (
          <p className="py-4 text-center text-xs text-[color:var(--text-muted)]">
            {t('emptyCertificatesHint')}
          </p>
        )
      )}

      <Details show={details.detailed}>
        <LoginFingerprintEntries
          entries={fingerprintOnly}
          isAdmin={isAdmin && !!org}
          onRemove={(entry) =>
            loginActions.request({
              kind: 'disable',
              fingerprint: entry.fingerprint,
              name: `${entry.fingerprint.slice(0, 16)}…`,
            })
          }
        />
      </Details>
      <DetailsToggle details={details} />
      {loginActions.dialog}
    </EntityCard>
  );
}

function CertificateItem({
  cert,
  index,
  detailed,
  isLogin,
  canManageLogin,
  onToggleLogin,
  onRemove,
}: {
  cert: CertRow;
  index: number;
  detailed: boolean;
  isLogin: boolean;
  canManageLogin: boolean;
  onToggleLogin: () => void;
  onRemove: () => void;
}) {
  const { t, lang } = useI18n();
  const { state, days } = certValidity(cert.valid_until);
  const tone = CERT_STATE_TONE[state];
  const pct = Math.max(0, Math.min(100, (days / 365) * 100));
  const name = cert.subject || t('certCardFallbackName');

  return (
    <li
      data-entity-row={`certificates:${cert.id}`}
      className="hover-lift animate-list-item-in rounded-xl bg-[color:var(--bg-hover)] p-3.5"
      style={{ '--stagger-index': index } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="mono-id break-all text-xs font-semibold text-[color:var(--text-primary)]">
            {name}
          </p>
          <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
            {t('certCardValidUntil', { date: formatDate(cert.valid_until, lang) })}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusPill tone={tone} icon={STATE_ICON[state]}>
            {t(STATE_LABEL[state])}
          </StatusPill>
          {isLogin && <LoginBadge />}
        </div>
      </div>

      {!detailed && !cert.issuerTrusted && (
        // The simplified view drops the explanation but keeps the warning.
        <StatusPill tone="warning" icon="gpp_maybe" className="mt-2">
          {t('certCardIssuerUntrusted')}
        </StatusPill>
      )}

      <Details show={detailed}>
        <div className="mt-3 flex items-center gap-2">
          <div
            aria-hidden="true"
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--border)]"
          >
            <div
              className={`h-full rounded-full ${TONE_FILL[tone]}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={`text-[11px] font-bold ${TONE_TEXT[tone]}`}>
            {state === 'expired'
              ? t('certCardExpiredDaysAgo', { n: -days })
              : t('certDaysLeft', { n: days })}
          </span>
        </div>

        <CertificateIssuer issuerDn={cert.issuerDn} trusted={cert.issuerTrusted} />

        <CertificateFingerprints cert={cert} />
      </Details>

      <div className="mt-2 flex items-center justify-between gap-2">
        {detailed && canManageLogin ? (
          <LoginSwitch checked={isLogin} name={name} onToggle={onToggleLogin} />
        ) : (
          <span />
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('certCardRemoveAria', { name })}
          onClick={onRemove}
          className="text-danger-fg hover:!bg-danger-surface hover:!text-danger-fg"
        >
          <Icon name="delete" size={16} />
          {t('certRemoveBtn')}
        </Button>
      </div>
    </li>
  );
}

function CertificateFingerprints({ cert }: { cert: CertRow }) {
  const { t } = useI18n();
  return (
    <>
      <CertificateFingerprint
        className="mt-3"
        label={t('certCardDsfThumbprintLabel')}
        hex={cert.thumbprintSha512}
        copyLabel={t('certCardCopyThumbprint')}
        copiedMessage={t('certCardThumbprintCopied')}
        description={t('certThumbprintDescription')}
        command={{
          text: CERTTOOL_COMMAND,
          copyLabel: t('certThumbprintCopyCommand'),
          copiedMessage: t('certThumbprintCommandCopied'),
        }}
      />
      <details className="group/more mt-2">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-md text-[11px] font-semibold text-[color:var(--text-secondary)] transition-colors duration-short ease-standard hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] [&::-webkit-details-marker]:hidden">
          <Icon
            name="chevron_right"
            size={16}
            className="transition-transform duration-short ease-spring group-open/more:rotate-90"
          />
          {t('certCardMoreFingerprints')}
        </summary>
        <CertificateFingerprint
          className="mt-1.5 animate-fade-in"
          label={t('certCardSha256Label')}
          hex={cert.thumbprint}
          copyLabel={t('certCardCopySha256')}
          copiedMessage={t('certCardSha256Copied')}
        />
      </details>
    </>
  );
}

/** The CN of a DN such as "C=GR,O=…,CN=GEANT TLS RSA 1"; the whole DN when it has none. */
function commonName(dn: string): string {
  const match = /(?:^|,)\s*CN=((?:\\.|[^,])+)/i.exec(dn);
  return match ? match[1].trim() : dn;
}

/**
 * Whether DSF trusts the issuer: a "DSF-CA" pill revealing the issuer CN on hover or focus
 * (also its accessible description; Escape hides it), or a warning that production DSF
 * instances refuse certificates from other CAs, with the issuer DN.
 */
function CertificateIssuer({ issuerDn, trusted }: { issuerDn: string; trusted: boolean }) {
  const { t } = useI18n();
  const hintId = useId();
  const [dismissed, setDismissed] = useState(false);

  if (trusted) {
    const issuer = commonName(issuerDn);
    return (
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px] text-[color:var(--text-muted)]">
          {t('certCardIssuerLabel')}
        </span>
        <span
          className="group/issuer relative inline-flex"
          onMouseLeave={() => setDismissed(false)}
        >
          <StatusPill
            tone="success"
            icon="verified"
            tabIndex={0}
            aria-describedby={hintId}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDismissed(true);
            }}
            onBlur={() => setDismissed(false)}
            className="cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
          >
            {t('certCardIssuerTrusted')}
          </StatusPill>
          <span id={hintId} className="sr-only">
            {t('certCardIssuerTrustedHint', { issuer })}
          </span>
          {/* Visual tooltip; the description above gives screen readers the same. */}
          <span
            aria-hidden="true"
            className={`invisible absolute bottom-full left-0 z-20 pb-1.5 opacity-0 transition-[opacity,visibility] duration-short ease-standard group-focus-within/issuer:visible group-focus-within/issuer:opacity-100 group-hover/issuer:visible group-hover/issuer:opacity-100 ${
              dismissed ? '!invisible !opacity-0' : ''
            }`}
          >
            <span className="glass-thin block w-max max-w-[16rem] rounded-lg px-2 py-1 text-[11px] text-[color:var(--text-primary)]">
              {issuer}
            </span>
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[color:var(--text-muted)]">
          {t('certCardIssuerLabel')}
        </span>
        <StatusPill tone="warning" icon="gpp_maybe">
          {t('certCardIssuerUntrusted')}
        </StatusPill>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[color:var(--text-secondary)]">
        {t('certCardIssuerUntrustedHint')}
      </p>
      {issuerDn && (
        <p className="mono-id mt-1 break-all text-[11px] leading-4 text-[color:var(--text-muted)]">
          {issuerDn}
        </p>
      )}
    </div>
  );
}
