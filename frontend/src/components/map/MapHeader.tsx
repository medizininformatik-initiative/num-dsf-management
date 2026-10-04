/**
 * MapHeader.tsx – Page title strip for /app/map. Rendered by AppPage above
 * Breadcrumbs so the page title sits ABOVE the Dashboard/Map sub-nav.
 */
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { useMe } from '../../hooks/useMe';
import { useI18n } from '../../stores/i18n.store';

export function MapHeader() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const isAdmin = !!me?.isAdmin;
  return (
    <header className="glass-chrome px-7 pb-2.5 pt-4">
      <div className="flex items-center gap-3">
        <Icon name="hub" size={24} className="text-[color:var(--primary)]" />
        <div>
          <h1 className="m-0 text-lg font-bold text-[color:var(--text-primary)]">
            {t('networkMap')}
          </h1>
          <p className="mt-0.5 text-[12px] text-[color:var(--text-secondary)]">
            {isAdmin ? t('mapAdminViewSubtitle') : t('mapMemberViewSubtitle')}
          </p>
        </div>
        <StatusPill
          tone={isAdmin ? 'info' : 'neutral'}
          icon={isAdmin ? 'shield' : 'person'}
          className="ml-auto"
        >
          {isAdmin ? t('mapRoleAdmin') : t('mapRoleMember')}
        </StatusPill>
      </div>
    </header>
  );
}
