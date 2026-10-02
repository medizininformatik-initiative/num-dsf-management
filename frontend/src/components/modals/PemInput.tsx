/**
 * PemInput.tsx — certificate PEM entry used by the upload and renewal forms:
 * a glass drop zone around the textarea (files can be dropped anywhere on it,
 * with an animated highlight while dragging), a "Choose file" button as the
 * keyboard path (.pem, .crt, .cer, read as text) and the textarea itself.
 * Files that are too large, unreadable, not a PEM certificate or carrying a
 * private key are refused with an announced message instead of being loaded.
 * Dependencies: Button, Icon, FormField (classes, FieldError), certificateUpload,
 *               i18n store, PemInput.css.
 */
import {
  useId,
  useRef,
  useState,
  type DragEvent,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { FieldError, fieldSurfaceClass } from './FormField';
import { PEM_FILE_ACCEPT, PEM_FILE_ERROR_KEY, readPemFile } from './certificateUpload';
import './PemInput.css';

export type PemTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
};

interface PemInputProps {
  /** Spread onto the textarea: register('pem') or value/onChange, plus FormField's control props. */
  textareaProps: PemTextareaProps;
  /** Receives the text of a dropped or picked certificate file. */
  onFileText: (text: string) => void;
  /** Instruction shown in the drop zone. */
  dropHint: string;
}

const PLACEHOLDER = '-----BEGIN CERTIFICATE-----\nMIIHEzCC…\n-----END CERTIFICATE-----';

function isFileDrag(e: DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export function PemInput({ textareaProps, onFileText, dropHint }: PemInputProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const fileErrorId = useId();

  async function load(file: File | undefined) {
    if (!file) return;
    const result = await readPemFile(file);
    if (result.ok) {
      setFileError(null);
      setLoadedName(file.name);
      onFileText(result.text);
    } else {
      setLoadedName(null);
      setFileError(t(PEM_FILE_ERROR_KEY[result.reason]));
    }
  }

  return (
    <div
      data-drag-over={dragOver || undefined}
      className="pem-dropzone glass-thin space-y-3 rounded-xl border-2 border-dashed border-[color:var(--border-strong)] p-3 shadow-none"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        void load(e.dataTransfer.files[0]);
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Icon name="upload_file" size={28} className="pem-dropzone-icon shrink-0" />
        <p className="min-w-0 flex-1 text-xs text-[color:var(--text-secondary)]">
          {dragOver ? t('formPemDropRelease') : dropHint}
        </p>
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          <Icon name="folder_open" size={16} />
          {t('formPemChooseFile')}
        </Button>
      </div>
      {loadedName && (
        <p
          role="status"
          className="flex animate-fade-in items-center gap-1 text-xs font-medium text-success-fg"
        >
          <Icon name="check_circle" size={14} />
          {t('formPemFileLoaded', { name: loadedName })}
        </p>
      )}
      <textarea
        rows={6}
        spellCheck={false}
        autoComplete="off"
        placeholder={PLACEHOLDER}
        {...textareaProps}
        onChange={(e) => {
          setLoadedName(null);
          setFileError(null);
          textareaProps.onChange?.(e);
        }}
        className={`block w-full resize-y px-3 py-2 font-mono text-xs leading-relaxed placeholder:text-[color:var(--text-muted)] ${fieldSurfaceClass}`}
      />
      {fileError && <FieldError id={fileErrorId} error={fileError} />}
      {/* After the textarea, so the dialog's initial focus lands on the textarea. */}
      <input
        ref={fileRef}
        type="file"
        accept={PEM_FILE_ACCEPT}
        hidden
        tabIndex={-1}
        data-testid="pem-file-input"
        onChange={(e) => {
          void load(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
