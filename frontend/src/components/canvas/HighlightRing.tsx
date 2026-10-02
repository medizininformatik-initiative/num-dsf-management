/**
 * HighlightRing.tsx – marks the target of an FK jump (highlightEntity in the
 * canvas store) with a ring drawn over the target row when the highlight
 * names one that is rendered, otherwise over the target card. It is an
 * overlay, so the target's own DOM, styles and animations stay untouched.
 * One short pulse on entry (replayed when the same target is highlighted
 * again), a steady ring until the highlight clears (HIGHLIGHT_MS), then a
 * quick fade; static under Reduce Motion.
 * Dependencies: canvas store, usePresence, lib/motion, canvasGeometry,
 * useCanvasGeometry, canvas-overlay.css.
 */
import { useEffect, useState, type RefObject } from 'react';
import { findEntityRow, useCanvasStore, type EntityId } from '../../stores/canvas.store';
import { usePresence } from '../../hooks/usePresence';
import { exitMs, prefersReducedMotion } from '../../lib/motion';
import { boxIn, cornerRadius, type Box } from './canvasGeometry';
import { useCanvasGeometry } from './useCanvasGeometry';
import './canvas-overlay.css';

interface Target {
  entity: EntityId;
  rowKey: string | null;
  seq: number;
}

interface RingGeometry extends Box {
  radius: number;
}

export function HighlightRing({ containerRef }: { containerRef: RefObject<HTMLElement> }) {
  const entity = useCanvasStore((s) => s.highlightedEntity);
  const rowKey = useCanvasStore((s) => s.highlightedKey);
  const seq = useCanvasStore((s) => s.highlightSeq);
  const { mounted, state } = usePresence(
    entity !== null,
    prefersReducedMotion() ? 0 : exitMs('short'),
  );

  // The last target stays drawn while the ring fades out.
  const [lastTarget, setLastTarget] = useState<Target | null>(null);
  useEffect(() => {
    if (entity) setLastTarget({ entity, rowKey, seq });
  }, [entity, rowKey, seq]);
  const target: Target | null = entity ? { entity, rowKey, seq } : mounted ? lastTarget : null;

  const key = target ? `${target.entity}|${target.rowKey ?? ''}|${target.seq}` : null;
  const ring = useCanvasGeometry<RingGeometry>(containerRef, key, (container) => {
    if (!target) return null;
    const card = document.getElementById(`card-${target.entity}`);
    const row = target.rowKey ? findEntityRow(target.entity, target.rowKey) : null;
    const el = row ?? card;
    if (!el || !container.contains(el)) return null;
    return {
      geometry: { ...boxIn(container, el), radius: cornerRadius(el) },
      elements: card && card !== el ? [el, card] : [el],
    };
  });

  if (!mounted || !target || !ring) return null;
  return (
    <div
      key={target.seq}
      data-canvas-overlay="highlight"
      data-state={state}
      aria-hidden="true"
      className="fk-ring"
      style={{
        left: ring.x,
        top: ring.y,
        width: ring.w,
        height: ring.h,
        borderRadius: ring.radius,
      }}
    />
  );
}
