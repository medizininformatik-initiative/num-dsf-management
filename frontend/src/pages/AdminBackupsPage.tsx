/**
 * AdminBackupsPage.tsx – /app/admin/backups: schedule for the server-side
 * application backups, "back up now", the run history with checksums and
 * downloads, and the note that restoring is done by hand on the server. Writes
 * and downloads go through the step-up (TOTP dialog in OTP sessions, direct in
 * certificate sessions). A failed latest run is shown prominently.
 * Dependencies: useBackups, AdminPageHeader, BackupSettingsForm, BackupRunsList,
 * StepUpConfirmDialog, Skeleton, authMode, getErrorMessage, i18n store, sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import {
  useBackupRuns,
  useBackupSettings,
  useDownloadBackup,
  useRunBackup,
  useSaveBackupSettings,
} from '../hooks/useBackups';
import type { BackupRun, BackupSettingsInput } from '../api/backups.api';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { BackupSettingsForm } from '../components/admin/backupPanels/BackupSettingsForm';
import { BackupRunsList } from '../components/admin/backupPanels/BackupRunsList';
import { StepUpConfirmDialog } from '../components/admin/StepUpConfirmDialog';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Skeleton } from '../components/ui/Skeleton';
import { needsTotpStepUp } from '../lib/authMode';
import { getErrorMessageForStepUp } from '../lib/getErrorMessage';
import { useI18n } from '../stores/i18n.store';

const DOCS_URL =
  'https://github.com/Mukeyii/num-dsf-allowlist/blob/main/docs/DEPLOYMENT.md#backup-und-wiederherstellung';

type Pending =
  | { kind: 'save'; input: BackupSettingsInput }
  | { kind: 'run' }
  | { kind: 'download'; run: BackupRun };

export function AdminBackupsPage() {
  const { t } = useI18n();
  const settings = useBackupSettings();
  const runs = useBackupRuns();
  const save = useSaveBackupSettings();
  const runNow = useRunBackup();
  const download = useDownloadBackup();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState('');

  const latest = runs.data?.[0];

  function onError(err: unknown, fallback: string) {
    setCode('');
    toast.error(getErrorMessageForStepUp(err, fallback, t('certStepUpFailedToast')));
  }

  function execute(action: Pending, totpCode?: string) {
    const close = () => {
      setPending(null);
      setCode('');
    };
    if (action.kind === 'save') {
      save.mutate(
        { input: action.input, totpCode },
        {
          onSuccess: () => {
            close();
            toast.success(t('backupSettingsSaved'));
          },
          onError: (err) => onError(err, t('backupSettingsSaveFailed')),
        },
      );
    } else if (action.kind === 'run') {
      runNow.mutate(
        { totpCode },
        {
          onSuccess: () => {
            close();
            toast.success(t('backupRunCreated'));
          },
          onError: (err) => onError(err, t('backupRunFailedToast')),
        },
      );
    } else {
      download.mutate(
        { id: action.run.id, fileName: action.run.fileName ?? 'backup.json.gz', totpCode },
        {
          onSuccess: close,
          onError: (err) => onError(err, t('backupDownloadFailed')),
        },
      );
    }
  }

  function start(action: Pending) {
    if (needsTotpStepUp()) {
      setCode('');
      setPending(action);
    } else {
      execute(action);
    }
  }

  const busy = save.isPending || runNow.isPending || download.isPending;
  const dialogText: Record<Pending['kind'], { title: string; confirm: string; message: string }> = {
    save: {
      title: t('backupSaveDialogTitle'),
      confirm: t('backupSaveSettings'),
      message: t('backupSaveDialogMessage'),
    },
    run: {
      title: t('backupRunDialogTitle'),
      confirm: t('backupRunNow'),
      message: t('backupRunDialogMessage'),
    },
    download: {
      title: t('backupDownloadDialogTitle'),
      confirm: t('backupDownload'),
      message: t('backupDownloadDialogMessage'),
    },
  };

  return (
    <div className="flex-1 overflow-y-auto" data-testid="admin-backups">
      <AdminPageHeader
        title={t('backupPageTitle')}
        subtitle={t('backupPageSubtitle')}
        actions={
          <Button
            onClick={() => start({ kind: 'run' })}
            disabled={busy}
            aria-busy={runNow.isPending || undefined}
          >
            <Icon name="backup" size={18} /> {t('backupRunNow')}
          </Button>
        }
      />
      <div className="space-y-6 px-6 py-6 sm:px-8">
        {latest?.status === 'FAILED' && (
          <div
            role="alert"
            className="animate-fade-in rounded-card border border-danger-border bg-danger-surface p-4 text-sm text-danger-fg"
            data-testid="backup-failed-banner"
          >
            <p className="font-semibold">{t('backupLatestFailedTitle')}</p>
            <p className="mt-1">{latest.error}</p>
          </div>
        )}

        <div className="glass-thin flex gap-3 rounded-card p-4 text-sm">
          <Icon name="info" size={20} className="mt-0.5 shrink-0 text-info-fg" />
          <div className="space-y-1">
            <p>{t('backupRestoreHint')}</p>
            <p>
              {settings.data && (
                <span className="text-[color:var(--text-muted)]">
                  {settings.data.encryptionEnabled
                    ? t('backupEncryptionOn')
                    : t('backupEncryptionOff')}{' '}
                </span>
              )}
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline dark:text-brand-400"
              >
                {t('backupDocsLink')}
              </a>
            </p>
          </div>
        </div>

        {settings.isLoading ? (
          <Skeleton lines={4} />
        ) : settings.isError || !settings.data ? (
          <p role="alert" className="text-sm text-danger-fg">
            {t('backupLoadFailed')}
          </p>
        ) : (
          <BackupSettingsForm
            settings={settings.data.settings}
            saving={save.isPending}
            onSave={(values) => start({ kind: 'save', input: values })}
          />
        )}

        <section aria-labelledby="backup-runs-title" className="space-y-3">
          <h2 id="backup-runs-title" className="text-base font-semibold">
            {t('backupRunsTitle')}
          </h2>
          {runs.isLoading ? (
            <Skeleton lines={3} />
          ) : runs.isError ? (
            <p role="alert" className="text-sm text-danger-fg">
              {t('backupLoadFailed')}
            </p>
          ) : (
            <BackupRunsList
              runs={runs.data ?? []}
              downloadingId={download.isPending ? (download.variables?.id ?? null) : null}
              onDownload={(run) => start({ kind: 'download', run })}
            />
          )}
        </section>
      </div>

      <StepUpConfirmDialog
        open={pending !== null}
        title={pending ? dialogText[pending.kind].title : ''}
        message={pending ? dialogText[pending.kind].message : undefined}
        confirmLabel={pending ? dialogText[pending.kind].confirm : ''}
        pending={busy}
        totpCode={code}
        onTotpCodeChange={setCode}
        onConfirm={(totpCode) => pending && execute(pending, totpCode)}
        onCancel={() => {
          setPending(null);
          setCode('');
        }}
      />
    </div>
  );
}
