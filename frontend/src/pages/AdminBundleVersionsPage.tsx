/**
 * AdminBundleVersionsPage.tsx – allow-list history for admins: a timeline of
 * every published version (newest first, current marked) and an intuitive diff
 * of the selected version against its predecessor (or any other version),
 * plus restore of older versions behind a reason and the admin step-up.
 * Dependencies: bundleVersionsApi, bundleHistory/* components, i18n store.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { bundleVersionsApi, type BundleVersionListRow } from '../api/bundleVersions.api';
import { useI18n } from '../stores/i18n.store';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import { BundleTimeline } from '../components/admin/bundleHistory/BundleTimeline';
import { BundleDiffView } from '../components/admin/bundleHistory/BundleDiffView';
import { RestoreDialog } from '../components/admin/bundleHistory/RestoreDialog';
import { mapBundleDiff } from '../components/admin/bundleHistory/diffModel';
import { getErrorCode, getErrorMessageForStepUp } from '../lib/getErrorMessage';

export function AdminBundleVersionsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [toId, setToId] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(null);
  const [restoreRow, setRestoreRow] = useState<BundleVersionListRow | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['bundle-versions'],
    queryFn: () => bundleVersionsApi.list().then((r) => r.data),
  });

  // Newest first, whatever order the server used.
  const versions = useMemo(
    () => [...(list.data?.data ?? [])].sort((a, b) => b.version_number - a.version_number),
    [list.data],
  );
  const to = versions.find((v) => v.id === toId) ?? versions[0] ?? null;
  const toIndex = to ? versions.indexOf(to) : -1;
  const from =
    versions.find((v) => v.id === fromId && v.id !== to?.id) ?? versions[toIndex + 1] ?? null;
  // The diff API reads "A to B"; A must be the older version.
  const [older, newer] =
    to && from && from.version_number > to.version_number ? [to, from] : [from, to];

  const diff = useQuery({
    queryKey: ['bundle-versions-diff', older?.id, newer?.id],
    queryFn: () => bundleVersionsApi.diff(older!.id, newer!.id).then((r) => r.data.data),
    enabled: !!older && !!newer,
  });
  const model = useMemo(() => (diff.data ? mapBundleDiff(diff.data) : null), [diff.data]);

  const restore = useMutation({
    mutationFn: (input: { id: string; reason: string; totpCode?: string }) =>
      bundleVersionsApi.restore(input.id, { reason: input.reason, totpCode: input.totpCode }),
    onSuccess: (res, vars) => {
      const created = res.data.data;
      const source = versions.find((v) => v.id === vars.id);
      toast.success(
        t('historyRestoreSuccess', {
          n: source?.version_number ?? '',
          m: created.version_number,
        }),
      );
      setRestoreRow(null);
      setToId(null);
      setFromId(null);
      void qc.invalidateQueries({ queryKey: ['bundle-versions'] });
    },
    onError: (err) => {
      if (getErrorCode(err) === 'VERSION_NOT_RESTORABLE') {
        toast.error(t('historyRestoreNotRestorable'));
        setRestoreRow(null);
        void qc.invalidateQueries({ queryKey: ['bundle-versions'] });
        return;
      }
      setRestoreError(
        getErrorMessageForStepUp(err, t('historyRestoreFailed'), t('certStepUpFailedToast')),
      );
    },
  });

  function startRestore(row: BundleVersionListRow) {
    setRestoreError(null);
    restore.reset();
    setRestoreRow(row);
  }

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8" data-testid="admin-bundle-versions">
      <h1 className="mb-2 text-2xl font-semibold text-[color:var(--text-primary)]">
        {t('bundleVersionsTitle')}
      </h1>
      <p className="mb-6 max-w-2xl text-sm text-[color:var(--text-muted)]">{t('historyIntro')}</p>

      {list.isLoading ? (
        <Skeleton lines={4} />
      ) : list.isError ? (
        <div role="alert" className="glass-thin flex flex-wrap items-center gap-3 rounded-2xl p-4">
          <span className="text-sm text-danger-fg">{t('historyLoadFailed')}</span>
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {t('historyRetry')}
          </Button>
        </div>
      ) : versions.length === 0 ? (
        <p className="glass-thin rounded-2xl p-4 text-sm italic text-[color:var(--text-muted)]">
          {t('bundleVersionsEmpty')}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <BundleTimeline
            versions={versions}
            selectedId={to?.id ?? null}
            onSelect={(id) => {
              setToId(id);
              setFromId(null);
            }}
            onRestore={startRestore}
          />

          <section aria-live="polite" data-testid="bundle-versions-diff" className="min-w-0">
            {to && !from ? (
              <p className="glass-thin rounded-2xl p-4 text-sm text-[color:var(--text-secondary)]">
                {t('historyFirstVersion')}
              </p>
            ) : (
              to &&
              from &&
              older &&
              newer && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-[color:var(--text-primary)]">
                      {t('historyShowing', {
                        to: newer.version_number,
                        from: older.version_number,
                      })}
                    </h2>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[color:var(--text-secondary)]">
                      {t('historyCompareWith')}
                      <select
                        value={from.id}
                        onChange={(e) => setFromId(e.target.value)}
                        className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2 py-1 text-sm text-[color:var(--text-primary)]"
                      >
                        {versions
                          .filter((v) => v.id !== to.id)
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              v{v.version_number}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  {diff.isLoading ? (
                    <Skeleton lines={4} />
                  ) : diff.isError ? (
                    <div
                      role="alert"
                      className="glass-thin flex flex-wrap items-center gap-3 rounded-2xl p-4"
                    >
                      <span className="text-sm text-danger-fg">{t('historyDiffLoadFailed')}</span>
                      <Button size="sm" variant="secondary" onClick={() => void diff.refetch()}>
                        {t('historyRetry')}
                      </Button>
                    </div>
                  ) : model && diff.data ? (
                    <BundleDiffView model={model} raw={diff.data} />
                  ) : null}
                </div>
              )
            )}
          </section>
        </div>
      )}

      {restoreRow && (
        <RestoreDialog
          open
          versionNumber={restoreRow.version_number}
          busy={restore.isPending}
          error={restoreError}
          onCancel={() => setRestoreRow(null)}
          onConfirm={({ reason, totpCode }) => {
            setRestoreError(null);
            restore.mutate({ id: restoreRow.id, reason, totpCode });
          }}
        />
      )}
    </div>
  );
}
