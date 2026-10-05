/**
 * AdminOnboardingPage.tsx – /app/admin/onboarding
 * Bulk onboarding of sites in three steps: (1) choose how to enter them —
 * the in-tool spreadsheet editor or a CSV / XLSX / JSON upload, plus the
 * downloadable templates; (2) review and fix, driven by a server dry run that
 * reports per row what an import would do without writing anything; (3) the
 * import and its summary.
 * Dependencies: useOnboardingImport / useOnboardingDryRun, useMe, useI18n,
 * the components in components/admin/onboarding, AdminPageHeader, Button, Icon, sonner
 */
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useOnboardingDryRun, useOnboardingImport } from '../hooks/useOnboardingImport';
import { useMe } from '../hooks/useMe';
import { useI18n } from '../stores/i18n.store';
import type { TranslationKey } from '../i18n/en';
import type { OnboardingImportResult, OnboardingRowInput } from '../api/onboarding.api';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { OnboardingStepper } from '../components/admin/onboarding/OnboardingStepper';
import {
  OnboardingMethodStep,
  type OnboardingMethod,
} from '../components/admin/onboarding/OnboardingMethodStep';
import {
  OnboardingEditor,
  type EditorRowStatus,
} from '../components/admin/onboarding/OnboardingEditor';
import { OnboardingUpload } from '../components/admin/onboarding/OnboardingUpload';
import { OnboardingResults } from '../components/admin/onboarding/OnboardingResults';
import {
  isBlankCells,
  newEditorRow,
  type EditorRow,
} from '../components/admin/onboarding/onboardingColumns';

const ERROR_CODE_KEY: Record<string, TranslationKey> = {
  FILE_TOO_LARGE: 'adminOnboardingErrorFileTooLarge',
  PEM_NOT_ALLOWED: 'adminOnboardingErrorPemNotAllowed',
  UNSUPPORTED_FORMAT: 'adminOnboardingErrorUnsupportedFormat',
  TOO_MANY_ROWS: 'adminOnboardingErrorTooManyRows',
  EMPTY_BODY: 'adminOnboardingErrorEmptyBody',
};

function errorCodeOf(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error
    ?.code;
}

const initialRows = () => [newEditorRow(), newEditorRow(), newEditorRow()];

