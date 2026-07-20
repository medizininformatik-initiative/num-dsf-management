/**
 * AdminOnboardingPage.tsx – /app/admin/onboarding
 * Bulk onboarding import: upload a CSV or JSON file of organizations (with
 * contact + client-certificate fingerprint) and create/update them in one
 * pass. Renders the per-row result table and any rows the parser skipped.
 * Dependencies: useOnboardingImport, useMe, useI18n, sonner
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useOnboardingImport } from '../hooks/useOnboardingImport';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';
import type { TranslationKey } from '../i18n/en';
import type { OnboardingImportResult, OnboardingImportRow } from '../api/onboarding.api';

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
    <div className="p-8 max-w-4xl mx-auto" data-testid="admin-onboarding">
      <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        {t('adminOnboardingTitle')}
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        {t('adminOnboardingIntro')}
      </p>

      <section
        className="mb-8 p-4 rounded-xl border"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              {t('adminOnboardingFileLabel')}
            </span>
            <input
              type="file"
              accept=".csv,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="onboarding-file-input"
              className="text-xs"
            />
            <span className="block text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {file ? file.name : t('adminOnboardingNoFileChosen')}
            </span>
          </label>
          <button
            type="button"
            onClick={handleImport}
            disabled={!file || isPending}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--primary)' }}
            data-testid="onboarding-import-btn"
          >
            {isPending ? t('adminOnboardingImporting') : t('adminOnboardingImportBtn')}
          </button>
        </div>
      </section>

      {result && (
        <section data-testid="onboarding-result">
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            {t('adminOnboardingSummary', {
              created: result.summary.created,
              updated: result.summary.updated,
              failed: result.summary.failed,
            })}
          </p>
          <table className="w-full text-sm mb-6">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left py-2 px-2 font-semibold">
                  {t('adminOnboardingColIdentifier')}
                </th>
                <th className="text-left py-2 px-2 font-semibold">
                  {t('adminOnboardingColAction')}
                </th>
                <th className="text-left py-2 px-2 font-semibold">
                  {t('adminOnboardingColStatus')}
                </th>
                <th className="text-left py-2 px-2 font-semibold">
                  {t('adminOnboardingColIssue')}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr
                  key={`${r.identifier}-${i}`}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td className="py-2 px-2 font-mono text-xs">{r.identifier}</td>
                  <td className="py-2 px-2 text-xs">{t(ACTION_KEY[r.action])}</td>
                  <td className="py-2 px-2 text-xs">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: '16px', color: r.ok ? '#22c55e' : '#ef4444' }}
                      aria-label={r.ok ? 'ok' : 'failed'}
                    >
                      {r.ok ? 'check_circle' : 'cancel'}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {r.issue || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.parseErrors.length > 0 && (
            <div data-testid="onboarding-parse-errors">
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                {t('adminOnboardingParseErrorsTitle')}
              </p>
              <ul className="text-xs" style={{ color: 'var(--text-muted)' }}>
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
  );
}
