/**
 * EntityCanvas.tsx – the entity graph page: the onboarding wizard on top,
 * then the five entity cards in one CSS grid whose columns follow the
 * canvas's own width (see entity-canvas.css), so cards never remount when
 * the layout changes. Cards enter with a short stagger (--stagger-index;
 * static under Reduce Motion). The canvas is the scroll container and hosts
 * the overlays: the ring on the target of an FK jump and the relation line of
 * the FK link under the pointer or keyboard focus.
 * Dependencies: OnboardingWizard, HighlightRing, RelationOverlay, the entity
 * cards, entity-canvas.css.
 */
import { useRef, type ComponentType, type CSSProperties } from 'react';
import { OnboardingWizard } from './OnboardingWizard';
import { HighlightRing } from './HighlightRing';
import { RelationOverlay } from './RelationOverlay';
import { OrganizationCard } from '../cards/OrganizationCard';
import { ContactsCard } from '../cards/ContactsCard';
import { EndpointsCard } from '../cards/EndpointsCard';
import { CertificatesCard } from '../cards/CertificatesCard';
import { MembershipsCard } from '../cards/MembershipsCard';
import './entity-canvas.css';

interface EntityCanvasProps {
  instanceId: string;
}

/** Reading and tab order; Organization leads and spans two rows. */
const CARDS: ReadonlyArray<{ id: string; Card: ComponentType<{ instanceId: string }> }> = [
  { id: 'organization', Card: OrganizationCard },
  { id: 'contacts', Card: ContactsCard },
  { id: 'endpoints', Card: EndpointsCard },
  { id: 'memberships', Card: MembershipsCard },
  { id: 'certificates', Card: CertificatesCard },
];

export function EntityCanvas({ instanceId }: EntityCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="entity-canvas relative min-h-0 flex-1 overflow-y-auto p-4">
      <OnboardingWizard instanceId={instanceId} />
      <div className="entity-canvas-grid">
        {CARDS.map(({ id, Card }, index) => (
          <div
            key={id}
            data-canvas-cell={id}
            className={`entity-canvas-cell animate-list-item-in${index === 0 ? ' entity-canvas-cell--lead' : ''}`}
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
