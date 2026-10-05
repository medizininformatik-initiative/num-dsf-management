/**
 * MapHeader.tsx – Page header for /app/map: breadcrumb trail, then the page title
 * with the role badge, in one glass bar.
 *
 * The role badge follows the same signal that decides which map view the page
 * renders: `meta.isAdmin` of the network-map response (shared ['network','map']
 * query). `useMe()` is only the fallback while the map loads. /auth/me can
 * fail (auth rate-limit zone), so treating a missing `me` as "member"
 * mislabelled admins; an unknown role now renders no badge instead.
 * Dependencies: useNetworkMap, useMe, Breadcrumbs, StatusPill, Icon, i18n.store
 */
import { Icon } from '../ui/Icon';
import { Breadcrumbs } from '../layout/Breadcrumbs';
import { StatusPill } from '../ui/StatusPill';
import { useMe } from '../../hooks/useMe';
import { useNetworkMap } from '../../hooks/useNetworkMap';
import { useI18n } from '../../stores/i18n.store';

export function MapHeader() {
  const { t } = useI18n();
  const { data: map } = useNetworkMap();
  const { data: me } = useMe();
  const isAdmin: boolean | undefined = map ? map.isAdmin : me?.isAdmin;
  const known = isAdmin !== undefined;
  return (
    <header className="glass-chrome px-6 pb-2.5 pt-3 sm:px-8">
      <Breadcrumbs />
      <div className="flex items-center gap-3">
        <Icon name="hub" size={24} className="text-[color:var(--primary)]" />
        <div>
          <h1 className="m-0 text-lg font-bold text-[color:var(--text-primary)]">
            {t('networkMap')}
          </h1>
          {known && (
            <p className="mt-0.5 text-[12px] text-[color:var(--text-secondary)]">
              {isAdmin ? t('mapAdminViewSubtitle') : t('mapMemberViewSubtitle')}
            </p>
          )}
        </div>
        {known && (
          <StatusPill
            tone={isAdmin ? 'info' : 'neutral'}
            icon={isAdmin ? 'shield' : 'person'}
            className="ml-auto animate-fade-in"
          >
            {isAdmin ? t('mapRoleAdmin') : t('mapRoleMember')}
          </StatusPill>
        )}
      </div>
    </header>
  );
}
