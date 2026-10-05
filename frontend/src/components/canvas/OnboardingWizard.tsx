/**
 * OnboardingWizard.tsx – Step-by-step onboarding guide above the canvas.
 * The five data steps come from the shared readiness rule (deriveReadiness:
 * active organization, MEDIC contact, endpoint, valid certificate,
 * membership), so the wizard, the right-panel checklist and the approval modal
 * always agree; the sixth step is done only while the latest request is
 * PENDING or APPROVED. Each open step opens the modal that fixes it.
 * Motion explains progress: the steps stagger in, a step completed on screen
 * pops its check and collapses to it while the open steps take its room, the
 * progress bar springs to the new value, and once everything is done the
 * wizard collapses away (height and opacity) instead of vanishing.
 * Dependencies: useOrganization, useContacts, useEndpoints, useCertificates,
 * useMemberships, useApproval, useModals, lib/readiness, Icon, Collapse,
 * i18n store
 */
import { useId, useRef, type CSSProperties } from 'react';
import { useOrganization } from '../../hooks/useOrganization';
import { useContacts } from '../../hooks/useContacts';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useCertificates } from '../../hooks/useCertificates';
import { useMemberships } from '../../hooks/useMemberships';
import { useApprovalStatus } from '../../hooks/useApproval';
import { useModals } from '../../hooks/useModals';
import {
  deriveReadiness,
  READINESS_ICON,
  READINESS_LABEL,
  type ReadinessKey,
} from '../../lib/readiness';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';
import { Collapse } from '../layout/Collapse';

interface Props {
  instanceId: string;
}

/** The modal that fixes each open step. */
const STEP_MODAL = {
  organization: 'org-edit',
  contacts: 'contact-add',
  endpoints: 'endpoint-add',
  certificates: 'certificate-add',
  memberships: 'membership-add',
} as const satisfies Record<ReadinessKey, string>;

interface Step {
  key: ReadinessKey | 'submit';
  label: string;
  icon: string;
  done: boolean;
  modal: (typeof STEP_MODAL)[ReadinessKey] | 'approval';
}

export function OnboardingWizard({ instanceId }: Props) {
  const { t } = useI18n();
  const headingId = useId();
  const { data: organization } = useOrganization(instanceId);
  const { data: contacts } = useContacts(instanceId);
  const { data: endpoints } = useEndpoints(instanceId);
  const { data: certificates } = useCertificates(instanceId);
  const { data: memberships } = useMemberships(instanceId);
  const { data: approval } = useApprovalStatus(instanceId);

  const readiness = deriveReadiness({
    organization,
    contacts: Array.isArray(contacts) ? contacts : [],
    endpoints: Array.isArray(endpoints) ? endpoints : [],
    certificates: Array.isArray(certificates) ? certificates : [],
    memberships: Array.isArray(memberships) ? memberships : [],
    approval,
  });

  const steps: Step[] = [
    ...readiness.items.map((item) => ({
      key: item.key,
      label: t(READINESS_LABEL[item.key]),
      icon: READINESS_ICON[item.key],
      done: item.done,
      modal: STEP_MODAL[item.key],
    })),
    {
      key: 'submit',
      label: readiness.submitted ? t('onboardingStepSubmitted') : t('onboardingStepSubmit'),
      icon: 'send',
      done: readiness.submitted,
      modal: 'approval',
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  const nextStep = steps.find((s) => !s.done);

  // Steps already done when the wizard first renders sit still; a step that
  // completes while it is on screen gets the check pop.
  const doneOnMount = useRef<Set<Step['key']> | null>(null);
  if (doneOnMount.current === null) {
    doneOnMount.current = new Set(steps.filter((s) => s.done).map((s) => s.key));
  }

  // Once every step is complete the wizard collapses away (height and
  // opacity) and unmounts; complete on mount, it never renders.
  return (
    <Collapse open={!allDone}>
      <section
        aria-labelledby={headingId}
        className="mb-4 animate-fade-in rounded-card border border-[color:var(--border)] bg-[color:var(--bg-card)] px-5 py-3"
      >
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <h2
            id={headingId}
            className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--text-primary)]"
          >
            <Icon name="rocket_launch" size={16} className="text-[color:var(--text-muted)]" />
            {t('onboardingHeader')}
          </h2>
          <span className="text-[11px] tabular-nums text-[color:var(--text-muted)]">
            {t('onboardingProgress', { done: completedCount, total: steps.length })}
          </span>
        </div>

        {/* Progress bar (the counter above carries the value); it springs to
            each new value. */}
        <div
          aria-hidden="true"
          className="mb-2 h-0.5 overflow-hidden rounded-full bg-[color:var(--bg-hover)]"
        >
          <div
            data-testid="onboarding-progress"
            className="h-full rounded-full bg-primary transition-[width] duration-long ease-spring dark:bg-brand-400"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>

        {/* Open steps share the row; a completed step collapses to its check
            (the li is stable, so its flex-grow change animates). */}
        <ol aria-label={t('onboardingStepsLabel')} className="flex flex-wrap gap-1 md:flex-nowrap">
          {steps.map((step, i) => {
            const isNext = step === nextStep;
            const tile =
              'flex h-full w-full flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center';
            return (
              <li
                key={step.key}
                data-done={step.done}
                className={`min-w-0 basis-10 animate-list-item-in transition-[flex-grow] duration-medium ease-spring ${
                  step.done ? 'grow-0' : 'grow'
                }`}
                style={{ '--stagger-index': i } as CSSProperties}
              >
                {step.done ? (
                  <span className={tile} title={step.label}>
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full bg-success-surface text-success-fg ${
                        doneOnMount.current?.has(step.key) ? '' : 'animate-check-in'
                      }`}
                    >
                      <Icon name="check" size={14} label={t('readinessItemDone')} />
                    </span>
                    <span className="sr-only">{step.label}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => useModals.getState().openModal(step.modal)}
                    className={`${tile} press-effect hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] ${
                      isNext ? 'bg-[color:var(--bg-hover)]' : ''
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-short ease-standard ${
                        isNext
                          ? 'bg-primary text-white'
                          : 'bg-[color:var(--bg-hover)] text-[color:var(--text-muted)]'
                      }`}
                    >
                      {/* A missing data step says so; the submit step is just its action. */}
                      <Icon
                        name={step.icon}
                        size={14}
                        label={step.key === 'submit' ? undefined : t('readinessItemMissing')}
                      />
                    </span>
                    <span className="text-[11px] font-medium leading-tight text-[color:var(--text-primary)]">
                      {step.label}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </Collapse>
  );
}
