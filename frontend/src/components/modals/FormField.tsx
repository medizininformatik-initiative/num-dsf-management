/**
 * FormField.tsx — shared form primitives of the entity modals:
 * - FormField: label + one control + hint/error. The label points at the
 *   control (htmlFor/id), hint and error are wired through aria-describedby,
 *   the control gets aria-invalid, and the required asterisk carries
 *   screen-reader text. Pass one element (it receives id and aria props) or a
 *   render function for composite fields such as the PEM drop zone.
 * - FormFieldGroup: the same for checkbox groups (role="group").
 * - FieldError: the announced (role="alert") error line that fades/slides in.
 * - fieldLabelClass / fieldHintClass: the one label and hint style, for
 *   labels and hints that sit outside a FormField.
 * - inputClass / selectClass / checkboxClass: one field style with a
 *   consistent focus ring and the theme's input fill and border tokens.
 * - ModalFooter: Cancel, an optional Back and the one primary CTA (Button).
 * Dependencies: Button, Icon, InfoHint, i18n store.
 */
import React, { useId } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { en, type TranslationKey } from '../../i18n/en';
import { InfoHint } from '../ui/InfoHint';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';

/** What FormField hands to its control. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  infoKey?: TranslationKey;
  /** The control, or a render function placing the control props itself. */
  children: React.ReactElement | ((control: FieldControlProps) => React.ReactNode);
}

/**
 * Resolve a field error to display text. Zod schemas emit stable i18n key codes
 * as their messages (e.g. 'identifierTooShort'); if the message matches a known
 * translation key, render its localized text. Any other string renders verbatim,
 * so plain backend/runtime messages stay backward-compatible.
 */
function resolveError(error: string, t: (key: TranslationKey) => string): string {
  return Object.prototype.hasOwnProperty.call(en, error) ? t(error as TranslationKey) : error;
}

