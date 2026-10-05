/**
 * ResourceGrid.tsx — animated responsive grid of ResourceCards.
 * Choreography when the filtered list changes:
 *  - cards that stay glide from their old to their new cell (FLIP: the layout
 *    offset delta is applied as a transform, then transitioned back to none on
 *    duration-medium / ease-spring);
 *  - removed cards are kept for exitMs('medium') as absolutely positioned
 *    ghosts at their last cell and play animate-scale-out (shorter, ease-exit);
 *  - added cards play the staggered animate-list-item-in, one step after the
 *    exits start, so leaving is quicker than arriving. On first mount every
 *    card enters with the stagger.
 * Reduce Motion: no FLIP transforms are set at all, and the global stylesheet
 * turns the scale/list keyframes into plain crossfades.
 * Dependencies: react, lib/motion, lib/dsfResources, ResourceCard
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { exitMs, prefersReducedMotion } from '../../lib/motion';
import type { DsfResource } from '../../lib/dsfResources';
import { ResourceCard } from './ResourceCard';

interface Cell {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Ghost {
  resource: DsfResource;
  cell: Cell;
}

const EXIT_MS = exitMs('medium');

function cellOf(el: HTMLElement): Cell {
  return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
}

export function ResourceGrid({ resources }: { resources: DsfResource[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const cells = useRef(new Map<string, Cell>());
  const shown = useRef<Set<string> | null>(null); // null until the first commit
  const stagger = useRef(new Map<string, number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Resources of the previous commit, to rebuild ghosts of removed cards.
  const last = useRef<DsfResource[]>([]);
  const listTop = useRef(0);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);

  // Stagger index for cards appearing in this render (kept while they stay).
  const firstPass = shown.current === null;
  let next = firstPass ? 0 : 1;
  for (const r of resources) {
    if (!stagger.current.has(r.id) && !shown.current?.has(r.id)) {
      stagger.current.set(r.id, next++);
    }
  }

  useLayoutEffect(() => {
    const prev = shown.current;
    const current = new Set(resources.map((r) => r.id));
    const reduce = prefersReducedMotion();
    // The list itself may have moved (e.g. the "Start here" row above it
    // unmounted); old cells are re-based onto the list's new position.
    const list = listRef.current;
    const shift = list ? listTop.current - list.offsetTop : 0;

    if (prev) {
      const leaving: Ghost[] = [];
      for (const id of prev) {
        const cell = cells.current.get(id);
        const resource = current.has(id) ? undefined : last.current.find((r) => r.id === id);
        if (cell && resource) leaving.push({ resource, cell: { ...cell, top: cell.top + shift } });
      }
      if (leaving.length > 0) {
        const ids = new Set(leaving.map((g) => g.resource.id));
        setGhosts((g) => [...g.filter((x) => !ids.has(x.resource.id)), ...leaving]);
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          setGhosts((g) => g.filter((x) => !ids.has(x.resource.id)));
        }, EXIT_MS);
        timers.current.add(timer);
      }

      for (const r of resources) {
        const el = nodes.current.get(r.id);
        const old = cells.current.get(r.id);
        if (!el || !old || !prev.has(r.id) || reduce) continue;
        const now = cellOf(el);
        const dx = old.left - now.left;
        const dy = old.top + shift - now.top;
        if (dx === 0 && dy === 0) continue;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.offsetWidth; // commit the inverted position before playing
        el.style.transition = 'transform var(--duration-medium) var(--ease-spring)';
        el.style.transform = '';
      }
    }

    for (const id of [...stagger.current.keys()]) {
      if (!current.has(id)) stagger.current.delete(id);
    }
    for (const id of [...cells.current.keys()]) {
      if (!current.has(id)) cells.current.delete(id);
    }
    for (const [id, el] of nodes.current) cells.current.set(id, cellOf(el));
    if (list) listTop.current = list.offsetTop;
    shown.current = current;
    last.current = resources;
  }, [resources]);

  // Keep the cell cache fresh when the grid reflows (window resize, sidebar).
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      for (const [id, el] of nodes.current) cells.current.set(id, cellOf(el));
      listTop.current = list.offsetTop;
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const currentIds = new Set(resources.map((r) => r.id));

  return (
    <ul
      ref={listRef}
      role="list"
      className="relative m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3 p-0"
    >
      {resources.map((r) => (
        <li
          key={r.id}
          ref={(el) => {
            if (el) nodes.current.set(r.id, el);
            else nodes.current.delete(r.id);
          }}
          className="min-w-0"
        >
          <ResourceCard
            resource={r}
            className="animate-list-item-in"
            style={{ '--stagger-index': stagger.current.get(r.id) ?? 0 } as CSSProperties}
          />
        </li>
      ))}
      {ghosts
        .filter((g) => !currentIds.has(g.resource.id))
        .map((g) => (
          <li
            key={`ghost-${g.resource.id}`}
            aria-hidden="true"
            data-testid="resource-ghost"
            className="pointer-events-none absolute animate-scale-out"
            style={{
              left: g.cell.left,
              top: g.cell.top,
              width: g.cell.width,
              height: g.cell.height,
            }}
          >
            <ResourceCard resource={g.resource} />
          </li>
        ))}
    </ul>
  );
}
