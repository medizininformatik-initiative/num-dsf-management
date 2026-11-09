/**
 * AuditSummaryBar.tsx – counts of flagged audit entries by severity for the
 * current filter. Each count is a StatusPill with icon + text (not colour-only).
 * Dependencies: StatusPill, i18n store, lib/auditDescribe
 */
import { StatusPill } from '../ui/StatusPill';
import { useI18n } from '../../stores/i18n.store';
import type { AuditFlagSeverity, AuditSummary } from '../../api/audit.api';
import { SEVERITY_ICON, SEVERITY_LABEL, SEVERITY_TONE } from '../../lib/auditDescribe';

const ORDER: AuditFlagSeverity[] = ['critical', 'warning', 'info'];

export function AuditSummaryBar({ summary }: { summary: AuditSummary }) {
  const { t } = useI18n();
  return (
    <section
      aria-label={t('auditSummaryTitle')}
      className="glass-thin mb-4 flex flex-wrap items-center gap-3 rounded-card px-4 py-3"
    >
      <h2 className="m-0 text-[13px] font-bold text-[color:var(--text-primary)]">
        {t('auditSummaryTitle')}
      </h2>
      {summary.flagged === 0 ? (
        <span className="text-[13px] text-[color:var(--text-secondary)]">
          {t('auditSummaryNone', { n: summary.scanned })}
        </span>
      ) : (
        <>
          {ORDER.map((sev) => (
            <StatusPill key={sev} tone={SEVERITY_TONE[sev]} icon={SEVERITY_ICON[sev]}>
              {t(SEVERITY_LABEL[sev])}: {summary[sev]}
            </StatusPill>
          ))}
          <span className="text-[12px] text-[color:var(--text-muted)]">
            {t('auditSummaryScanned', { n: summary.scanned })}
          </span>
        </>
      )}
    </section>
  );
}
