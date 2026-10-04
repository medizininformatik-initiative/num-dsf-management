/**
 * BundleTimeline.tsx – newest-first timeline of allow-list versions. Each row
 * is a selectable card (the selected version is the "newer" side of the diff)
 * with trigger icon, date, author, notes and a "current" pill; restorable
 * non-current versions get a Restore button, every version a download link.
 * Dependencies: Icon, StatusPill, Button, dateUtils, i18n store.
 */
import { Icon } from '../../ui/Icon';
import { StatusPill } from '../../ui/StatusPill';
import { Button } from '../../ui/Button';
import { formatDateTime } from '../../../lib/dateUtils';
import { useI18n } from '../../../stores/i18n.store';
import { bundleVersionsApi, type BundleVersionListRow } from '../../../api/bundleVersions.api';
import type { TranslationKey } from '../../../i18n/en';

const TRIGGER: Record<
  BundleVersionListRow['triggered_by'],
  { icon: string; label: TranslationKey }
> = {
  APPROVAL: { icon: 'task_alt', label: 'historyTriggerApproval' },
  MANUAL: { icon: 'edit_note', label: 'historyTriggerManual' },
  RESTORE: { icon: 'history', label: 'historyTriggerRestore' },
};

interface Props {
  versions: BundleVersionListRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRestore: (row: BundleVersionListRow) => void;
}

export function BundleTimeline({ versions, selectedId, onSelect, onRestore }: Props) {
  const { t, lang } = useI18n();
  return (
    <ol className="space-y-2" aria-label={t('historyTimeline')} data-testid="bundle-timeline">
      {versions.map((v, i) => {
        const trigger = TRIGGER[v.triggered_by] ?? TRIGGER.MANUAL;
        const selected = v.id === selectedId;
        return (
          <li
            key={v.id}
            style={{ '--stagger-index': Math.min(i, 8) } as React.CSSProperties}
            className="animate-list-item-in"
          >
            <div
              className={`glass-thin flex flex-wrap items-center gap-3 rounded-2xl p-3 ${
                selected ? 'ring-2 ring-[color:var(--accent)]' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                aria-pressed={selected}
                data-testid={`version-${v.version_number}`}
                className="press-effect flex min-w-0 flex-1 items-start gap-3 rounded-xl text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-surface text-neutral-fg">
                  <Icon name={trigger.icon} size={20} />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-[color:var(--text-primary)]">
                      v{v.version_number}
                    </span>
                    {v.isCurrent && (
                      <StatusPill tone="success" icon="check_circle">
                        {t('historyCurrent')}
                      </StatusPill>
                    )}
                    <span className="text-xs font-semibold text-[color:var(--text-secondary)]">
                      {t(trigger.label)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-[color:var(--text-muted)]">
                    {formatDateTime(v.created_at, lang)}
                    {v.triggered_by_email && ` · ${t('historyBy', { who: v.triggered_by_email })}`}
                  </span>
                  {v.notes && (
                    <span className="mt-1 block text-xs text-[color:var(--text-secondary)]">
                      {v.notes}
                    </span>
                  )}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={bundleVersionsApi.downloadUrl(v.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('historyDownloadVersion', { n: v.version_number })}
                  className="press-effect inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                >
                  <Icon name="download" size={18} />
                </a>
                {v.restorable && !v.isCurrent && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onRestore(v)}
                    aria-label={t('historyRestoreAria', { n: v.version_number })}
                  >
                    <Icon name="history" size={16} />
                    {t('historyRestore')}
                  </Button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
