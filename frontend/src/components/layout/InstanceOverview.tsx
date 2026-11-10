/**
 * InstanceOverview.tsx – compact strip at the top of the dashboard: every
 * instance of the user with its approval status (newest request) and the date
 * of its last approval. Selecting one makes it the active instance. Owners can
 * archive or restore an instance and delete one that was never approved or
 * published (step-up dialog); a "Show archived" toggle lists archived
 * instances. Archiving keeps the site on the published allow list. Admins see
 * only their own instances here; the sidebar switcher lists all.
 * Rendered as a dense grid of chips (two rows, scrolls beyond that), collapsible
 * per user (localStorage); the row actions appear on hover or keyboard focus.
 * With a single instance only its chip is shown, without header.
 * Dependencies: useInstanceOverview, useMe, canvas.store, i18n.store, entities
 * API, StepUpConfirmDialog, useConfirm, StatusPill, Icon, Button.
 */
import { useEffect, useState } from 'react';
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
  const collapseKey = `instance-overview-collapsed:${me?.email ?? ''}`;
  const readCollapsed = () => {
    try {
      return localStorage.getItem(collapseKey) === '1';
    } catch {
      return false;
    }
  };
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // The user arrives after the first render; pick up their stored choice then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setCollapsed(readCollapsed()), [collapseKey]);
  const [deleting, setDeleting] = useState<InstanceOverviewRow | null>(null);
  const [deleteCode, setDeleteCode] = useState('');

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(collapseKey, next ? '1' : '0');
    } catch {
      /* storage unavailable: the choice just lasts for this visit */
    }
  }

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

  const single = mine.length === 1;
  const listVisible = single || !collapsed;

  return (
    <section aria-label={t('instanceOverviewLabel')} className="mx-4 mt-2 shrink-0">
      {!single && (
        <div className="mb-1 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="instance-overview-list"
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]"
          >
            <Icon name={collapsed ? 'chevron_right' : 'expand_more'} size={16} />
            <h2 className="m-0 text-xs font-semibold uppercase tracking-wide">
              {t('instanceOverviewTitle')} ({visible.length})
            </h2>
          </button>
          {archivedCount > 0 && !collapsed && (
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
      )}
      {listVisible && (
        <ul
          id="instance-overview-list"
          className="m-0 grid max-h-[5.25rem] list-none grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-1.5 overflow-y-auto p-0.5"
        >
          {visible.map((row) => {
            const isActive = row.id === activeInstanceId;
            const approved = row.last_approved_at
              ? t('instanceLastApproved', { date: formatDate(row.last_approved_at, lang) })
              : t('instanceNeverApproved');
            return (
              <li
                key={row.id}
                data-testid={`instance-overview-${row.id}`}
                title={`${row.label} - ${approved}`}
                className={`surface-card group flex h-9 items-center gap-1 py-0 pl-2.5 pr-1 ${
                  row.archived_at ? 'opacity-70' : ''
                } ${isActive ? 'ring-1 ring-[color:var(--primary)]' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setActiveInstance(row.id)}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={t('instanceOpen', { label: row.label })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="truncate text-sm font-medium text-[color:var(--text-primary)]">
                    {row.label}
                  </span>
                  <StatusPill tone={STATUS_TONE[row.approval_status]}>
                    {t(`instanceStatus${row.approval_status}`)}
                  </StatusPill>
                  {row.archived_at && <StatusPill>{t('instanceArchivedBadge')}</StatusPill>}
                </button>
                {row.is_owner && (
                  <span
                    className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
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
                        className="h-7 w-7 p-0"
                      >
                        <Icon name="unarchive" size={16} />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => requestArchive(row)}
                        disabled={archiveMut.isPending}
                        title={t('instanceArchive')}
                        aria-label={`${t('instanceArchive')}: ${row.label}`}
                        className="h-7 w-7 p-0"
                      >
                        <Icon name="archive" size={16} />
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
                        className="h-7 w-7 p-0"
                      >
                        <Icon name="delete" size={16} />
                      </Button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

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
