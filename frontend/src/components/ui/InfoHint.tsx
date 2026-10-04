/**
 * InfoHint.tsx - small accessible help trigger that reveals a short glossary
 * explanation in a glass popover. The hit target is 24 px; Escape closes an
 * open hint without also closing a surrounding modal.
 * Dependencies: Icon, i18n store.
 */
import { useId, useState } from 'react';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from './Icon';

interface InfoHintProps {
  text: string;
  label?: string;
}

export function InfoHint({ text, label }: InfoHintProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tipId = useId();
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label ?? t('infoHintLabel')}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            setOpen(false);
          }
        }}
        className="ml-0.5 inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-[color:var(--text-muted)] transition-colors duration-short ease-standard hover:text-[color:var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]"
      >
        <Icon name="help" size={16} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={tipId}
          className="glass-thick animate-popover-in absolute left-0 top-7 z-50 w-56 rounded-xl p-2.5 text-[12px] leading-snug text-[color:var(--text-primary)]"
        >
          {text}
        </span>
      )}
    </span>
  );
}
