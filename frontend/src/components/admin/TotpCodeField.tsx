/**
 * TotpCodeField.tsx – the 6-digit authenticator (TOTP) step-up input of the
 * admin writes: digits only, at most six, numeric keyboard and one-time-code
 * autofill, monospaced and centred. Only render it when needsTotpStepUp() is
 * true; certificate sessions confirm through the client certificate instead.
 * Dependencies: fieldClasses.
 */
import { forwardRef, useId } from 'react';
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
      className = '',
      ...rest
    },
    ref,
  ) {
    const id = useId();
    const hintId = useId();
    return (
      <div className={className}>
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={hint ? hintId : undefined}
          className={`${FIELD_CLASS} max-w-[15rem] text-center font-mono tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal`}
          data-testid={rest['data-testid']}
        />
        {hint && (
          <span id={hintId} className={HINT_CLASS}>
            {hint}
          </span>
        )}
      </div>
    );
  },
);
