/**
 * BackupRunsList.tsx – the run history of the backup page: status pill,
 * trigger, time, size, duration, a copyable SHA-256 checksum and a download
 * button per stored file. A failed run shows its error. Rows fade in with a
 * stagger. Dependencies: StatusPill, Button, Icon, dateUtils, i18n store, sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import type { BackupRun } from '../../../api/backups.api';
import { StatusPill } from '../../ui/StatusPill';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { formatBytes } from '../../../lib/formatBytes';
import { formatDateTime } from '../../../lib/dateUtils';
import { useI18n } from '../../../stores/i18n.store';

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function Checksum({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(t('backupChecksumCopied'));
    } catch {
      toast.error(t('caCopyFailed'));
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
        SHA-256
      </span>
      <code
        className="min-w-0 truncate font-mono text-xs text-[color:var(--text-secondary)]"
        title={value}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={t('backupCopyChecksum')}
        title={t('backupCopyChecksum')}
        className="press-effect inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={16} />
      </button>
    </div>
  );
}

export interface BackupRunsListProps {
  runs: BackupRun[];
  downloadingId: string | null;
  onDownload: (run: BackupRun) => void;
}

export function BackupRunsList({ runs, downloadingId, onDownload }: BackupRunsListProps) {
  const { t, lang } = useI18n();

  if (runs.length === 0) {
    return (
      <p className="surface-card p-5 text-sm text-[color:var(--text-muted)]">{t('backupNoRuns')}</p>
    );
  }

  return (
    <ul className="space-y-3" aria-label={t('backupRunsTitle')}>
      {runs.map((run, i) => {
        const ok = run.status === 'SUCCESS';
        return (
          <li
            key={run.id}
            className="surface-card animate-list-item-in space-y-2 p-4"
            style={{ '--stagger-index': Math.min(i, 12) } as React.CSSProperties}
            data-testid="backup-run"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusPill tone={ok ? 'success' : 'danger'} icon={ok ? 'check_circle' : 'error'}>
                {ok ? t('backupStatusSuccess') : t('backupStatusFailed')}
              </StatusPill>
              <span className="text-sm font-medium">{formatDateTime(run.startedAt, lang)}</span>
              <span className="text-xs text-[color:var(--text-muted)]">
                {run.trigger === 'SCHEDULED'
                  ? t('backupTriggerScheduled')
                  : t('backupTriggerManual')}
                {run.triggeredBy ? ` · ${run.triggeredBy}` : ''}
              </span>
              {run.encrypted && (
                <StatusPill tone="info" icon="lock">
                  {t('backupEncrypted')}
                </StatusPill>
              )}
              <span className="ml-auto text-xs tabular-nums text-[color:var(--text-muted)]">
                {formatBytes(run.sizeBytes)} · {formatDuration(run.durationMs)}
              </span>
            </div>
            {ok && run.sha256 && <Checksum value={run.sha256} />}
            {!ok && run.error && (
              <p role="alert" className="text-sm text-danger-fg">
                {run.error}
              </p>
            )}
            {ok && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="min-w-0 truncate font-mono text-xs text-[color:var(--text-muted)]">
                  {run.fileName}
                </code>
                {run.fileDeleted ? (
                  <span className="text-xs text-[color:var(--text-muted)]">
                    {t('backupFilePruned')}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={downloadingId === run.id}
                    aria-busy={downloadingId === run.id || undefined}
                    onClick={() => onDownload(run)}
                  >
                    <Icon name="download" size={16} />
                    {t('backupDownload')}
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