function joinIds(...ids: (string | false | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

/** Announced error line under a control; `error` may be an i18n key code. */
export function FieldError({ id, error }: { id: string; error: string }) {
  const { t } = useI18n();
  return (
    <p
      id={id}
      role="alert"
      className="flex animate-list-item-in items-start gap-1 text-xs font-medium text-danger-fg"
      style={{ animationDuration: 'var(--duration-short)' }}
    >
      <Icon name="error" size={14} className="mt-px shrink-0" />
      <span>{resolveError(error, t)}</span>
    </p>
  );
}

/** Label of a control or group (FormField, FormFieldGroup and ad-hoc labels). */
export const fieldLabelClass = 'text-xs font-semibold text-[color:var(--text-secondary)]';

/** Helper text under a control or group. */
export const fieldHintClass = 'text-xs text-[color:var(--text-muted)]';

function FieldHint({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className={fieldHintClass}>
      {children}
    </p>
  );
}

function RequiredMark() {
  const { t } = useI18n();
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-danger-fg">
        *
      </span>
      <span className="sr-only"> {t('formRequiredSr')}</span>
    </>
  );
}

export function FormField({ label, required, error, hint, infoKey, children }: FormFieldProps) {
  const { t } = useI18n();
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const showHint = !!hint && !error;
  const describedBy = joinIds(showHint && hintId, !!error && errorId);

  let controlId = fieldId;
  let control: React.ReactNode;
  if (typeof children === 'function') {
    control = children({
      id: fieldId,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
    });
  } else {
    const own = children.props as { id?: string; 'aria-describedby'?: string };
    controlId = own.id ?? fieldId;
    control = React.cloneElement(children, {
      id: controlId,
      'aria-describedby': joinIds(own['aria-describedby'], describedBy),
      ...(error ? { 'aria-invalid': true } : {}),
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center">
        <label htmlFor={controlId} className={fieldLabelClass}>
          {label}
          {required && <RequiredMark />}
        </label>
        {infoKey && <InfoHint text={t(infoKey)} label={t(infoKey)} />}
      </div>
      {control}
      {showHint && <FieldHint id={hintId}>{hint}</FieldHint>}
      {error && <FieldError id={errorId} error={error} />}
    </div>
  );
}

interface FormFieldGroupProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  infoKey?: TranslationKey;
  children: React.ReactNode;
}

/** A labelled group of related controls (e.g. role checkboxes). */
export function FormFieldGroup({
  label,
  required,
  error,
  hint,
  infoKey,
  children,
}: FormFieldGroupProps) {
  const { t } = useI18n();
  const groupId = useId();
  const labelId = `${groupId}-label`;
  const hintId = `${groupId}-hint`;
  const errorId = `${groupId}-error`;
  const showHint = !!hint && !error;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={joinIds(showHint && hintId, !!error && errorId)}
      className="space-y-1.5"
    >
      <div className="flex items-center">
        <span id={labelId} className={fieldLabelClass}>
          {label}
          {required && <RequiredMark />}
        </span>
        {infoKey && <InfoHint text={t(infoKey)} label={t(infoKey)} />}
      </div>
      {children}
      {showHint && <FieldHint id={hintId}>{hint}</FieldHint>}
      {error && <FieldError id={errorId} error={error} />}
    </div>
  );
}

/** Border, fill, focus ring and invalid/disabled states of every text control. */
export const fieldSurfaceClass =
  'rounded-input border border-[color:var(--border-strong)] bg-[color:var(--bg-input)] outline-none ' +
  'text-[color:var(--text-primary)] ' +
  'transition-[border-color,box-shadow,background-color] duration-short ease-standard ' +
  'focus:border-[color:var(--focus-ring)] focus:ring-[3px] focus:ring-primary/20 ' +
  'dark:focus:ring-brand-400/30 aria-[invalid=true]:border-danger-fg ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export const inputClass = `w-full px-3 py-2 text-sm placeholder:text-[color:var(--text-muted)] ${fieldSurfaceClass}`;

export const selectClass = `w-full px-3 py-2 text-sm ${fieldSurfaceClass}`;

export const checkboxClass =
  'h-4 w-4 shrink-0 cursor-pointer rounded-small accent-primary dark:accent-brand-400 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[color:var(--focus-ring)]';

export interface CheckboxCardOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

interface CheckboxCardsProps<T extends string> {
  options: readonly CheckboxCardOption<T>[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  /** Ref of the first checkbox, e.g. React Hook Form's field.ref for error focus. */
  firstInputRef?: React.Ref<HTMLInputElement>;
}

/** Multi-select as cards (code + description); a checked card is tinted. */
export function CheckboxCards<T extends string>({
  options,
  value,
  onChange,
  firstInputRef,
}: CheckboxCardsProps<T>) {
  return (
    <div className="space-y-2">
      {options.map((option, i) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-start gap-3 rounded-control border border-[color:var(--border)] p-3 transition-colors duration-short ease-standard hover:border-[color:var(--border-strong)] has-[:checked]:border-primary/40 has-[:checked]:bg-primary/[0.05] dark:has-[:checked]:border-brand-400/50 dark:has-[:checked]:bg-brand-400/10"
        >
          <input
            ref={i === 0 ? firstInputRef : undefined}
            type="checkbox"
            value={option.value}
            checked={value.includes(option.value)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, option.value]
                  : value.filter((v) => v !== option.value),
              )
            }
            className={`mt-0.5 ${checkboxClass}`}
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[color:var(--text-primary)]">
              {option.label}
            </span>
            <span className="block text-xs text-[color:var(--text-muted)]">
              {option.description}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

interface ModalFooterProps {
  onCancel: () => void;
  /** Without it the primary button submits the surrounding form. */
  onSubmit?: () => void;
  submitLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Defaults to the translated "Cancel". */
  cancelLabel?: string;
  /** Busy label while loading; defaults to "Saving…". */
  loadingLabel?: string;
  /** Steps back in a multi-step flow; shown at the start of the bar. */
  onBack?: () => void;
  backLabel?: string;
  /** Only Back/Cancel, e.g. on a step that advances by choosing an item. */
  hideSubmit?: boolean;
}

export function ModalFooter({
  onCancel,
  onSubmit,
  submitLabel,
  loading,
  disabled,
  cancelLabel,
  loadingLabel,
  onBack,
  backLabel,
  hideSubmit,
}: ModalFooterProps) {
  const { t } = useI18n();
  return (
    <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-[color:var(--border)] pt-4">
      {onBack && (
        <Button variant="ghost" onClick={onBack} className="mr-auto">
          <Icon name="arrow_back" size={16} />
          {backLabel ?? t('formBackBtn')}
        </Button>
      )}
      <Button variant="secondary" onClick={onCancel}>
        {cancelLabel ?? t('modalCancelBtn')}
      </Button>
      {!hideSubmit && (
        <Button
          type={onSubmit ? 'button' : 'submit'}
          onClick={onSubmit}
          disabled={loading || disabled}
        >
          {loading && <Icon name="progress_activity" size={16} className="animate-spin" />}
          {loading ? (loadingLabel ?? t('modalSavingBtn')) : submitLabel || t('modalSaveBtn')}
        </Button>
      )}
    </div>
  );
}
