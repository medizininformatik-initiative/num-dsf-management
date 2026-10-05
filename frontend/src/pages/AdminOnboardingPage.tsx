/**
 * AdminOnboardingPage.tsx – /app/admin/onboarding
 * Bulk onboarding of sites in three steps: (1) choose how to enter them —
 * the in-tool spreadsheet editor or an upload of any number of CSV / XLSX /
 * JSON files (every site sends its own), plus the downloadable templates;
 * (2) review and fix: uploaded files are parsed and merged into the one editor
 * table (each row tagged with its file, conflicts across files flagged), then
 * a server dry run reports per row what an import would do without writing
 * anything; (3) the import, run once over all rows, and its summary per file.
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
import { OnboardingFileSummary } from '../components/admin/onboarding/OnboardingFileSummary';
import { useOnboardingFiles } from '../components/admin/onboarding/useOnboardingFiles';
import {
  findConflicts,
  onboardingErrorKey,
  summarizeByFile,
  type FileSummaryItem,
} from '../components/admin/onboarding/onboardingFiles';
import {
  isBlankCells,
  newEditorRow,
  type EditorRow,
} from '../components/admin/onboarding/onboardingColumns';

const initialRows = () => [newEditorRow(), newEditorRow(), newEditorRow()];

export function AdminOnboardingPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const importer = useOnboardingImport();
  const dryRunner = useOnboardingDryRun();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [method, setMethod] = useState<OnboardingMethod>('editor');
  const [rows, setRows] = useState<EditorRow[]>(initialRows);
  const [preview, setPreview] = useState<OnboardingImportResult | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [result, setResult] = useState<OnboardingImportResult | null>(null);
  const [fileSummary, setFileSummary] = useState<FileSummaryItem[]>([]);

  function onRowsChange(next: EditorRow[]) {
    setRows(next);
    setPreview(null);
  }
  const uploads = useOnboardingFiles(rows, onRowsChange);

  // Non-blank editor rows as the import takes them, with their editor index.
  const submission = useMemo(() => {
    const inputs: OnboardingRowInput[] = [];
    const indices: number[] = [];
    const sources: EditorRow['source'][] = [];
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
      sources.push(r.source);
    });
    return { inputs, indices, sources };
  }, [rows]);

  const conflicts = useMemo(() => findConflicts(rows), [rows]);
  const conflictCount = Object.keys(conflicts).length;

  // Dry-run outcome keyed by editor row index.
  const serverStatus = useMemo(() => {
    const out: Record<number, EditorRowStatus> = {};
    for (const pe of preview?.parseErrors ?? []) {
      const idx = submission.indices[pe.row - 1];
      if (idx !== undefined) out[idx] = { tone: 'danger', text: pe.issue };
    }
    for (const r of preview?.rows ?? []) {
      const idx = r.row ? submission.indices[r.row - 1] : undefined;
      if (idx === undefined) continue;
      out[idx] = r.ok
        ? {
            tone: 'success',
            text: t(r.action === 'created' ? 'onbWillCreate' : 'onbWillUpdate'),
          }
        : { tone: 'danger', text: r.issue || t('adminOnboardingStatusFailed') };
    }
    // A conflict between rows (often from different files) beats the dry-run verdict.
    for (const [i, c] of Object.entries(conflicts)) {
      const where = c.others.map((o) => (o.file ? `${o.row} (${o.file})` : `${o.row}`)).join(', ');
      out[Number(i)] = {
        tone: 'danger',
        text: t(c.kind === 'identifier' ? 'onbConflictIdentifier' : 'onbConflictFingerprint', {
          rows: where,
        }),
      };
    }
    return out;
  }, [preview, submission, conflicts, t]);

  if (me && !me.isAdmin) return <Navigate to="/app" replace />;

  const source = submission.inputs;
  const hasRows = rows.some((r) => !isBlankCells(r.cells));
  const okCount = preview ? preview.rows.filter((r) => r.ok).length : 0;
  const skipped = preview ? preview.parseErrors.length + preview.summary.failed : 0;
  const busy = importer.isPending || dryRunner.isPending || uploads.parsing;

  function fail(err: unknown, fallback: TranslationKey) {
    const key = onboardingErrorKey(err);
    toast.error(key ? t(key) : t(fallback));
  }

  async function runDryRun(src: OnboardingRowInput[]) {
    if (src.length === 0) return;
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

  async function handleImport() {
    if (source.length === 0) return;
    try {
      const data = await importer.mutateAsync(source);
      setFileSummary(summarizeByFile(data, submission.sources));
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
    uploads.reset();
    setPreview(null);
    setResult(null);
    setFileSummary([]);
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

              {method === 'file' && (
                <OnboardingUpload
                  files={uploads.files}
                  removing={uploads.removing}
                  onFiles={(list) => void uploads.addFiles(list)}
                  onRemove={uploads.removeFile}
                  disabled={importer.isPending || dryRunner.isPending}
                />
              )}
              {(method === 'editor' || hasRows) && (
                <OnboardingEditor
                  rows={rows}
                  onChange={onRowsChange}
                  showAllErrors={showAllErrors}
                  serverStatus={serverStatus}
                  disabled={importer.isPending}
                />
              )}

              {conflictCount > 0 && (
                <p
                  role="alert"
                  data-testid="onboarding-conflicts"
                  className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-[13px] text-danger-fg"
                >
                  {t('onbConflictsNote', { count: conflictCount })}
                </p>
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
                <Button
                  variant="secondary"
                  onClick={() => runDryRun(submission.inputs)}
                  disabled={busy || submission.inputs.length === 0}
                  data-testid="onboarding-validate-btn"
                >
                  <Icon name="fact_check" size={18} />
                  {dryRunner.isPending ? t('onbValidating') : t('onbValidate')}
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={busy || !preview || okCount === 0 || conflictCount > 0}
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
              <OnboardingFileSummary items={fileSummary} />
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
