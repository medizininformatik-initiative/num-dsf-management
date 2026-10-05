/**
 * OnboardingWizard.tsx – Step-by-step onboarding guide above the canvas.
 * The five data steps come from the shared readiness rule (deriveReadiness:
 * active organization, MEDIC contact, endpoint, valid certificate,
 * membership), so the wizard, the right-panel checklist and the approval modal
 * always agree; the sixth step is done only while the latest request is
 * PENDING or APPROVED. Each open step opens the modal that fixes it; the
 * wizard disappears once everything is done.
 * Dependencies: useOrganization, useContacts, useEndpoints, useCertificates,
 * useMemberships, useApproval, useModals, lib/readiness, Icon, i18n store
 */
import { useId } from 'react';
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
  // Don't show the wizard once every step is complete.
  if (completedCount === steps.length) return null;

  const nextStep = steps.find((s) => !s.done);

  return (
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
        <span className="text-[11px] text-[color:var(--text-muted)]">
          {t('onboardingProgress', { done: completedCount, total: steps.length })}
        </span>
      </div>

      {/* Progress bar (the counter above carries the value) */}
      <div
        aria-hidden="true"
        className="mb-2 h-0.5 overflow-hidden rounded-full bg-[color:var(--bg-hover)]"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-medium ease-standard"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <ol aria-label={t('onboardingStepsLabel')} className="grid grid-cols-3 gap-1 md:grid-cols-6">
        {steps.map((step) => {
          const isNext = step === nextStep;
          const tile =
            'flex h-full w-full flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center';
          if (step.done) {
            return (
              <li key={step.key} className={tile}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success-surface text-success-fg">
                  <Icon name="check" size={14} label={t('readinessItemDone')} />
                </span>
                <span className="text-[11px] font-medium leading-tight text-[color:var(--text-secondary)]">
                  {step.label}
                </span>
              </li>
            );
          }
          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => useModals.getState().openModal(step.modal)}
                className={`${tile} press-effect hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] ${
                  isNext ? 'bg-[color:var(--bg-hover)]' : ''
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${
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
            </li>
          );
        })}
      </ol>
    </section>
  );
}
