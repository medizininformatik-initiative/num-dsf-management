/**
 * RestoreDecisionDialog.tsx – step-up confirmation for approving, rejecting or
 * cancelling a restore request (TOTP code in OTP mode, the re-presented client
 * certificate in cert mode). Rejecting needs a comment. A spent code is cleared
 * after a failure while the dialog stays open; a request that was decided in
 * the meantime closes it and refreshes the page data.
 * Dependencies: StepUpConfirmDialog, tanstack-query, sonner, bundleVersions.api,
 *               getErrorMessage, fieldClasses, i18n store.
 */
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { StepUpConfirmDialog } from '../StepUpConfirmDialog';
import { FIELD_CLASS, LABEL_CLASS } from '../fieldClasses';
import { bundleVersionsApi, type BundleRestoreRequest } from '../../../api/bundleVersions.api';
import { getErrorCode, getErrorMessageForStepUp } from '../../../lib/getErrorMessage';
import { useI18n } from '../../../stores/i18n.store';
import type { RestoreDecisionKind } from './PendingRestoreCard';

interface Props {
  kind: RestoreDecisionKind;
  request: BundleRestoreRequest;
  onClose: () => void;
}

export function RestoreDecisionDialog({ kind, request, onClose }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const commentId = useId();
  const [totpCode, setTotpCode] = useState('');
  const [comment, setComment] = useState('');
  const n = request.sourceVersionNumber ?? '?';

  const decide = useMutation({
    mutationFn: async (code: string | undefined) => {
      if (kind === 'approve') return bundleVersionsApi.approveRestore(request.id, code);
      if (kind === 'reject')
        return bundleVersionsApi.rejectRestore(request.id, comment.trim(), code);
      return bundleVersionsApi.cancelRestore(request.id, code);
    },
    onSuccess: (res) => {
      if (kind === 'approve') {
        const data = res.data.data as { versionNumber: number; restoredFromVersion: number };
        toast.success(
          t('historyRestoreSuccess', { n: data.restoredFromVersion, m: data.versionNumber }),
        );
      } else {
        toast.success(
          t(kind === 'reject' ? 'bundleRestoreRejectedToast' : 'bundleRestoreCancelledToast'),
        );
      }
      void qc.invalidateQueries({ queryKey: ['bundle-versions'] });
      void qc.invalidateQueries({ queryKey: ['bundle-restores'] });
      onClose();
    },
    onError: (err) => {
      const code = getErrorCode(err);
      if (code === 'NOT_PENDING' || code === 'VERSION_NOT_RESTORABLE') {
        toast.error(
          t(code === 'NOT_PENDING' ? 'bundleRestoreNotPending' : 'historyRestoreNotRestorable'),
        );
        void qc.invalidateQueries({ queryKey: ['bundle-versions'] });
        void qc.invalidateQueries({ queryKey: ['bundle-restores'] });
        onClose();
        return;
      }
      toast.error(
        getErrorMessageForStepUp(err, t('bundleRestoreActionFailed'), t('certStepUpFailedToast')),
      );
      setTotpCode('');
    },
  });

  const titleKey = {
    approve: 'bundleRestoreApproveTitle',
    reject: 'bundleRestoreRejectTitle',
    cancel: 'bundleRestoreCancelTitle',
  } as const;
  const bodyKey = {
    approve: 'bundleRestoreApproveBody',
    reject: 'bundleRestoreRejectBody',
    cancel: 'bundleRestoreCancelBody',
  } as const;
  const confirmKey = {
    approve: 'bundleRestoreApprove',
    reject: 'bundleRestoreRejectConfirm',
    cancel: 'bundleRestoreCancelConfirm',
  } as const;

  return (
    <StepUpConfirmDialog
      open
      title={t(titleKey[kind], { n })}
      message={t(bodyKey[kind], { n })}
      consequence={kind === 'approve' ? t('historyRestoreConsequence') : undefined}
      confirmLabel={t(confirmKey[kind])}
      destructive={kind !== 'approve'}
      pending={decide.isPending}
      confirmDisabled={kind === 'reject' && comment.trim().length < 3}
      isDirty={kind === 'reject' && comment.trim() !== ''}
      totpCode={totpCode}
      onTotpCodeChange={setTotpCode}
      onConfirm={(code) => decide.mutate(code)}
      onCancel={onClose}
    >
      {kind === 'reject' && (
        <div>
          <label htmlFor={commentId} className={LABEL_CLASS}>
            {t('bundleRestoreCommentLabel')}
          </label>
          <textarea
            id={commentId}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={500}
            aria-required="true"
            className={FIELD_CLASS}
          />
        </div>
      )}
    </StepUpConfirmDialog>
  );
}
