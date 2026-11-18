/**
 * EndpointChangeWarning.tsx — inline warning block shown in the endpoint and
 * membership modals once an existing endpoint reference or address is being
 * changed: other sites import the new state only after approval.
 * Dependencies: Icon, i18n store.
 */
import { Icon } from '../ui/Icon';
import { useI18n } from '../../stores/i18n.store';

export function EndpointChangeWarning() {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-control border border-warning-border bg-warning-surface p-3 text-xs text-warning-fg"
    >
      <Icon name="warning" size={14} className="mt-px shrink-0" />
      <p>{t('endpointChangeWarning')}</p>
    </div>
  );
}
