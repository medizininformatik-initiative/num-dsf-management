/**
 * EntityCanvas.tsx – the entity graph page: the onboarding wizard on top,
 * then the five entity cards in one CSS grid whose columns follow the
 * canvas's own width (see entity-canvas.css) and whose cells are packed as a
 * masonry (masonry.ts: equal vertical gaps, DOM order kept), so cards never
 * remount when the layout changes. Cards enter with a short stagger (--stagger-index;
 * static under Reduce Motion). The canvas is the scroll container and hosts
 * the overlays: the ring on the target of an FK jump and the relation line of
 * the FK link under the pointer or keyboard focus.
 * Dependencies: OnboardingWizard, HighlightRing, RelationOverlay, the entity
 * cards, entity-canvas.css.
 */
import { useCallback, useRef, type ComponentType, type CSSProperties } from 'react';
import { OnboardingWizard } from './OnboardingWizard';
import { CanvasViewSwitch } from './CanvasViewSwitch';
import { HighlightRing } from './HighlightRing';
import { RelationOverlay } from './RelationOverlay';
import { OrganizationCard } from '../cards/OrganizationCard';
import { ContactsCard } from '../cards/ContactsCard';
import { EndpointsCard } from '../cards/EndpointsCard';
import { CertificatesCard } from '../cards/CertificatesCard';
import { MembershipsCard } from '../cards/MembershipsCard';
import { useScrollEdges } from '../../hooks/useScrollEdges';
import { useMasonryGrid } from './masonry';
import './entity-canvas.css';

interface EntityCanvasProps {
  instanceId: string;
}

/** Reading and tab order; Organization leads. */
const CARDS: ReadonlyArray<{ id: string; Card: ComponentType<{ instanceId: string }> }> = [
  { id: 'organization', Card: OrganizationCard },
  { id: 'contacts', Card: ContactsCard },
  { id: 'endpoints', Card: EndpointsCard },
  { id: 'memberships', Card: MembershipsCard },
  { id: 'certificates', Card: CertificatesCard },
];

export function EntityCanvas({ instanceId }: EntityCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useMasonryGrid(gridRef, '.entity-canvas-cell');
  const edgesRef = useScrollEdges();
  // The overlays need the element itself, the edge fades a callback ref.
  const setContainer = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      edgesRef(el);
    },
    [edgesRef],
  );

  return (
    <div
      ref={setContainer}
      className="scroll-edges entity-canvas relative min-h-0 flex-1 overflow-y-auto p-4"
    >
      <OnboardingWizard instanceId={instanceId} />
      <CanvasViewSwitch />
      <div ref={gridRef} className="entity-canvas-grid">
        {CARDS.map(({ id, Card }, index) => (
          <div
            key={id}
            data-canvas-cell={id}
            className="entity-canvas-cell animate-list-item-in"
            style={{ '--stagger-index': index } as CSSProperties}
          >
            <Card instanceId={instanceId} />
          </div>
        ))}
      </div>
      <HighlightRing containerRef={containerRef} />
      <RelationOverlay containerRef={containerRef} />
    </div>
  );
}
