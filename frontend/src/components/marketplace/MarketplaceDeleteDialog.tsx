/**
 * MarketplaceDeleteDialog.tsx — admin confirmation for removing a marketplace
 * entry, on the foundation Modal. In OTP mode it collects the TOTP step-up
 * code; in cert mode the re-presented client certificate is the step-up.
 * Dependencies: Modal, Button, useDeleteMarketplaceEntry, i18n.store, authMode,
 *               getErrorMessage, sonner
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from '../modals/Modal';
import { inputClass } from '../modals/FormField';
import { Button } from '../ui/Button';
import { useDeleteMarketplaceEntry } from '../../hooks/useMarketplace';
import { useI18n } from '../../stores/i18n.store';
import { getErrorMessageForStepUp } from '../../lib/getErrorMessage';
import { needsTotpStepUp } from '../../lib/authMode';
import type { MarketplaceEntry } from '../../api/marketplace.api';

interface Props {
  entry: MarketplaceEntry | null;
  onClose: () => void;
}

export function MarketplaceDeleteDialog({ entry, onClose }: Props) {
  const { t } = useI18n();
  const deleteMut = useDeleteMarketplaceEntry();
  const [code, setCode] = useState('');
  const stepUp = needsTotpStepUp();

  function close() {
    setCode('');
    onClose();
  }

  async function handleDelete() {
    if (!entry) return;
    if (stepUp && code.length !== 6) {
      toast.error(t('totpRequired'));
      return;
    }
    try {
      await deleteMut.mutateAsync({ id: entry.id, body: stepUp ? { totpCode: code } : {} });
      toast.success(t('marketplaceDelete'));
      close();
    } catch (err: unknown) {
      toast.error(
        getErrorMessageForStepUp(err, t('genericActionFailed'), t('certStepUpFailedToast')),
      );
    }
  }

  return (
    <Modal
      open={!!entry}
      onClose={close}
      title={t('marketplaceConfirmDelete')}
      subtitle={entry ? entry.name || entry.gitUrl : undefined}
      width="max-w-md"
    >
      {stepUp && (
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          aria-label={t('totpCodeLabel')}
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
          className={`${inputClass} mb-4 max-w-[12rem] text-center font-mono tracking-[0.3em]`}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={close}>
          {t('cancel')}
        </Button>
        <Button variant="destructive" onClick={handleDelete} disabled={deleteMut.isPending}>
          {t('marketplaceDelete')}
        </Button>
      </div>
    </Modal>
  );
}
