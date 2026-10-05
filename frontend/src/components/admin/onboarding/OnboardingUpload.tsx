/**
 * OnboardingUpload.tsx – the "Upload file" alternative of step 2: a drop zone
 * and file picker for CSV, XLSX or JSON. The chosen file is only held here;
 * the page runs the server dry run on it.
 * Dependencies: Icon, i18n store, fieldClasses is not needed (native input).
 */
import { useId, useState, type DragEvent } from 'react';
import { Icon } from '../../ui/Icon';
import { useI18n } from '../../../stores/i18n.store';

export interface OnboardingUploadProps {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
}

export function OnboardingUpload({ file, onFile, disabled = false }: OnboardingUploadProps) {
  const { t } = useI18n();
  const id = useId();
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    onFile(e.dataTransfer.files?.[0] ?? null);
  }

  return (
    <div data-testid="onboarding-upload">
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`glass-thin flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors duration-short ease-standard focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--focus-ring)] ${
          over ? 'border-primary bg-primary/5' : 'border-[color:var(--border-strong)]'
        }`}
      >
        <Icon name="upload_file" size={32} className="text-primary dark:text-brand-400" />
        <span className="text-sm font-semibold text-[color:var(--text-primary)]">
          {file ? file.name : t('onbUploadPrompt')}
        </span>
        <span className="text-xs text-[color:var(--text-secondary)]">{t('onbUploadFormats')}</span>
        <input
          id={id}
          type="file"
          accept=".csv,.xlsx,.json"
          disabled={disabled}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          data-testid="onboarding-file-input"
          className="sr-only"
        />
      </label>
    </div>
  );
}
