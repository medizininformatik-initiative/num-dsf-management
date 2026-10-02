/**
 * confirmDelete.ts – Deletes an entity only after the user confirmed it.
 * Deletions reach every site of the federation with the next allow-list
 * bundle, so a single click never deletes: a destructive confirmation names
 * the object and the consequence (focus starts on Cancel), the confirmed
 * deletion runs through the cross-user guard (an admin acting on another
 * user's instance confirms that as well) and ends in a success or error toast.
 * Dependencies: sonner, i18n store, useConfirm, useCrossUserGuard.
 */
import { useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useI18n } from '../stores/i18n.store';
import { useConfirm, type ConfirmFn } from '../hooks/useConfirm';
import { useCrossUserGuard, type GuardFn } from '../hooks/useCrossUserGuard';

export interface DeleteRequest {
  /** Name of the object in the toasts, e.g. the endpoint's FQDN. */
  label: string;
  title: string;
  message: ReactNode;
  /** What happens next, e.g. which sites stop accepting the object. */
  consequence?: ReactNode;
  confirmLabel: string;
  /** The deletion itself; rejects on failure. */
  remove: () => Promise<unknown>;
}

/** Ask for confirmation, then run the deletion behind the cross-user guard. */
export async function confirmDelete(
  confirm: ConfirmFn,
  guard: GuardFn,
  { label, remove, ...dialog }: DeleteRequest,
): Promise<void> {
  const confirmed = await confirm({ ...dialog, destructive: true });
  if (!confirmed) return;
  guard(async () => {
    const { t } = useI18n.getState();
    try {
      await remove();
      toast.success(t('confirmDeleteSuccess', { label }));
    } catch {
      toast.error(t('confirmDeleteFailed', { label }));
    }
  });
}

/** confirmDelete bound to the nearest ConfirmProvider and cross-user guard. */
export function useConfirmDelete(): (request: DeleteRequest) => Promise<void> {
  const confirm = useConfirm();
  const guard = useCrossUserGuard();
  return useCallback((request) => confirmDelete(confirm, guard, request), [confirm, guard]);
}
