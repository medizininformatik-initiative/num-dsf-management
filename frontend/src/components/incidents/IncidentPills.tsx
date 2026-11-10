/**
 * IncidentPills.tsx – the status, escalation level and "site suspended"
 * labels of an incident, on the shared StatusPill tones (level 1 neutral,
 * 2 warning, 3 danger).
 * Dependencies: StatusPill, incidentLabels, incidents.api types, i18n store.
 */
import type { EscalationLevel, Incident } from '../../api/incidents.api';
import type { StatusTone } from '../../lib/statusColors';
import { useI18n } from '../../stores/i18n.store';
import { StatusPill } from '../ui/StatusPill';
import { STATUS_ICON, STATUS_KEY, STATUS_TONE } from './incidentLabels';

const LEVEL_TONE: Record<EscalationLevel, StatusTone> = { 1: 'neutral', 2: 'warning', 3: 'danger' };

export function IncidentStatusPill({ status }: { status: Incident['status'] }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>
      {t(STATUS_KEY[status])}
    </StatusPill>
  );
}

export function EscalationLevelPill({ level }: { level: EscalationLevel }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={LEVEL_TONE[level]} title={t('incidentDetailLevel', { n: level })}>
      {t('incidentLevelShort', { n: level })}
    </StatusPill>
  );
}

/** The pills an incident row and the detail header share. */
export function IncidentPills({ incident }: { incident: Incident }) {
  const { t } = useI18n();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <IncidentStatusPill status={incident.status} />
      <EscalationLevelPill level={incident.escalationLevel} />
      {incident.suspended && (
        <StatusPill tone="danger" icon="block">
          {t('incidentSuspendedPill')}
        </StatusPill>
      )}
    </span>
  );
}
