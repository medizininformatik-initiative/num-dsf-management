/**
 * confirmDelete.test.ts — covers confirmDelete: it asks for a destructive
 * confirmation carrying title, message and consequence; deletes nothing when
 * that resolves false; runs a confirmed deletion inside the cross-user guard
 * (so a cancelled guard deletes nothing either) and reports the outcome as a
 * success or error toast with the label substituted. sonner is mocked so we can
 * assert which toast fired; the real i18n store supplies the strings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';

const success = vi.hoisted(() => vi.fn());
const error = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success, error } }));

import { confirmDelete, type DeleteRequest } from '../confirmDelete';
import { useI18n } from '../../stores/i18n.store';
import type { GuardFn } from '../../hooks/useCrossUserGuard';

const t = useI18n.getState().t;
const runAction: GuardFn = (action) => void action();

function request(overrides: Partial<DeleteRequest> = {}): DeleteRequest {
  return {
    label: 'fhir.example.de',
    title: 'Delete endpoint?',
    message: 'fhir.example.de will be removed from the allow list.',
    consequence: 'Every site stops accepting it.',
    confirmLabel: 'Delete',
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('confirmDelete', () => {
  beforeEach(() => {
    success.mockReset();
    error.mockReset();
    useI18n.getState().setLang('en');
  });

  it('asks for a destructive confirmation naming the object and the consequence', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    await confirmDelete(confirm, runAction, request());
    expect(confirm).toHaveBeenCalledWith({
      title: 'Delete endpoint?',
      message: 'fhir.example.de will be removed from the allow list.',
      consequence: 'Every site stops accepting it.',
      confirmLabel: 'Delete',
      destructive: true,
    });
  });

  it('deletes nothing when the confirmation is cancelled', async () => {
    const remove = vi.fn();
    const guard = vi.fn();
    await confirmDelete(vi.fn().mockResolvedValue(false), guard, request({ remove }));
    expect(guard).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('runs the confirmed deletion through the cross-user guard', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    // A guard that never runs the action: the admin cancelled the cross-user dialog.
    const guard = vi.fn();
    await confirmDelete(vi.fn().mockResolvedValue(true), guard, request({ remove }));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('shows the success toast with the label once the deletion resolves', async () => {
    const remove = vi.fn().mockResolvedValue('ok');
    await confirmDelete(vi.fn().mockResolvedValue(true), runAction, request({ remove }));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(t('confirmDeleteSuccess', { label: 'fhir.example.de' }));
    expect(error).not.toHaveBeenCalled();
  });

  it('shows the error toast when the deletion rejects', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('boom'));
    await confirmDelete(
      vi.fn().mockResolvedValue(true),
      runAction,
      request({ remove, label: 'CN=ukm.de' }),
    );
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith(t('confirmDeleteFailed', { label: 'CN=ukm.de' }));
    expect(success).not.toHaveBeenCalled();
  });
});
