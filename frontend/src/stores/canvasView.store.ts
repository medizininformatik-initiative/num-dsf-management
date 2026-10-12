/**
 * canvasView.store.ts – the user's explicit choice between the simplified and the detailed
 * view of the entity cards. `choice` is null until the user picks one; the effective view
 * then falls back to a role default (see hooks/useCanvasView.ts). The choice is remembered
 * per browser in localStorage (`dsf.canvasView`); storage failures are ignored.
 * Dependencies: zustand.
 */
import { create } from 'zustand';

export type CanvasView = 'simple' | 'detailed';

export const CANVAS_VIEW_KEY = 'dsf.canvasView';

function readChoice(): CanvasView | null {
  try {
    const stored = localStorage.getItem(CANVAS_VIEW_KEY);
    return stored === 'simple' || stored === 'detailed' ? stored : null;
  } catch {
    return null;
  }
}

interface CanvasViewState {
  choice: CanvasView | null;
  setChoice: (view: CanvasView) => void;
}

export const useCanvasViewStore = create<CanvasViewState>((set) => ({
  choice: readChoice(),
  setChoice: (view) => {
    try {
      localStorage.setItem(CANVAS_VIEW_KEY, view);
    } catch {
      // Private mode or blocked storage: the choice still applies for this session.
    }
    set({ choice: view });
  },
}));
