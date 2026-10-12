/**
 * useCardDetails.ts – whether one entity card shows its details: the global view is
 * "detailed", or the user expanded this card by hand (local state, simplified view only).
 * Dependencies: useCanvasView.
 */
import { useState } from 'react';
import { useCanvasView } from './useCanvasView';

export interface CardDetails {
  /** True when this card currently shows its details. */
  detailed: boolean;
  /** True when the per-card toggle is offered (simplified global view). */
  canToggle: boolean;
  expanded: boolean;
  toggle: () => void;
}

export function useCardDetails(): CardDetails {
  const { view } = useCanvasView();
  const [expanded, setExpanded] = useState(false);
  const simple = view === 'simple';
  return {
    detailed: !simple || expanded,
    canToggle: simple,
    expanded,
    toggle: () => setExpanded((v) => !v),
  };
}
