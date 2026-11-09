/**
 * ReadinessChecklist.tsx – Right-panel submit-readiness checklist.
 * Reads the five entity hooks for the instance, derives per-step readiness via
 * deriveReadiness (the rule the wizard and the approval modal share), and
 * renders one row per step. The status icon carries a text alternative ("Done"
 * / "Missing"); each open row is a button that highlights the matching card
 * and scrolls it into view. Purely informational — it blocks nothing. The
 * right panel renders its own disclosure header and passes showTitle={false}.
 * Depends on: the five entity hooks, lib/readiness, Icon, i18n.store.
 */
import { useOrganization } from '../../hooks/useOrganization';
import { useContacts } from '../../hooks/useContacts';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useCertificates } from '../../hooks/useCertificates';
import { useMemberships } from '../../hooks/useMemberships';
import { deriveReadiness, READINESS_LABEL, revealReadinessCard } from '../../lib/readiness';
import { useI18n } from '../../stores/i18n.store';
import { Icon } from '../ui/Icon';

export function ReadinessChecklist({
  instanceId,
  showTitle = true,
}: {
  instanceId: string;
  showTitle?: boolean;
}) {
  const { t } = useI18n();
  const { data: organization } = useOrganization(instanceId);
  const { data: contacts = [] } = useContacts(instanceId);
  const { data: endpoints = [] } = useEndpoints(instanceId);
  const { data: certificates = [] } = useCertificates(instanceId);
  const { data: memberships = [] } = useMemberships(instanceId);

  const { items, ready, openCount } = deriveReadiness({
    organization,
    contacts,
    endpoints,
    certificates,
    memberships,
  });

  return (
    <div className="space-y-2">
      {showTitle && (
        <h3 className="text-xs font-semibold text-[color:var(--text-muted)]">
          {t('readinessTitle')}
        </h3>
      )}
      <ul className="space-y-1">
        {items.map((item) => {
          const label = t(READINESS_LABEL[item.key]);
          if (item.done) {
            return (
              <li
                key={item.key}
                className="flex items-center gap-2 rounded-control px-2 py-1 text-xs text-[color:var(--text-primary)]"
              >
                <Icon
                  name="check_circle"
                  size={16}
                  filled
                  label={t('readinessItemDone')}
                  className="text-success-fg"
                />
                <span>{label}</span>
              </li>
            );
          }
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => revealReadinessCard(item.key)}
                className="press-effect flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
              >
                <Icon
                  name="error"
                  size={16}
                  label={t('readinessItemMissing')}
                  className="text-warning-fg"
                />
                <span className="flex-1">{label}</span>
                <Icon name="arrow_forward" size={14} className="text-[color:var(--text-muted)]" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className={`text-xs font-bold ${ready ? 'text-success-fg' : 'text-warning-fg'}`}>
        {ready ? t('readinessReady') : t('readinessOpen', { count: openCount })}
      </p>
    </div>
  );
}
