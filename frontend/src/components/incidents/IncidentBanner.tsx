/**
 * IncidentBanner.tsx – the red band above every page while a confirmed,
 * unclosed incident exists, for every signed-in user: one incident names its
 * title, site and confirmation date, several are counted. It links to the
 * incident page (admins to the admin page), straight to the incident when
 * there is only one. Not dismissible: it disappears when the incident is
 * closed. role="alert" so it is announced when it appears.
 * Dependencies: useActiveIncidents, useMe, lib/dateUtils, Icon, i18n store,
 * react-router.
 */
import { Link } from 'react-router-dom';
import { useActiveIncidents } from '../../hooks/useIncidents';
import { useMe } from '../../hooks/useMe';
import { formatDate } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

export function IncidentBanner() {
  const { t, lang } = useI18n();
  const { data: me } = useMe();
  const active = useActiveIncidents();
  if (active.length === 0) return null;

  const base = me?.isAdmin ? '/app/admin/incidents' : '/app/incidents';
  const only = active.length === 1 ? active[0] : null;
  const to = only ? `${base}?id=${encodeURIComponent(only.id)}` : base;

  return (
    <section
      role="alert"
      aria-label={t('incidentBannerTitle')}
      data-testid="incident-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-danger-border bg-danger-surface px-4 py-2.5 text-sm text-danger-fg xl:px-6"
    >
      <Icon name="gpp_bad" size={20} className="shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{t('incidentBannerTitle')}</span>
        <span className="mx-1.5" aria-hidden="true">
          –
        </span>
        {only
          ? t('incidentBannerOne', {
              title: only.title,
              site: only.organization?.name ?? t('incidentSiteUnknownShort'),
              date: only.confirmedAt ? formatDate(only.confirmedAt, lang) : '',
            })
          : t('incidentBannerMany', { n: active.length })}
      </p>
      <Link
        to={to}
        className="press-effect shrink-0 rounded-control px-2 py-1 font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        {t('incidentBannerLink')}
      </Link>
    </section>
  );
}
