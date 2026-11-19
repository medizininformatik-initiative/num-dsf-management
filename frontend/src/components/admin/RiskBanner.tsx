/**
 * RiskBanner.tsx — Top strip of a pending request card: the risk level pill (plus a first-request
 * marker) and the compact verdict text. The pill carries its meaning as text and icon, never as
 * colour alone; the full detail stays in SnapshotView.
 * Dependencies: riskSummary, useI18n, StatusPill, Icon
 */
import type { RiskAssessment } from '../../api/admin.api';
import { useI18n } from '../../stores/i18n.store';
import { StatusPill } from '../ui/StatusPill';
import { buildRiskSummary, riskPill } from './riskSummary';

export function RiskBanner({ risk }: { risk: RiskAssessment }) {
  const { t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t('riskSectionLabel')}
      className="flex flex-col gap-1.5 rounded-control border border-[color:var(--border)] bg-[color:var(--bg-hover)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {riskPill(risk, t).map((pill) => (
          <StatusPill key={pill.label} tone={pill.tone} icon={pill.icon}>
            {pill.label}
          </StatusPill>
        ))}
      </div>
      <p className="text-sm text-[color:var(--text-primary)]">{buildRiskSummary(risk, t)}</p>
    </div>
  );
}
