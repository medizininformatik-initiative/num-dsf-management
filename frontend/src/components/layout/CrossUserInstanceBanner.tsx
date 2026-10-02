/**
 * CrossUserInstanceBanner.tsx – Shown only when an IMI admin has loaded an
 * instance owned by a different user. Provides a clear visual cue so admin
 * edits don't accidentally mutate someone else's data. Warning tone tokens
 * keep it legible in light and dark mode.
 * Dependencies: useMe, useInstance, i18n.store, ui/Icon.
 */
import { useMe } from '../../hooks/useMe';
import { useInstance } from '../../hooks/useInstance';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

interface Props {
  instanceId: string | null;
}

export function CrossUserInstanceBanner({ instanceId }: Props) {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { data: instance } = useInstance(instanceId);
  if (!me?.isAdmin || !instance || !instanceId) return null;
  const owner = instance.owner_email ?? null;
  if (!owner || owner === me.email) return null;
  return (
    <div
      role="alert"
      className="mx-5 mt-2 flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning-surface px-3.5 py-2.5 text-warning-fg"
    >
      <Icon name="admin_panel_settings" size={20} className="mt-px shrink-0" />
      <div className="text-xs leading-snug">
        <p className="m-0 font-bold">{t('crossUserBannerTitle')}</p>
        <p className="m-0 mt-0.5">{t('crossUserBannerBody', { owner })}</p>
      </div>
    </div>
  );
}
