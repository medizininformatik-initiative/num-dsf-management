/**
 * RelationOverlay.tsx – draws the active relation (the FK link under the
 * pointer or keyboard focus, see canvas.store) as one SVG cubic Bézier from
 * the FK source to the target row, or to the target card when that row is
 * not rendered, with small end markers and a subtle ring around the target.
 * It lives in the canvas scroll container, is never interactive and is
 * aria-hidden: the FK button's own name says where it leads. It re-measures
 * on scroll, resize and layout changes (useCanvasGeometry), draws on in
 * ~150 ms, fades out faster, and is static under Reduce Motion.
 * Dependencies: canvas store, usePresence, lib/motion, canvasGeometry,
 * useCanvasGeometry, canvas-overlay.css.
 */
import { useEffect, useState, type RefObject } from 'react';
import { findEntityRow, useCanvasStore, type ActiveRelation } from '../../stores/canvas.store';
import { usePresence } from '../../hooks/usePresence';
import { exitMs, prefersReducedMotion } from '../../lib/motion';
import { boxIn, cornerRadius, relationCurve, type Box, type RelationCurve } from './canvasGeometry';
import { useCanvasGeometry } from './useCanvasGeometry';
import './canvas-overlay.css';

interface RelationGeometry {
  curve: RelationCurve;
  target: Box;
  targetRadius: number;
}

/** Gap between the target and the ring drawn around it, in px. */
const RING_GAP = 3;

export function RelationOverlay({ containerRef }: { containerRef: RefObject<HTMLElement> }) {
  const relation = useCanvasStore((s) => s.activeRelation);
  const { mounted, state } = usePresence(
    relation !== null,
    prefersReducedMotion() ? 0 : exitMs('micro'),
  );

  // The last relation stays drawn while the line fades out.
  const [lastRelation, setLastRelation] = useState<ActiveRelation | null>(null);
  useEffect(() => {
    if (relation) setLastRelation(relation);
  }, [relation]);
  const shown = relation ?? (mounted ? lastRelation : null);

  const key = shown ? `${shown.sourceId}|${shown.target}|${shown.targetKey ?? ''}` : null;
  const geometry = useCanvasGeometry<RelationGeometry>(containerRef, key, (container) => {
    if (!shown) return null;
    const source = document.getElementById(shown.sourceId);
    const card = document.getElementById(`card-${shown.target}`);
    const row = shown.targetKey ? findEntityRow(shown.target, shown.targetKey) : null;
    const target = row ?? card;
    if (!source || !target || !container.contains(source) || !container.contains(target)) {
      return null;
    }
    // An FK pointing into its own card has nowhere to go.
    if (target.contains(source)) return null;
    const box = boxIn(container, target);
    return {
      geometry: {
        curve: relationCurve(boxIn(container, source), box, container.clientWidth),
        target: box,
        targetRadius: cornerRadius(target),
      },
      elements: card && card !== target ? [source, target, card] : [source, target],
    };
  });

  if (!mounted || !key || !geometry) return null;
  const { curve, target, targetRadius } = geometry;
  return (
    <svg
      data-canvas-overlay="relation"
      data-state={state}
      aria-hidden="true"
      focusable="false"
      className="relation-overlay"
    >
      {/* Keyed by relation, so moving to another FK link draws a fresh line. */}
      <g key={key}>
        <rect
          className="relation-target-ring"
          x={target.x - RING_GAP}
          y={target.y - RING_GAP}
          width={target.w + 2 * RING_GAP}
          height={target.h + 2 * RING_GAP}
          rx={targetRadius + RING_GAP}
        />
        <path className="relation-halo" d={curve.d} />
        <path className="relation-line" d={curve.d} pathLength={1} />
        <circle className="relation-end" cx={curve.start.x} cy={curve.start.y} r={3.5} />
        <circle
          className="relation-end relation-end--target"
          cx={curve.end.x}
          cy={curve.end.y}
          r={3.5}
        />
      </g>
    </svg>
  );
}
