/**
 * stepUpError.store.ts – the last failed step-up (error code), published by the
 * axios interceptor and shown inline by StepUpConfirmDialog, so every step-up
 * dialog explains a wrong code or a missing TOTP setup without each caller
 * wiring it. Cleared when a dialog opens or the code is edited.
 * Dependencies: zustand.
 */
import { create } from 'zustand';

interface StepUpErrorState {
  code: string | null;
  setError: (code: string) => void;
  clear: () => void;
}

export const useStepUpErrorStore = create<StepUpErrorState>((set) => ({
  code: null,
  setError: (code) => set({ code }),
  clear: () => set({ code: null }),
}));
