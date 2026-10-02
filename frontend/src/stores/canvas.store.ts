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

/** How long a highlight stays before it clears itself. */
export const HIGHLIGHT_MS = 1800;

interface CanvasState {
  activeInstanceId: string | null;
  highlightedEntity: EntityId | null;
  /** Row key inside the highlighted card, if the highlight targets one row. */
  highlightedKey: string | null;
  /** Counts highlights, so highlighting the same target again replays its pulse. */
  highlightSeq: number;
  activeRelation: ActiveRelation | null;
  setActiveInstance: (id: string | null) => void;
  highlightEntity: (id: EntityId | null, key?: string) => void;
  setActiveRelation: (relation: ActiveRelation | null) => void;
  /** Clears the active relation only if it still belongs to this source. */
  clearActiveRelation: (sourceId: string) => void;
}

// Tracks the pending auto-clear timer so a new highlight cancels the previous
// one — otherwise an earlier timer fires and clears the newer highlight early.
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

export const useCanvasStore = create<CanvasState>((set) => ({
  activeInstanceId: null,
  highlightedEntity: null,
  highlightedKey: null,
  highlightSeq: 0,
  activeRelation: null,
  setActiveInstance: (id) => set({ activeInstanceId: id }),
  highlightEntity: (id, key) => {
    if (highlightTimer) clearTimeout(highlightTimer);
    set((s) => ({
      highlightedEntity: id,
      highlightedKey: id ? (key ?? null) : null,
      highlightSeq: id ? s.highlightSeq + 1 : s.highlightSeq,
    }));
    if (id) {
      highlightTimer = setTimeout(
        () => set({ highlightedEntity: null, highlightedKey: null }),
        HIGHLIGHT_MS,
      );
    }
  },
  setActiveRelation: (relation) => set({ activeRelation: relation }),
  clearActiveRelation: (sourceId) =>
    set((s) => (s.activeRelation?.sourceId === sourceId ? { activeRelation: null } : s)),
}));

/** The row element for a key in an entity card, or null when it is not rendered. */
export function findEntityRow(entity: EntityId, key: string): HTMLElement | null {
  const wanted = `${entity}:${key}`;
  const rows = document.querySelectorAll<HTMLElement>('[data-entity-row]');
  return Array.from(rows).find((el) => el.dataset.entityRow === wanted) ?? null;
}