export function AdminOnboardingPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const importer = useOnboardingImport();
  const dryRunner = useOnboardingDryRun();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [method, setMethod] = useState<OnboardingMethod>('editor');
  const [rows, setRows] = useState<EditorRow[]>(initialRows);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OnboardingImportResult | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [result, setResult] = useState<OnboardingImportResult | null>(null);

  // Non-blank editor rows as the import takes them, with their editor index.
  const submission = useMemo(() => {
    const inputs: OnboardingRowInput[] = [];
    const indices: number[] = [];
    rows.forEach((r, i) => {
      if (isBlankCells(r.cells)) return;
      const c = r.cells;
      inputs.push({
        organizationIdentifier: c.organizationIdentifier,
        organizationName: c.organizationName,
        contactEmail: c.contactEmail,
        clientCertFingerprint: c.clientCertFingerprint,
        ...(c.city.trim() ? { city: c.city } : {}),
        ...(c.countryCode.trim() ? { countryCode: c.countryCode } : {}),
      });
      indices.push(i);
    });
    return { inputs, indices };
  }, [rows]);

  // Dry-run outcome keyed by editor row index.
  const serverStatus = useMemo(() => {
    const out: Record<number, EditorRowStatus> = {};
    if (!preview || method !== 'editor') return out;
    for (const pe of preview.parseErrors) {
      const idx = submission.indices[pe.row - 1];
      if (idx !== undefined) out[idx] = { tone: 'danger', text: pe.issue };
    }
    for (const r of preview.rows) {
      const idx = r.row ? submission.indices[r.row - 1] : undefined;
      if (idx === undefined) continue;
      out[idx] = r.ok
        ? {
            tone: 'success',
            text: t(r.action === 'created' ? 'onbWillCreate' : 'onbWillUpdate'),
          }
        : { tone: 'danger', text: r.issue || t('adminOnboardingStatusFailed') };
    }
    return out;
  }, [preview, method, submission, t]);

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  const source = method === 'editor' ? submission.inputs : file;
  const okCount = preview ? preview.rows.filter((r) => r.ok).length : 0;
  const skipped = preview ? preview.parseErrors.length + preview.summary.failed : 0;
  const busy = importer.isPending || dryRunner.isPending;

  function fail(err: unknown, fallback: TranslationKey) {
    const code = errorCodeOf(err);
    const key = code ? ERROR_CODE_KEY[code] : undefined;
    toast.error(key ? t(key) : t(fallback));
  }

  async function runDryRun(src: File | OnboardingRowInput[] | null) {
    if (!src || (Array.isArray(src) && src.length === 0)) return;
    setShowAllErrors(true);
    setPreview(null);
    try {
      setPreview(await dryRunner.mutateAsync(src));
    } catch (err: unknown) {
      fail(err, 'onbValidateFailed');
    }
  }

  function chooseMethod(m: OnboardingMethod) {
    setMethod(m);
    setPreview(null);
    setStep(2);
  }

  function onFile(next: File | null) {
    setFile(next);
    setPreview(null);
    void runDryRun(next);
  }

  function onRowsChange(next: EditorRow[]) {
    setRows(next);
    setPreview(null);
  }

  async function handleImport() {
    if (!source) return;
    try {
      const data = await importer.mutateAsync(source);
      setResult(data);
      setStep(3);
      toast.success(t('adminOnboardingSuccessToast'));
    } catch (err: unknown) {
      fail(err, 'adminOnboardingImportFailed');
    }
  }

  function startOver() {
    setStep(1);
    setRows(initialRows());
    setFile(null);
    setPreview(null);
    setResult(null);
    setShowAllErrors(false);
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="admin-onboarding">
      <AdminPageHeader
        icon="upload_file"
        title={t('adminOnboardingTitle')}
        subtitle={t('adminOnboardingIntro')}
      />

      <div className="space-y-6 px-6 py-6 sm:px-8">
        <OnboardingStepper current={step} />

        <div key={step} className="animate-list-item-in space-y-5">
          {step === 1 && <OnboardingMethodStep onChoose={chooseMethod} />}

          {step === 2 && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={busy}>
                  <Icon name="arrow_back" size={18} />
                  {t('onbBack')}
                </Button>
                <h2 className="text-[15px] font-semibold text-[color:var(--text-primary)]">
                  {t(method === 'editor' ? 'onbMethodEditorTitle' : 'onbMethodFileTitle')}
                </h2>
              </div>

              {method === 'editor' ? (
                <OnboardingEditor
                  rows={rows}
                  onChange={onRowsChange}
                  showAllErrors={showAllErrors}
                  serverStatus={serverStatus}
                  disabled={importer.isPending}
                />
              ) : (
                <>
                  <OnboardingUpload file={file} onFile={onFile} disabled={busy} />
                  {preview && <OnboardingResults result={preview} />}
                </>
              )}

              {preview && (
                <p
                  role="status"
                  data-testid="onboarding-preview-note"
                  className="glass-thin rounded-xl px-4 py-3 text-[13px] text-[color:var(--text-secondary)]"
                >
                  {t('onbPreviewNote', { ok: okCount, skipped })}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                {method === 'editor' && (
                  <Button
                    variant="secondary"
                    onClick={() => runDryRun(submission.inputs)}
                    disabled={busy || submission.inputs.length === 0}
                    data-testid="onboarding-validate-btn"
                  >
                    <Icon name="fact_check" size={18} />
                    {dryRunner.isPending ? t('onbValidating') : t('onbValidate')}
                  </Button>
                )}
                <Button
                  onClick={handleImport}
                  disabled={busy || !preview || okCount === 0}
                  data-testid="onboarding-import-btn"
                >
                  <Icon name="upload" size={18} />
                  {importer.isPending
                    ? t('adminOnboardingImporting')
                    : t('onbImportN', { count: okCount })}
                </Button>
              </div>
              {!preview && !busy && (
                <p className="text-right text-xs text-[color:var(--text-muted)]">
                  {t('onbValidateFirst')}
                </p>
              )}
            </>
          )}

          {step === 3 && result && (
            <>
              <OnboardingResults result={result} />
              <div className="flex flex-wrap justify-end gap-2">
                {(result.summary.failed > 0 || result.parseErrors.length > 0) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPreview(null);
                      setStep(2);
                    }}
                  >
                    <Icon name="edit" size={18} />
                    {t('onbFixAndRetry')}
                  </Button>
                )}
                <Button onClick={startOver} data-testid="onboarding-start-over">
                  <Icon name="add" size={18} />
                  {t('onbOnboardMore')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
