/**
 * DownloadVersionList.tsx – compact list of the published allow-list versions
 * of one endpoint inside the download dialog: number, date, trigger (with
 * note), a "current" pill, a copy button for the version's DSF history link
 * and a signed GUI download. Dependencies: Icon, StatusPill, Button,
 * dateUtils, i18n store.
 */
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { formatDateTime } from '../../lib/dateUtils';
import { useI18n } from '../../stores/i18n.store';
import type { BundleHistoryEntry } from '../../api/entities.api';
import type { TranslationKey } from '../../i18n/en';

const TRIGGER_LABEL: Record<BundleHistoryEntry['triggeredBy'], TranslationKey> = {
  APPROVAL: 'historyTriggerApproval',
  MANUAL: 'historyTriggerManual',
  RESTORE: 'historyTriggerRestore',
};

interface Props {
  versions: BundleHistoryEntry[];
  /** Absolute DSF history URL of a version. */
  historyUrl: (version: number) => string;
  onCopy: (url: string) => void;
  onDownload: (version: number) => void;
  busyVersion: number | null;
}

export function DownloadVersionList({
  versions,
  historyUrl,
  onCopy,
  onDownload,
  busyVersion,
}: Props) {
  const { t, lang } = useI18n();
  return (
    <ul className="space-y-2" data-testid="download-history">
      {versions.map((v) => (
        <li
          key={v.versionNumber}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--border)] px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-[color:var(--text-primary)]">
                v{v.versionNumber}
              </span>
              {v.isCurrent && (
                <StatusPill tone="success" icon="check_circle">
                  {t('historyCurrent')}
                </StatusPill>
              )}
              <span className="text-xs font-semibold text-[color:var(--text-secondary)]">
                {t(TRIGGER_LABEL[v.triggeredBy] ?? 'historyTriggerManual')}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
              {formatDateTime(v.createdAt, lang)}
              {v.notes ? ` · ${v.notes}` : ''}
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] font-semibold text-[color:var(--text-secondary)]">
                {t('dlHistoryUrl')}
              </summary>
              <code className="mt-1 block break-all font-mono text-[11px] text-[color:var(--text-primary)]">
                {historyUrl(v.versionNumber)}
              </code>
            </details>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onCopy(historyUrl(v.versionNumber))}
              aria-label={t('dlCopyHistoryAria', { n: v.versionNumber })}
              className="press-effect inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
            >
              <Icon name="content_copy" size={18} />
            </button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busyVersion !== null}
              onClick={() => onDownload(v.versionNumber)}
              aria-label={t('dlDownloadVersionAria', { n: v.versionNumber })}
              data-testid={`download-version-${v.versionNumber}`}
            >
              <Icon name="download" size={16} />
              {busyVersion === v.versionNumber ? t('downloadModalDownloading') : t('dlDownload')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
