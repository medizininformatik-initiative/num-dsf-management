/**
 * AdminOnboardingPage.tsx – /app/admin/onboarding
 * Bulk onboarding import: upload a CSV or JSON file of organizations (with
 * contact + client-certificate fingerprint) and create/update them in one
 * pass. Renders the per-row result table (status as StatusPill) and any rows
 * the parser skipped.
 * Dependencies: useOnboardingImport, useMe, useI18n, AdminPageHeader, Button,
 * StatusPill, Icon, fieldClasses, sonner
 */
import { useId, useState, type CSSProperties } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useOnboardingImport } from '../hooks/useOnboardingImport';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';
import type { TranslationKey } from '../i18n/en';
import type { OnboardingImportResult, OnboardingImportRow } from '../api/onboarding.api';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { LABEL_CLASS } from '../components/admin/fieldClasses';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { Icon } from '../components/ui/Icon';

const ERROR_CODE_KEY: Record<string, TranslationKey> = {
  FILE_TOO_LARGE: 'adminOnboardingErrorFileTooLarge',
  PEM_NOT_ALLOWED: 'adminOnboardingErrorPemNotAllowed',
  UNSUPPORTED_FORMAT: 'adminOnboardingErrorUnsupportedFormat',
  TOO_MANY_ROWS: 'adminOnboardingErrorTooManyRows',
  EMPTY_BODY: 'adminOnboardingErrorEmptyBody',
};

const ACTION_KEY: Record<OnboardingImportRow['action'], TranslationKey> = {
  created: 'adminOnboardingActionCreated',
  updated: 'adminOnboardingActionUpdated',
  failed: 'adminOnboardingActionFailed',
};

function errorCodeOf(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error
    ?.code;
}

export function AdminOnboardingPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { mutateAsync, isPending } = useOnboardingImport();
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OnboardingImportResult | null>(null);

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  async function handleImport() {
    if (!file) return;
    try {
      const data = await mutateAsync(file);
      setResult(data);
      toast.success(t('adminOnboardingSuccessToast'));
    } catch (err: unknown) {
      const code = errorCodeOf(err);
      const key = code ? ERROR_CODE_KEY[code] : undefined;
      toast.error(key ? t(key) : t('adminOnboardingImportFailed'));
    }
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="admin-onboarding">
      <AdminPageHeader
        icon="upload_file"
        title={t('adminOnboardingTitle')}
        subtitle={t('adminOnboardingIntro')}
      />

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 sm:px-8">
        <section className="flex flex-col gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor={fileId} className={LABEL_CLASS}>
              {t('adminOnboardingFileLabel')}
            </label>
            <input
              id={fileId}
              type="file"
              accept=".csv,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="onboarding-file-input"
              className="block w-full text-xs text-[color:var(--text-secondary)] file:mr-3 file:cursor-pointer file:rounded-button file:border file:border-solid file:border-[color:var(--border)] file:bg-[color:var(--bg-card)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[color:var(--text-primary)] hover:file:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
            />
            <span className="mt-1 block text-xs text-[color:var(--text-muted)]">
              {file ? file.name : t('adminOnboardingNoFileChosen')}
            </span>
          </div>
          <Button
            onClick={handleImport}
            disabled={!file || isPending}
            data-testid="onboarding-import-btn"
          >
            <Icon name="upload" size={18} />
            {isPending ? t('adminOnboardingImporting') : t('adminOnboardingImportBtn')}
          </Button>
        </section>

        {result && (
          <section data-testid="onboarding-result" className="animate-fade-in space-y-4">
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">
              {t('adminOnboardingSummary', {
                created: result.summary.created,
                updated: result.summary.updated,
                failed: result.summary.failed,
              })}
            </p>
            <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)]">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className="bg-[color:var(--bg-hover)]">
                  <tr className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-secondary)]">
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

            {result.parseErrors.length > 0 && (
              <div
                data-testid="onboarding-parse-errors"
                className="rounded-xl border border-warning-border bg-warning-surface p-4 text-warning-fg"
              >
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                  <Icon name="warning" size={16} />
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
        )}
      </div>
    </div>
  );
}
