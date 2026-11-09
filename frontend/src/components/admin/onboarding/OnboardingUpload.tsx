/**
 * OnboardingUpload.tsx – the "Upload files" alternative of step 2: a drop
 * zone and file picker for any number of CSV, XLSX or JSON files (more can be
 * added later) plus the list of the files chosen so far. The files are only
 * handed upwards; the page parses them and merges their rows.
 * Dependencies: Icon, OnboardingFileList, i18n store.
 */
import { useId, useState, type DragEvent } from 'react';
import { Icon } from '../../ui/Icon';
import { useI18n } from '../../../stores/i18n.store';
import { OnboardingFileList } from './OnboardingFileList';
import type { OnboardingFileEntry } from './onboardingFiles';

export interface OnboardingUploadProps {
  files: OnboardingFileEntry[];
  removing: Set<string>;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export function OnboardingUpload({
  files,
  removing,
  onFiles,
  onRemove,
  disabled = false,
}: OnboardingUploadProps) {
  const { t } = useI18n();
  const id = useId();
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    onFiles(Array.from(e.dataTransfer.files ?? []));
  }

  return (
    <div data-testid="onboarding-upload" className="space-y-3">
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed px-6 py-8 text-center transition-colors duration-short ease-standard focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--focus-ring)] ${
          over
            ? 'border-[color:var(--focus-ring)] bg-[color:var(--accent-surface)]'
            : 'border-[color:var(--border-strong)] bg-[color:var(--bg-card)]'
        }`}
      >
        <Icon name="upload_file" size={24} className="text-primary dark:text-brand-400" />
        <span className="text-sm font-semibold text-[color:var(--text-primary)]">
          {files.length > 0 ? t('onbUploadMore') : t('onbUploadPrompt')}
        </span>
        <span className="text-xs text-[color:var(--text-secondary)]">{t('onbUploadFormats')}</span>
        <input
          id={id}
          type="file"
          multiple
          accept=".csv,.xlsx,.json"
          disabled={disabled}
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            // Lets the same file be picked again after it was removed.
            e.target.value = '';
          }}
          data-testid="onboarding-file-input"
          className="sr-only"
        />
      </label>
      <OnboardingFileList files={files} removing={removing} onRemove={onRemove} />
    </div>
  );
}
