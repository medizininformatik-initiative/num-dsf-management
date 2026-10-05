/**
 * Breadcrumbs.tsx – Shows the way up from nested routes (/app/x/y): translated
 * ancestor links in the accent colour. The current page stays in the trail
 * for assistive tech (aria-current, WAI-ARIA breadcrumb pattern) but is
 * visually hidden, because the page header right below already names it.
 * One level deep (/app/x) there is nothing to show beyond the sidebar's
 * current item and that header, so it renders nothing.
 * Dependencies: react-router-dom, i18n.store
 */
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../stores/i18n.store';

export function Breadcrumbs() {
  const { t } = useI18n();
  const ROUTE_LABELS: Record<string, string> = {
    app: t('dashboard'),
    admin: t('approvalReview'),
    audit: t('auditLog'),
    map: t('networkMap'),
    users: t('sidebarUserManagement'),
    promotions: t('sidebarPromotions'),
    help: t('adminHelpLink'),
    status: t('status'),
    'ca-blacklist': t('caBlacklistNavLabel'),
    'bundle-versions': t('bundleVersionsNavLabel'),
    onboarding: t('adminOnboardingNavLabel'),
    marketplace: t('sidebarMarketplace'),
    resources: t('dsfResourcesNavLabel'),
    legal: t('legalPageTitle'),
  };
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  // Only nested routes have an ancestor besides the dashboard.
  if (segments.length <= 2) return null;

  return (
    <nav
      aria-label={t('shellBreadcrumb')}
      className="px-6 pt-3 text-xs text-[color:var(--text-muted)]"
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {segments.map((seg, i) => {
          const path = '/' + segments.slice(0, i + 1).join('/');
          const label = ROUTE_LABELS[seg] || seg;
          const isLast = i === segments.length - 1;

          return (
            <li key={path} className={isLast ? 'sr-only' : 'flex items-center gap-1.5'}>
              {i > 0 && !isLast && (
                <span aria-hidden="true" className="text-[color:var(--border-strong)]">
                  /
                </span>
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  className="font-semibold text-[color:var(--text-primary)]"
                >
                  {label}
                </span>
              ) : (
                <Link
                  to={path}
                  className="rounded-sm font-medium text-[color:var(--primary)] underline-offset-2 hover:underline focus-visible:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
