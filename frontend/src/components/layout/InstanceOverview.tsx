/**
 * InstanceOverview.tsx – compact strip at the top of the dashboard: every
 * instance of the user with its approval status (newest request) and the date
 * of its last approval. Selecting one makes it the active instance. Owners can
 * archive or restore an instance and delete one that was never approved or
 * published (step-up dialog); a "Show archived" toggle lists archived
 * instances. Archiving keeps the site on the published allow list. Admins see
 * only their own instances here; the sidebar switcher lists all.
 * Dependencies: useInstanceOverview, useMe, canvas.store, i18n.store, entities
 * API, StepUpConfirmDialog, useConfirm, StatusPill, Icon, Button.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../api/entities.api';
import {
  useInstanceOverview,
  type InstanceApprovalStatus,
  type InstanceOverviewRow,
} from '../../hooks/useInstance';
import { useMe } from '../../hooks/useMe';
import { useConfirm } from '../../hooks/useConfirm';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import { formatDate } from '../../lib/dateUtils';
import { getErrorCode, getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import type { StatusTone } from '../../lib/statusColors';
import { StatusPill } from '../ui/StatusPill';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { StepUpConfirmDialog } from '../admin/StepUpConfirmDialog';

const STATUS_TONE: Record<InstanceApprovalStatus, StatusTone> = {
  NONE: 'neutral',
  DRAFT: 'info',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

/** An instance with an approved or pending request in its history can only be archived. */
function canDelete(row: InstanceOverviewRow): boolean {
  return (
    row.is_owner &&
    row.last_approved_at === null &&
    row.approval_status !== 'APPROVED' &&
    row.approval_status !== 'PENDING'
  );
}

export function InstanceOverview() {
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: rows = [] } = useInstanceOverview();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const setActiveInstance = useCanvasStore((s) => s.setActiveInstance);
  const [showArchived, setShowArchived] = useState(false);
  const [deleting, setDeleting] = useState<InstanceOverviewRow | null>(null);
  const [deleteCode, setDeleteCode] = useState('');

  const refresh = () => qc.invalidateQueries({ queryKey: ['instances'] });

  const archiveMut = useMutation({
    mutationFn: (vars: { id: string; archive: boolean }) =>
      vars.archive
        ? api(vars.id).archiveInstance(vars.id)
        : api(vars.id).unarchiveInstance(vars.id),
    onSuccess: (_res, vars) =>
      toast.success(t(vars.archive ? 'instanceArchivedToast' : 'instanceUnarchivedToast')),
    onError: () => toast.error(t('instanceArchiveFailed')),
    onSettled: refresh,
  });

  const deleteMut = useMutation({
    mutationFn: (vars: { id: string; totpCode?: string }) =>
      api(vars.id).deleteInstance(vars.id, vars.totpCode),
    onSuccess: () => {
      setDeleting(null);
      setDeleteCode('');
      toast.success(t('instanceDeletedToast'));
    },
    onError: (err: unknown) => {
      setDeleteCode('');
      if (getErrorCode(err) === 'INSTANCE_HAS_HISTORY') {
        setDeleting(null);
        toast.error(t('instanceErrorINSTANCE_HAS_HISTORY'));
        return;
      }
      toast.error(
        getErrorMessageForStepUp(err, t('instanceDeleteFailed'), t('certStepUpFailedToast')),
      );
    },
    onSettled: refresh,
  });

  // Admins reach every instance through the sidebar; the strip lists their own.
  const mine = me?.isAdmin ? rows.filter((r) => r.is_owner) : rows;
  const archivedCount = mine.filter((r) => r.archived_at).length;
  const visible = mine.filter((r) => showArchived || !r.archived_at);
  if (mine.length === 0) return null;

  async function requestArchive(row: InstanceOverviewRow) {
    const ok = await confirm({
      title: t('instanceArchiveTitle'),
      message: t('instanceArchiveMessage', { label: row.label }),
      consequence: t('instanceArchiveConsequence'),
      confirmLabel: t('instanceArchiveConfirm'),
    });
    if (ok) archiveMut.mutate({ id: row.id, archive: true });
  }

  return (
    <section aria-label={t('instanceOverviewLabel')} className="mx-4 mt-2 shrink-0">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
          {t('instanceOverviewTitle')}
        </h2>
        {archivedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[color:var(--text-secondary)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t('instanceShowArchived')} ({archivedCount})
          </label>
        )}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {visible.map((row) => {
          const isActive = row.id === activeInstanceId;
          return (
            <li
              key={row.id}
              data-testid={`instance-overview-${row.id}`}
              className={`surface-card flex items-center gap-1 py-1 pl-3 pr-1 ${
                row.archived_at ? 'opacity-70' : ''
              } ${isActive ? 'ring-1 ring-[color:var(--primary)]' : ''}`}
            >
              <button
                type="button"
                onClick={() => setActiveInstance(row.id)}
                aria-current={isActive ? 'true' : undefined}
                aria-label={t('instanceOpen', { label: row.label })}
                className="flex min-w-0 flex-col items-start gap-0.5 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[color:var(--text-primary)]">
                    {row.label}
                  </span>
                  <StatusPill tone={STATUS_TONE[row.approval_status]}>
                    {t(`instanceStatus${row.approval_status}`)}
                  </StatusPill>
                  {row.archived_at && <StatusPill>{t('instanceArchivedBadge')}</StatusPill>}
                </span>
                <span className="text-2xs text-[color:var(--text-muted)]">
                  {row.last_approved_at
                    ? t('instanceLastApproved', { date: formatDate(row.last_approved_at, lang) })
                    : t('instanceNeverApproved')}
                </span>
              </button>
              {row.is_owner && (
                <span
                  className="flex items-center"
                  role="group"
                  aria-label={t('instanceActionsLabel', { label: row.label })}
                >
                  {row.archived_at ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => archiveMut.mutate({ id: row.id, archive: false })}
                      disabled={archiveMut.isPending}
                      title={t('instanceUnarchive')}
                      aria-label={`${t('instanceUnarchive')}: ${row.label}`}
                      className="h-8 w-8 p-0"
                    >
                      <Icon name="unarchive" size={18} />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => requestArchive(row)}
                      disabled={archiveMut.isPending}
                      title={t('instanceArchive')}
                      aria-label={`${t('instanceArchive')}: ${row.label}`}
                      className="h-8 w-8 p-0"
                    >
                      <Icon name="archive" size={18} />
                    </Button>
                  )}
                  {canDelete(row) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteCode('');
                        setDeleting(row);
                      }}
                      title={t('instanceDelete')}
                      aria-label={`${t('instanceDelete')}: ${row.label}`}
                      className="h-8 w-8 p-0"
                    >
                      <Icon name="delete" size={18} />
                    </Button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <StepUpConfirmDialog
        open={deleting !== null}
        title={t('instanceDeleteTitle')}
        subtitle={deleting?.label}
        message={deleting && t('instanceDeleteMessage', { label: deleting.label })}
        consequence={t('instanceDeleteConsequence')}
        confirmLabel={t('instanceDeleteConfirm')}
        destructive
        pending={deleteMut.isPending}
        totpCode={deleteCode}
        onTotpCodeChange={setDeleteCode}
        onConfirm={(totpCode) => deleting && deleteMut.mutate({ id: deleting.id, totpCode })}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}
