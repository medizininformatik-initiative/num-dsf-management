/**
 * TotpCodeField.tsx – the second-factor input of the admin step-up: by default
 * the 6-digit authenticator (TOTP) code (digits only, numeric keyboard and
 * one-time-code autofill, monospaced and centred); a link switches it to a TAN
 * (one of the 8-character single-use codes of the printed list) and back, for
 * when the phone is not at hand. The switch clears the field. Only render it
 * when needsTotpStepUp() is true; site sessions confirm through the client
 * certificate instead.
 * Dependencies: fieldClasses, lib/stepUpCode, i18n store.
 */
import { forwardRef, useId, useState } from 'react';
import { sanitizeTan } from '../../lib/stepUpCode';
import { useI18n } from '../../stores/i18n.store';
import { FIELD_CLASS, HINT_CLASS, LABEL_CLASS } from './fieldClasses';

export interface TotpCodeFieldProps {
  value: string;
  onChange: (code: string) => void;
  label: string;
  /** Shown under the field, e.g. what else the code is needed for. */
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Offer the switch to a TAN (default true). */
  allowTan?: boolean;
  className?: string;
  'data-testid'?: string;
}

export const TotpCodeField = forwardRef<HTMLInputElement, TotpCodeFieldProps>(
  function TotpCodeField(
    {
      value,
      onChange,
      label,
      hint,
      placeholder = '000000',
      disabled,
      autoFocus,
      allowTan = true,
      className = '',
      ...rest
    },
    ref,
  ) {
    const { t } = useI18n();
    const id = useId();
    const hintId = useId();
    const [tan, setTan] = useState(false);
    const shownHint = tan ? t('tanHint') : hint;
    return (
      <div className={className}>
        <label htmlFor={id} className={LABEL_CLASS}>
          {tan ? t('tanLabel') : label}
        </label>
        <input
          ref={ref}
          id={id}
          type="text"
          inputMode={tan ? 'text' : 'numeric'}
          autoComplete={tan ? 'off' : 'one-time-code'}
          autoCapitalize={tan ? 'characters' : undefined}
          spellCheck={tan ? false : undefined}
          maxLength={tan ? 8 : 6}
          value={value}
          onChange={(e) =>
            onChange(
              tan ? sanitizeTan(e.target.value) : e.target.value.replace(/\D/g, '').slice(0, 6),
            )
          }
          placeholder={tan ? 'A1B2C3D4' : placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={shownHint ? hintId : undefined}
          className={`${FIELD_CLASS} max-w-[15rem] text-center font-mono tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal`}
          data-testid={rest['data-testid']}
        />
        {shownHint && (
          <span id={hintId} className={HINT_CLASS}>
            {shownHint}
          </span>
        )}
        {allowTan && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setTan(!tan);
              onChange('');
            }}
            className="mt-1 block rounded-small text-xs font-medium text-[color:var(--accent)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
          >
            {tan ? t('tanUseCode') : t('tanUseTan')}
          </button>
        )}
      </div>
    );
  },
);
