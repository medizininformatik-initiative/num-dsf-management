/**
 * OnboardingFileSummary.tsx – the result of a multi-file import split per
 * file: created / updated / failed counts next to each file name.
 * Dependencies: StatusPill, Icon, i18n store, onboardingFiles types.
 */
import type { CSSProperties } from 'react';
import { Icon } from '../../ui/Icon';
import { StatusPill } from '../../ui/StatusPill';
import { useI18n } from '../../../stores/i18n.store';
import type { FileSummaryItem } from './onboardingFiles';

export function OnboardingFileSummary({ items }: { items: FileSummaryItem[] }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <section data-testid="onboarding-file-summary" className="space-y-2">
      <h3 className="text-[13px] font-semibold text-[color:var(--text-primary)]">
        {t('onbFileSummaryTitle')}
      </h3>
      <ul className="space-y-2">
        {items.map((f, i) => (
          <li
            key={f.id}
            data-testid="onboarding-file-summary-item"
            style={{ '--stagger-index': i } as CSSProperties}
            className="glass-thin animate-list-item-in flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2.5"
          >
            <Icon name="description" size={20} className="text-[color:var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[color:var(--text-primary)]">
              {f.name}
            </span>
            <span className="text-xs text-[color:var(--text-secondary)]">
              {t('adminOnboardingSummary', {
                created: f.created,
                updated: f.updated,
                failed: f.failed,
              })}
            </span>
            {f.failed > 0 ? (
              <StatusPill tone="danger" icon="cancel">
                {t('adminOnboardingStatusFailed')}
              </StatusPill>
            ) : (
              <StatusPill tone="success" icon="check_circle">
                {t('adminOnboardingStatusOk')}
              </StatusPill>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
