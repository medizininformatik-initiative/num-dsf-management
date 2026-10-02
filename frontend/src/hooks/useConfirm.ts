/**
 * useConfirm.ts – promise-based confirmation for destructive or irreversible
 * actions, rendered as a ConfirmDialog by <ConfirmProvider>:
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: t('…'),
 *     message: t('…'),
 *     consequence: t('…'), // optional, emphasised
 *     confirmLabel: t('…'),
 *     destructive: true,
 *   });
 *   if (ok) deleteMutation.mutate(id);
 *
 * Resolves true on confirm and false on Cancel, Escape or a scrim click; a
 * newer request resolves an unanswered one with false. The provider is mounted
 * once in src/main.tsx, and renderWithProviders includes it for tests; without
 * it the returned promise rejects. Dependencies: react.
 */
import { createContext, useContext, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** Emphasised line about what happens next, e.g. "This cannot be undone." */
  consequence?: ReactNode;
  confirmLabel: string;
  /** Defaults to the translated "Cancel". */
  cancelLabel?: string;
  /** Confirm button in the error colour. */
  destructive?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn>(() =>
  Promise.reject(new Error('useConfirm() needs a <ConfirmProvider> above it.')),
);

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}
