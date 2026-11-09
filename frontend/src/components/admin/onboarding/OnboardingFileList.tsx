/**
 * OnboardingFileList.tsx – the chosen onboarding files as chips: name,
 * type, size, row count and parse status, a note on rows the server skipped,
 * and a remove button. Chips enter with a staggered animation and fade out
 * while being removed.
 * Dependencies: Icon, Button-less icon button, StatusPill, i18n store, onboardingFiles.
 */
import type { CSSProperties } from 'react';
import { Icon } from '../../ui/Icon';
import { StatusPill } from '../../ui/StatusPill';
import { useI18n } from '../../../stores/i18n.store';
import type { OnboardingFileEntry } from './onboardingFiles';

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

export interface OnboardingFileListProps {
  files: OnboardingFileEntry[];
  removing: Set<string>;
  onRemove: (id: string) => void;
}

export function OnboardingFileList({ files, removing, onRemove }: OnboardingFileListProps) {
  const { t } = useI18n();
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('onbFilesLabel')} data-testid="onboarding-file-list" className="space-y-2">
      {files.map((f, i) => (
        <li
          key={f.id}
          data-testid="onboarding-file"
          style={{ '--stagger-index': i } as CSSProperties}
          className={`surface-card px-4 py-2.5 ${
            removing.has(f.id) ? 'animate-fade-out' : 'animate-list-item-in'
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Icon name="description" size={16} className="text-[color:var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--text-primary)]">
              {f.name}
            </span>
            <span className="text-xs uppercase text-[color:var(--text-muted)]">
              {f.kind ?? '?'} · {formatSize(f.size)}
            </span>
            {f.status === 'done' && (
              <StatusPill tone="success" icon="check_circle">
                {t('onbFileRows', { count: f.rowCount })}
              </StatusPill>
            )}
            {(f.status === 'queued' || f.status === 'parsing') && (
              <StatusPill tone="neutral">{t('onbFileParsing')}</StatusPill>
            )}
            {f.status === 'error' && (
              <StatusPill tone="danger" icon="cancel">
                {t('adminOnboardingStatusFailed')}
              </StatusPill>
            )}
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              disabled={removing.has(f.id)}
              aria-label={t('onbFileRemove', { name: f.name })}
              className="press-effect inline-flex h-8 w-8 items-center justify-center rounded-control text-[color:var(--text-muted)] transition-colors duration-short ease-standard hover:bg-[color:var(--bg-hover)] hover:text-danger-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-40"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {f.status === 'error' && f.errorKey && (
            <p role="alert" className="mt-1 text-xs text-danger-fg">
              {t(f.errorKey)}
            </p>
          )}
          {f.skipped.length > 0 && (
            <details className="mt-1 text-xs text-warning-fg">
              <summary className="cursor-pointer">
                {t('onbFileSkipped', { count: f.skipped.length })}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {f.skipped.map((s) => (
                  <li key={s.row}>
                    {t('adminOnboardingParseErrorsRow', { row: s.row })} · {s.issue}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
