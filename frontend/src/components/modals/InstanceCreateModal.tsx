/**
 * InstanceCreateModal.tsx — modal that creates a new DSF instance and selects it as active.
 * Shows onboarding steps; invalidates the instances query and updates the canvas store on success.
 * Dependencies: Modal, ModalFooter, Callout, entities API, canvas store, i18n store.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { ModalFooter } from './FormField';
import { Callout } from './Callout';
import { api } from '../../api/entities.api';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InstanceCreateModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const setActiveInstance = useCanvasStore((s) => s.setActiveInstance);
  const qc = useQueryClient();

  async function handleCreate() {
    setLoading(true);
    try {
      const res = await api('_').createInstance({ label: '' });
      const newInstance = res.data.data;
      await qc.invalidateQueries({ queryKey: ['instances'] });
      setActiveInstance(newInstance.id);
      toast.success(t('instanceCreateSuccess'), { duration: 6000 });
      onClose();
    } catch {
      toast.error(t('instanceCreateFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('instanceCreateTitle')} width="max-w-sm">
      <Callout tone="info" icon="add_circle">
        <p>{t('instanceCreateInfo')}</p>
        <ol className="list-inside list-decimal space-y-1 pt-1">
          <li>{t('instanceCreateStep1')}</li>
          <li>{t('instanceCreateStep2')}</li>
          <li>{t('instanceCreateStep3')}</li>
          <li>{t('instanceCreateStep4')}</li>
          <li>{t('instanceCreateStep5')}</li>
        </ol>
      </Callout>
      <ModalFooter
        onCancel={onClose}
        onSubmit={handleCreate}
        loading={loading}
        cancelLabel={t('instanceCreateCancelBtn')}
        submitLabel={t('instanceCreateBtn')}
        loadingLabel={t('instanceCreatingBtn')}
      />
    </Modal>
  );
}
