/**
 * Breadcrumbs.tsx – Shows the navigation path for sub-routes: translated
 * segment labels, parent links in the brand colour and the current page
 * marked with aria-current (WAI-ARIA breadcrumb pattern).
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

  // Only show on sub-routes (not on /app itself)
  if (segments.length <= 1) return null;

  return (
    <nav
      aria-label={t('shellBreadcrumb')}
      className="bg-[color:var(--bg-card)] px-[30px] py-2 text-xs text-[color:var(--text-muted)]"
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {segments.map((seg, i) => {
          const path = '/' + segments.slice(0, i + 1).join('/');
          const label = ROUTE_LABELS[seg] || seg;
          const isLast = i === segments.length - 1;

          return (
            <li key={path} className="flex items-center gap-1.5">
              {i > 0 && (
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
                  className="font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:underline dark:text-brand-400"
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
