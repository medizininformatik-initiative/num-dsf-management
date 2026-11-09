/**
 * OnboardingStepper.tsx – the 3-step progress indicator of the bulk onboarding
 * flow (1 choose method, 2 review and fix, 3 import). Completed steps show a
 * check that pops in; the current step is marked with aria-current="step".
 * Dependencies: Icon, i18n store.
 */
import { Icon } from '../../ui/Icon';
import { useI18n } from '../../../stores/i18n.store';
import type { TranslationKey } from '../../../i18n/en';

const STEPS: TranslationKey[] = ['onbStepMethod', 'onbStepReview', 'onbStepImport'];

export function OnboardingStepper({ current }: { current: 1 | 2 | 3 }) {
  const { t } = useI18n();
  return (
    <ol
      aria-label={t('onbStepperLabel')}
      data-testid="onboarding-stepper"
      className="glass-thin flex items-center gap-2 rounded-card px-4 py-3"
    >
      {STEPS.map((key, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li
            key={key}
            aria-current={active ? 'step' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-medium ease-standard ${
                done || active
                  ? 'bg-primary text-white'
                  : 'border border-[color:var(--border)] text-[color:var(--text-secondary)]'
              }`}
            >
              {done ? <Icon name="check" size={16} className="animate-check-in" /> : n}
            </span>
            <span
              className={`truncate text-[13px] ${
                active
                  ? 'font-semibold text-[color:var(--text-primary)]'
                  : 'text-[color:var(--text-secondary)]'
              }`}
            >
              {t(key)}
              {done && <span className="sr-only"> ({t('onbStepDone')})</span>}
            </span>
            {n < STEPS.length && (
              <span
                aria-hidden="true"
                className={`mx-1 h-px flex-1 transition-colors duration-medium ease-standard ${
                  done ? 'bg-primary' : 'bg-[color:var(--border)]'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
