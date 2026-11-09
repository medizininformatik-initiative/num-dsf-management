/**
 * OnboardingResults.tsx – the summary line, per-row table and skipped-row list
 * of an onboarding run. Used for the dry-run preview of an uploaded file
 * (step 2, wording "would be") and for the final import (step 3).
 * Dependencies: StatusPill, Icon, i18n store, onboarding.api types.
 */
import type { CSSProperties } from 'react';
import { StatusPill } from '../../ui/StatusPill';
import { Icon } from '../../ui/Icon';
import { useI18n } from '../../../stores/i18n.store';
import type { TranslationKey } from '../../../i18n/en';
import type { OnboardingImportResult, OnboardingImportRow } from '../../../api/onboarding.api';

const ACTION_KEY: Record<OnboardingImportRow['action'], TranslationKey> = {
  created: 'adminOnboardingActionCreated',
  updated: 'adminOnboardingActionUpdated',
  failed: 'adminOnboardingActionFailed',
};

export function OnboardingResults({ result }: { result: OnboardingImportResult }) {
  const { t } = useI18n();
  return (
    <section data-testid="onboarding-result" className="animate-fade-in space-y-4">
      <p className="text-sm font-semibold text-[color:var(--text-primary)]">
        {t('adminOnboardingSummary', {
          created: result.summary.created,
          updated: result.summary.updated,
          failed: result.summary.failed,
        })}
      </p>
      {result.rows.length > 0 && (
        <div className="surface-card overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[color:var(--bg-hover)]">
              <tr className="text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                <th className="px-4 py-2.5">{t('adminOnboardingColIdentifier')}</th>
                <th className="px-4 py-2.5">{t('adminOnboardingColAction')}</th>
                <th className="px-4 py-2.5">{t('adminOnboardingColStatus')}</th>
                <th className="px-4 py-2.5">{t('adminOnboardingColIssue')}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr
                  key={`${r.identifier}-${i}`}
                  style={{ '--stagger-index': i } as CSSProperties}
                  className="animate-list-item-in border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-[color:var(--text-primary)]">
                    {r.identifier}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[color:var(--text-secondary)]">
                    {t(ACTION_KEY[r.action])}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.ok ? (
                      <StatusPill tone="success" icon="check_circle">
                        {t('adminOnboardingStatusOk')}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="danger" icon="cancel">
                        {t('adminOnboardingStatusFailed')}
                      </StatusPill>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[color:var(--text-muted)]">
                    {r.issue || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.parseErrors.length > 0 && (
        <div
          data-testid="onboarding-parse-errors"
          className="rounded-card border border-warning-border bg-warning-surface p-4 text-warning-fg"
        >
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <Icon name="warning" size={14} />
            {t('adminOnboardingParseErrorsTitle')}
          </p>
          <ul className="space-y-0.5 text-xs">
            {result.parseErrors.map((pe, i) => (
              <li key={i}>
                {t('adminOnboardingParseErrorsRow', { row: pe.row })} · {pe.issue}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
