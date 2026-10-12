/**
 * FreshnessBanner.tsx — top line of the download dialog: a calm info banner
 * while a newer allow-list version exists than the site's DSF fetched, a small
 * success line when it is current, nothing while unknown or not applicable.
 * Dependencies: Icon, lib/dateUtils (relTime), i18n store.
 */
import type { AllowListFreshness } from '../../api/entities.api';
import { relTime } from '../../lib/dateUtils';
import { Icon } from '../ui/Icon';
import { useI18n } from '../../stores/i18n.store';

/** Whether the site's DSF obtained the current allow list: info while outdated, a small success line when current. */
export function FreshnessBanner({ freshness }: { freshness: AllowListFreshness | undefined }) {
  const { t } = useI18n();
  if (!freshness || freshness.currentVersion === null || !freshness.currentPublishedAt) {
    return null;
  }
  const published = relTime(freshness.currentPublishedAt, t);
  const fetched = freshness.lastObtainedAt ? relTime(freshness.lastObtainedAt, t) : '';
  if (freshness.outdated) {
    const text =
      freshness.lastObtainedVersion === null
        ? t('allowListFreshNever', { current: freshness.currentVersion, published })
        : t('allowListFreshOutdated', {
            current: freshness.currentVersion,
            published,
            last: freshness.lastObtainedVersion,
            fetched,
          });
    return (
      <div
        className="rounded-2xl border border-info-border bg-info-surface px-4 py-3"
        data-testid="freshness-banner"
      >
        <p className="flex items-start gap-2 text-xs font-medium text-info-fg">
          <Icon name="new_releases" size={16} className="mt-px shrink-0" />
          <span>{text}</span>
        </p>
      </div>
    );
  }
  if (freshness.lastObtainedVersion === null) return null;
  return (
    <p
      className="flex items-center gap-1.5 text-xs font-medium text-success-fg"
      data-testid="freshness-current"
    >
      <Icon name="check_circle" size={16} className="shrink-0" />
      <span>{t('allowListFreshCurrent', { n: freshness.lastObtainedVersion, fetched })}</span>
    </p>
  );
}
