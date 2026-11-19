/**
 * AdminBundleVersionsPage.tsx – allow-list history for admins: a timeline of
 * every published version (newest first, current marked) and an intuitive diff
 * of the selected version against its predecessor (or any other version),
 * plus the four-eyes restore of older versions: an admin requests it with a
 * reason (step-up), a pending-request card lets a second admin of another site
 * approve or reject it (step-up) and the requester cancel it.
 * Dependencies: bundleVersionsApi, bundleHistory/* components, useMe, i18n store.
 */
import { Select } from '../components/ui/Select';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { bundleVersionsApi, type BundleVersionListRow } from '../api/bundleVersions.api';
import { useI18n } from '../stores/i18n.store';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { BundleTimeline } from '../components/admin/bundleHistory/BundleTimeline';
import { BundleDiffView } from '../components/admin/bundleHistory/BundleDiffView';
import { RestoreDialog } from '../components/admin/bundleHistory/RestoreDialog';
import {
  PendingRestoreCard,
  type RestoreDecisionKind,
} from '../components/admin/bundleHistory/PendingRestoreCard';
import { RestoreDecisionDialog } from '../components/admin/bundleHistory/RestoreDecisionDialog';
import { useMe } from '../hooks/useMe';
import { mapBundleDiff } from '../components/admin/bundleHistory/diffModel';
import { getErrorCode, getErrorMessageForStepUp } from '../lib/getErrorMessage';

export function AdminBundleVersionsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [toId, setToId] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(null);
  const [restoreRow, setRestoreRow] = useState<BundleVersionListRow | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [decisionKind, setDecisionKind] = useState<RestoreDecisionKind | null>(null);

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

  const { data: me } = useMe();
  const restores = useQuery({
    queryKey: ['bundle-restores'],
    queryFn: () => bundleVersionsApi.listRestores().then((r) => r.data.data),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const restoreRequests = useMemo(() => restores.data ?? [], [restores.data]);
  const pendingRestore = restoreRequests.find((r) => r.status === 'PENDING') ?? null;

  // Requesting only records the request; a second admin publishes it.
  const restore = useMutation({
    mutationFn: (input: { id: string; reason: string; totpCode?: string }) =>
      bundleVersionsApi.restore(input.id, { reason: input.reason, totpCode: input.totpCode }),
    onSuccess: (res) => {
      toast.success(t('bundleRestoreRequestedToast', { n: res.data.data.sourceVersionNumber }));
      setRestoreRow(null);
      void qc.invalidateQueries({ queryKey: ['bundle-restores'] });
    },
    onError: (err) => {
      const code = getErrorCode(err);
      if (code === 'VERSION_NOT_RESTORABLE' || code === 'ALREADY_PENDING') {
        toast.error(
          t(
            code === 'ALREADY_PENDING'
              ? 'bundleRestoreAlreadyPending'
              : 'historyRestoreNotRestorable',
          ),
        );
        setRestoreRow(null);
        void qc.invalidateQueries({ queryKey: ['bundle-versions'] });
        void qc.invalidateQueries({ queryKey: ['bundle-restores'] });
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
    <div className="flex-1 overflow-y-auto" data-testid="admin-bundle-versions">
      <AdminPageHeader title={t('bundleVersionsTitle')} subtitle={t('historyIntro')} />
      <div className="px-6 py-6 sm:px-8">
        {pendingRestore && (
          <PendingRestoreCard
            request={pendingRestore}
            meEmail={me?.email ?? null}
            onAction={setDecisionKind}
          />
        )}

        {list.isLoading ? (
          <div className="surface-card p-5">
            <Skeleton lines={4} />
          </div>
        ) : list.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-card border border-danger-border bg-danger-surface p-4"
          >
            <span className="text-sm text-danger-fg">{t('historyLoadFailed')}</span>
            <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
              {t('historyRetry')}
            </Button>
          </div>
        ) : versions.length === 0 ? (
          <p className="surface-card p-5 text-sm italic text-[color:var(--text-muted)]">
            {t('bundleVersionsEmpty')}
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <BundleTimeline
              restores={restoreRequests}
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
                <p className="surface-card p-4 text-sm text-[color:var(--text-secondary)]">
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
                        <Select value={from.id} onChange={(e) => setFromId(e.target.value)}>
                          {versions
                            .filter((v) => v.id !== to.id)
                            .map((v) => (
                              <option key={v.id} value={v.id}>
                                v{v.version_number}
                              </option>
                            ))}
                        </Select>
                      </label>
                    </div>
                    {diff.isLoading ? (
                      <div className="surface-card p-5">
                        <Skeleton lines={4} />
                      </div>
                    ) : diff.isError ? (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-3 rounded-card border border-danger-border bg-danger-surface p-4"
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

        {pendingRestore && decisionKind && (
          <RestoreDecisionDialog
            kind={decisionKind}
            request={pendingRestore}
            onClose={() => setDecisionKind(null)}
          />
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
    </div>
  );
}
