/**
 * canvas.store.ts – UI state for the Entity Graph Canvas
 *
 * Row convention: a card row that a foreign key can point at carries
 * `data-entity-row="<entity>:<key>"` (e.g. `endpoints:fhir.ukm.de`), so a
 * highlight or a relation line can target the row instead of the whole card.
 */
import { create } from 'zustand';

export type EntityId =
  | 'organization'
  | 'contacts'
  | 'endpoints'
  | 'certificates'
  | 'memberships'
  | 'approval';

/** A foreign-key value under the pointer or keyboard focus, drawn as a relation line. */
export interface ActiveRelation {
  /** DOM id of the FK source element. */
  sourceId: string;
  target: EntityId;
  /** Row key inside the target card (see the row convention above), if any. */
  targetKey?: string;
}

interface CanvasState {
  activeInstanceId: string | null;
  highlightedEntity: EntityId | null;
  /** Row key inside the highlighted card, if the highlight targets one row. */
  highlightedKey: string | null;
  activeRelation: ActiveRelation | null;
  setActiveInstance: (id: string | null) => void;
  highlightEntity: (id: EntityId | null, key?: string) => void;
  setActiveRelation: (relation: ActiveRelation | null) => void;
}

// Tracks the pending auto-clear timer so a new highlight cancels the previous
// one — otherwise an earlier timer fires and clears the newer highlight early.
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

export const useCanvasStore = create<CanvasState>((set) => ({
  activeInstanceId: null,
  highlightedEntity: null,
  highlightedKey: null,
  activeRelation: null,
  setActiveInstance: (id) => set({ activeInstanceId: id }),
  highlightEntity: (id, key) => {
    if (highlightTimer) clearTimeout(highlightTimer);
    set({ highlightedEntity: id, highlightedKey: id ? (key ?? null) : null });
    if (id) {
      highlightTimer = setTimeout(
        () => set({ highlightedEntity: null, highlightedKey: null }),
        1800,
      );
    }
  },
  setActiveRelation: (relation) => set({ activeRelation: relation }),
}));

/** The row element for a key in an entity card, or null when it is not rendered. */
export function findEntityRow(entity: EntityId, key: string): HTMLElement | null {
  const wanted = `${entity}:${key}`;
  const rows = document.querySelectorAll<HTMLElement>('[data-entity-row]');
  return Array.from(rows).find((el) => el.dataset.entityRow === wanted) ?? null;
}
