/**
 * Breadcrumbs.tsx – The trail above a page title, rendered INSIDE the page
 * header (AdminPageHeader, MapHeader, …) and never as a band of its own:
 * "Overview / Parent / Current page", small, chevron-separated. Ancestors are
 * links, the current page is plain text with aria-current="page". The trail
 * comes from an explicit route table, so a sibling page never shows another
 * page as its parent. `/app` itself has no trail. Pass `current` for routes
 * whose last crumb is data (e.g. a marketplace entry's name).
 * Dependencies: react-router-dom, i18n.store, ui/Icon
 */
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

/** Route (below /app) -> label key and the route of its parent crumb, if any. */
const ROUTES = {
  audit: { label: 'auditLog' },
  admin: { label: 'approvalReview' },
  'admin/help': { label: 'adminHelpLink', parent: 'admin' },
  'admin/users': { label: 'sidebarUserManagement' },
  'admin/certificates': { label: 'adminCertTitle' },
  'admin/promotions': { label: 'sidebarPromotions' },
  'admin/ca-blacklist': { label: 'caBlacklistNavLabel' },
  'admin/bundle-versions': { label: 'bundleVersionsNavLabel' },
  'admin/onboarding': { label: 'adminOnboardingNavLabel' },
  'admin/backups': { label: 'backupNavLabel' },
  map: { label: 'networkMap' },
  marketplace: { label: 'sidebarMarketplace' },
  resources: { label: 'dsfResourcesNavLabel' },
  help: { label: 'helpTitle' },
  legal: { label: 'legalPageTitle' },
} as const;

type RouteKey = keyof typeof ROUTES;

function isRouteKey(rel: string): rel is RouteKey {
  return rel in ROUTES;
}

export function Breadcrumbs({ current }: { current?: string }) {
  const { t } = useI18n();
  const rel = useLocation()
    .pathname.replace(/^\/app\/?/, '')
    .replace(/\/$/, '');

  // Marketplace detail pages hang below the marketplace list.
  const detail = rel.startsWith('marketplace/');
  const key = detail ? 'marketplace' : rel;
  if (!isRouteKey(key)) return null;
  const route = ROUTES[key];

  const crumbs: { label: string; to?: string }[] = [{ label: t('dashboard'), to: '/app' }];
  if (detail) {
    crumbs.push({ label: t(route.label), to: '/app/marketplace' });
    crumbs.push({ label: current ?? rel.split('/')[1] });
  } else {
    if ('parent' in route) {
      crumbs.push({ label: t(ROUTES[route.parent].label), to: `/app/${route.parent}` });
    }
    crumbs.push({ label: current ?? t(route.label) });
  }

  return (
    <nav aria-label={t('shellBreadcrumb')} className="mb-1 text-xs text-[color:var(--text-muted)]">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        {crumbs.map((crumb, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <Icon name="chevron_right" size={14} className="shrink-0" />}
            {crumb.to ? (
              <Link
                to={crumb.to}
                className="rounded-sm font-medium text-[color:var(--text-secondary)] underline-offset-2 hover:text-[color:var(--primary)] hover:underline focus-visible:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                aria-current="page"
                className="truncate font-semibold text-[color:var(--text-primary)]"
              >
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
