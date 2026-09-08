/**
 * useToastMutation.ts — A useMutation wrapper that shows a success toast on
 * completion and an error toast (via getErrorMessageForStepUp, so a cert-mode
 * step-up failure gets its own message) on failure. Collapses the repeated
 * mutate/toast/invalidate boilerplate on the admin pages.
 */
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getErrorMessageForStepUp } from '../lib/getErrorMessage';
import { useI18n } from '../stores/i18n.store';

export function useToastMutation<TVars>(opts: {
  mutationFn: (vars: TVars) => Promise<unknown>;
  successMessage: string;
  onSuccess?: () => void;
  errorFallback?: string;
}) {
  const { t } = useI18n();
  return useMutation({
    mutationFn: opts.mutationFn,
    onSuccess: () => {
      toast.success(opts.successMessage);
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      toast.error(
        getErrorMessageForStepUp(err, opts.errorFallback ?? 'Failed', t('certStepUpFailedToast')),
      );
    },
  });
}
