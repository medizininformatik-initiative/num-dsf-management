/**
 * AdminCertExpiryBanner.tsx – warns an admin when the certificate THIS session
 * logs in with expires within 30 days (warning) or 7 days (danger), with a
 * link to "My admin certificates" where a successor is registered. An admin
 * without a presented certificate (OTP session) or with a valid successor
 * beyond the window sees nothing. Dismissible; the dismissal lasts until the
 * next calendar day (localStorage, wrapped in try/catch). Rendered as a fixed
 * glass card above the routed content so it does not depend on the page layout.
 * Dependencies: adminCertificatesApi, useMe, lib/certStatus, StatusPill-free
 * tone tokens, Icon, Button, i18n store.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminCertificatesApi } from '../../api/adminCertificates.api';
import { useMe } from '../../hooks/useMe';
import { daysUntil } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

export const ADMIN_CERT_WARN_DAYS = 30;
export const ADMIN_CERT_DANGER_DAYS = 7;
export const ADMIN_CERT_DISMISS_KEY = 'dsf.adminCertBanner.dismissedOn';

/** Tone for the days left, or null when no warning is due. */
export function adminCertBannerTone(days: number): 'warning' | 'danger' | null {
  if (days <= ADMIN_CERT_DANGER_DAYS) return 'danger';
  if (days <= ADMIN_CERT_WARN_DAYS) return 'warning';
  return null;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function dismissedToday(): boolean {
  try {
    return localStorage.getItem(ADMIN_CERT_DISMISS_KEY) === today();
  } catch {
    return false;
  }
}

export function AdminCertExpiryBanner() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const [dismissed, setDismissed] = useState(dismissedToday);
  const { data: certs } = useQuery({
    queryKey: ['admin', 'certificates', 'mine'],
    queryFn: adminCertificatesApi.mine,
    enabled: !!me?.isAdmin,
    staleTime: 60_000,
  });

  const current = certs?.find((c) => c.current && c.validUntil);
  if (!me?.isAdmin || !current?.validUntil || dismissed) return null;
  const days = daysUntil(current.validUntil);
  const tone = adminCertBannerTone(days);
  if (!tone) return null;

  const surface =
    tone === 'danger'
      ? 'border-danger-border bg-danger-surface text-danger-fg'
      : 'border-warning-border bg-warning-surface text-warning-fg';

  return (
    <section
      role="alert"
      aria-label={t('adminCertBannerTitle')}
      data-tone={tone}
      className={`glass fixed left-1/2 top-16 z-40 flex w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 animate-list-item-in flex-wrap items-center gap-3 rounded-card border p-4 ${surface}`}
    >
      <Icon name={tone === 'danger' ? 'error' : 'warning'} size={20} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {days < 0 ? t('adminCertBannerExpired') : t('adminCertBannerBody', { n: days })}
        </p>
      </div>
      <Link
        to="/app/admin/certificates"
        className="press-effect rounded-control px-2 py-1 text-sm font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        {t('adminCertBannerLink')}
      </Link>
      <button
        type="button"
        aria-label={t('adminCertBannerDismiss')}
        className="press-effect inline-flex h-8 w-8 items-center justify-center rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
        onClick={() => {
          try {
            localStorage.setItem(ADMIN_CERT_DISMISS_KEY, today());
          } catch {
            /* dismissal only lasts for this view */
          }
          setDismissed(true);
        }}
      >
        <Icon name="close" size={18} />
      </button>
    </section>
  );
}
