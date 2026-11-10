/**
 * TanLowBanner.tsx – warns an administrator with an active authenticator app
 * when only a few TANs are left (3 or fewer), with a link to the security page
 * where a new list is generated. Nothing is shown to anyone else, on the
 * security page itself, or while enrolment is still pending. Dismissible for
 * the current view only, so it returns until the list is renewed.
 * Dependencies: useTotpStatus, useMe, Icon, i18n store.
 */
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LOW_TAN_THRESHOLD, useTotpStatus } from '../../hooks/useTotpStatus';
import { useMe } from '../../hooks/useMe';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

export function TanLowBanner() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const status = useTotpStatus(!!me?.isAdmin);
  const [dismissed, setDismissed] = useState(false);

  if (!me?.isAdmin || !status.data?.enabled || dismissed) return null;
  if (status.data.remainingTans > LOW_TAN_THRESHOLD || pathname === '/app/security') return null;

  return (
    <section
      role="alert"
      aria-label={t('securityTitle')}
      className="glass fixed left-1/2 top-28 z-40 flex w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-3 rounded-card border border-warning-border bg-warning-surface p-4 text-warning-fg"
    >
      <Icon name="warning" size={20} className="shrink-0" />
      <p className="min-w-0 flex-1 text-sm font-semibold">
        {t('securityTansLow', { n: status.data.remainingTans })}
      </p>
      <Link
        to="/app/security"
        className="press-effect rounded-control px-2 py-1 text-sm font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        {t('securityLowBannerLink')}
      </Link>
      <button
        type="button"
        aria-label={t('adminCertBannerDismiss')}
        className="press-effect inline-flex h-8 w-8 items-center justify-center rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
        onClick={() => setDismissed(true)}
      >
        <Icon name="close" size={18} />
      </button>
    </section>
  );
}
