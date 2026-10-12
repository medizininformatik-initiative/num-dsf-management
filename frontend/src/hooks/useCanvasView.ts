/**
 * useCanvasView.ts – the effective view of the entity cards: the user's remembered choice,
 * else the role default (admins see the details, everyone else the simplified view).
 * Dependencies: canvasView.store, useMe.
 */
import { useMe } from './useMe';
import { useCanvasViewStore, type CanvasView } from '../stores/canvasView.store';

export function useCanvasView(): { view: CanvasView; setView: (view: CanvasView) => void } {
  const choice = useCanvasViewStore((s) => s.choice);
  const setView = useCanvasViewStore((s) => s.setChoice);
  const isAdmin = useMe().data?.isAdmin === true;
  return { view: choice ?? (isAdmin ? 'detailed' : 'simple'), setView };
}
