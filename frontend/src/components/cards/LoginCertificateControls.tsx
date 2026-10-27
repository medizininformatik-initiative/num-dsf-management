/**
 * LoginCertificateControls.tsx — building blocks of the certificate login ("Login" flag) in
 * the certificates card: LoginBadge (info pill on a certificate that may sign in as the
 * organization), LoginSwitch (admin-only switch "Allow for login") and
 * LoginFingerprintEntries (login entries without an uploaded certificate, e.g. from the
 * onboarding import: the full 128-hex SHA-512, copyable, with an admin remove action).
 * Dependencies: StatusPill, Button, Icon, CertificateFingerprint, lib/dateUtils, i18n store.
 */
import { useId, type CSSProperties } from 'react';
import { CertificateFingerprint } from './CertificateFingerprint';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { formatDate } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import type { TranslationKey } from '../../i18n/en';
import type { LoginCertificate } from '../../api/loginCertificates.api';

export function LoginBadge() {
  const { t } = useI18n();
  return (
    <StatusPill tone="info" icon="login" title={t('loginCertBadgeHint')} className="shrink-0">
      {t('loginCertBadge')}
    </StatusPill>
  );
}

/** Admin switch; role="switch" button so it is keyboard- and screen-reader-operable. */
export function LoginSwitch({
  checked,
  name,
  onToggle,
  eligible = true,
}: {
  checked: boolean;
  name: string;
  onToggle: () => void;
  /** False when the clinic did not upload this certificate itself: it cannot be enabled. */
  eligible?: boolean;
}) {
  const { t } = useI18n();
  const hintId = useId();
  // An already enabled certificate can always be withdrawn.
  const blocked = !checked && !eligible;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={t('loginCertSwitchAria', { name })}
        aria-describedby={blocked ? hintId : undefined}
        disabled={blocked}
        onClick={onToggle}
        className={`press-effect disabled:cursor-not-allowed disabled:opacity-60 relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-[color:var(--border)] transition-colors duration-short ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
          checked ? 'bg-[color:var(--accent-solid)]' : 'bg-[color:var(--bg-card)]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-short ease-spring ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      <span aria-hidden="true" className="text-[11px] text-[color:var(--text-secondary)]">
        {t('loginCertSwitchLabel')}
      </span>
      {blocked && (
        <p id={hintId} className="basis-full text-[11px] text-[color:var(--text-secondary)]">
          {t('loginCertNotClinicHint')}
        </p>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<LoginCertificate['source'], TranslationKey> = {
  ONBOARDING: 'loginFingerprintSourceOnboarding',
  MIGRATED: 'loginFingerprintSourceMigrated',
  ADMIN: 'loginFingerprintSourceAdmin',
  APPROVAL: 'loginFingerprintSourceApproval',
};

export function LoginFingerprintEntries({
  entries,
  isAdmin,
  onRemove,
}: {
  entries: LoginCertificate[];
  isAdmin: boolean;
  onRemove: (entry: LoginCertificate) => void;
}) {
  const { t, lang } = useI18n();
  if (entries.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-3" data-testid="login-fingerprint-entries">
      {entries.map((entry, index) => (
        <li
          key={entry.fingerprint}
          className="hover-lift animate-list-item-in rounded-xl bg-[color:var(--bg-hover)] p-3.5"
          style={{ '--stagger-index': index } as CSSProperties}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[color:var(--text-primary)]">
                {t('loginFingerprintTitle')}
              </p>
              <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
                {t(SOURCE_LABEL[entry.source])} · {formatDate(entry.createdAt, lang)}
              </p>
            </div>
            <LoginBadge />
          </div>
          <CertificateFingerprint
            className="mt-3"
            label={t('certCardDsfThumbprintLabel')}
            hex={entry.fingerprint}
            copyLabel={t('certCardCopyThumbprint')}
            copiedMessage={t('certCardThumbprintCopied')}
          />
          {isAdmin && (
            <div className="mt-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('loginFingerprintRemoveAria', {
                  prefix: entry.fingerprint.slice(0, 12),
                })}
                onClick={() => onRemove(entry)}
                className="text-danger-fg hover:!bg-danger-surface hover:!text-danger-fg"
              >
                <Icon name="delete" size={16} />
                {t('loginFingerprintRemove')}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
