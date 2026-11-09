/**
 * MapOrgList.tsx – Collapsible glass list of organizations grouped by
 * parent_organization (Verbund): a floating sidebar on wide screens, a bottom
 * sheet below 1024px. It mirrors the map both ways: rows select with the same
 * identifier the pins emit, hovering a row highlights its pin (and the pin's
 * hover highlights the row), and a selection made on the map expands its
 * group and scrolls the row into view (scrollIntoViewSafe, so Reduce Motion
 * jumps). It slides in and out with the sheet motion (usePresence).
 * Rows are memoized and read hover from the shared hover store, so hovering
 * re-renders only the row whose highlight changes.
 * Dependencies: react, network.api types, i18n.store, lib/statusColors,
 * lib/peerEdges, lib/motion, usePresence, useScrollEdges, hoverStore,
 * ui/Icon, map.css.
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useScrollEdges } from '../../hooks/useScrollEdges';
import { usePresence } from '../../hooks/usePresence';
import type { MapOrganization } from '../../api/network.api';
import { useI18n } from '../../stores/i18n.store';
import { certStatusColor } from '../../lib/statusColors';
import { verbundColor } from '../../lib/peerEdges';
import { exitMs, scrollIntoViewSafe } from '../../lib/motion';
import { Icon } from '../ui/Icon';
import { useIsHovered, type HoverStore } from './hoverStore';

interface Props {
  organizations: MapOrganization[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Hover shared with the map; rows highlight while their site is hovered. */
  hover?: HoverStore;
  onHover?: (id: string | null) => void;
  /** Collapsed lists unmount after their exit animation. */
  open?: boolean;
  onClose?: () => void;
  /** Floating sidebar (wide) or bottom sheet (narrow). */
  variant?: 'sidebar' | 'sheet';
  id?: string;
}

interface Group {
  parent: string;
  members: MapOrganization[];
}

const NONE_KEY = '__none__';
const EXIT_MS = exitMs('long');

function groupByParent(orgs: MapOrganization[]): Group[] {
  const buckets = new Map<string, MapOrganization[]>();
  for (const o of orgs) {
    const parents = (o.memberships ?? []).map((m) => m.parent_organization);
    if (parents.length === 0) {
      const list = buckets.get(NONE_KEY) ?? [];
      list.push(o);
      buckets.set(NONE_KEY, list);
      continue;
    }
    for (const p of parents) {
      const list = buckets.get(p) ?? [];
      if (!list.find((m) => m.identifier === o.identifier)) list.push(o);
      buckets.set(p, list);
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === NONE_KEY) return 1;
      if (b === NONE_KEY) return -1;
      return a.localeCompare(b);
    })
    .map(([parent, members]) => ({
      parent,
      members: members.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

const VARIANT_CLASS = {
  sidebar: { box: 'left-3 top-3 bottom-3 w-[272px]', edge: 'left' },
  sheet: { box: 'inset-x-3 bottom-3 max-h-[60%]', edge: 'bottom' },
} as const;

export function MapOrgList({
  organizations,
  selectedId,
  onSelect,
  hover,
  onHover,
  open = true,
  onClose,
  variant = 'sidebar',
  id,
}: Props) {
  const { t } = useI18n();
  const { mounted, state } = usePresence(open, EXIT_MS);
  const groups = useMemo(() => groupByParent(organizations), [organizations]);
  const scrollEdgesRef = useScrollEdges<HTMLDivElement>();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(parent: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  }

  // Map → list: open the selected organization's groups, then bring its row
  // into view.
  useEffect(() => {
    if (!selectedId) return;
    const org = organizations.find((o) => o.identifier === selectedId);
    if (!org) return;
    const parents = org.memberships.map((m) => m.parent_organization);
    setCollapsed((prev) => {
      if (!parents.some((p) => prev.has(p))) return prev;
      const next = new Set(prev);
      for (const p of parents) next.delete(p);
      return next;
    });
    const raf = requestAnimationFrame(() => {
      const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-org-row]');
      const row = rows && Array.from(rows).find((r) => r.dataset.orgRow === selectedId);
      scrollIntoViewSafe(row, { block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId, organizations]);

  if (!mounted) return null;

  let rowIndex = 0;
  return (
    <aside
      id={id}
      aria-label={t('mapOrgListTitle')}
      data-state={state}
      className={`glass absolute z-[3] flex flex-col overflow-hidden rounded-card data-[state=closed]:pointer-events-none ${VARIANT_CLASS[variant].box} map-animate-sheet-${state === 'open' ? 'in' : 'out'}-${VARIANT_CLASS[variant].edge}`}
    >
      <div className="flex items-start gap-2 border-b border-[color:var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-semibold text-[color:var(--text-primary)]">
            {t('mapOrgListTitle')}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-[color:var(--text-secondary)]">
            {t('mapOrgListCount', { n: organizations.length, v: groups.length })}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('mapHideList')}
            className="press-effect -mr-1.5 flex h-8 w-8 items-center justify-center rounded-control text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
          >
            <Icon name={variant === 'sheet' ? 'close' : 'left_panel_close'} size={18} />
          </button>
        )}
      </div>
      <div
        ref={(el) => {
          listRef.current = el;
          scrollEdgesRef(el);
        }}
        className="scroll-edges min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.parent);
          const labelText = g.parent === NONE_KEY ? t('mapOrgNoVerbund') : g.parent;
          return (
            <div key={g.parent} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(g.parent)}
                aria-expanded={!isCollapsed}
                className="press-effect flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      g.parent === NONE_KEY ? 'var(--text-muted)' : verbundColor(g.parent),
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  {labelText}
                </span>
                <span className="text-2xs tabular-nums text-[color:var(--text-muted)]">
                  {g.members.length}
                </span>
                <Icon
                  name="expand_more"
                  size={14}
                  className={`text-[color:var(--text-muted)] transition-transform duration-short ease-spring ${isCollapsed ? '-rotate-90' : ''}`}
                />
              </button>
              {!isCollapsed &&
                g.members.map((m) => (
                  <OrgRow
                    key={m.identifier}
                    org={m}
                    index={rowIndex++}
                    isSelected={selectedId === m.identifier}
                    hover={hover}
                    onSelect={onSelect}
                    onHover={onHover}
                  />
                ))}
            </div>
          );
        })}
        {groups.length === 0 && (
          <p className="m-0 p-4 text-center text-sm text-[color:var(--text-secondary)]">
            {t('mapOrgListEmpty')}
          </p>
        )}
      </div>
    </aside>
  );
}

const OrgRow = memo(function OrgRow({
  org: m,
  index,
  isSelected: isSel,
  hover,
  onSelect,
  onHover,
}: {
  org: MapOrganization;
  index: number;
  isSelected: boolean;
  hover?: HoverStore;
  onSelect: (id: string | null) => void;
  onHover?: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const isHover = useIsHovered(hover, m.identifier);
  return (
    <button
      type="button"
      data-org-row={m.identifier}
      aria-current={isSel ? 'true' : undefined}
      onClick={() => onSelect(m.identifier)}
      onMouseEnter={() => onHover?.(m.identifier)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(m.identifier)}
      onBlur={() => onHover?.(null)}
      title={m.identifier}
      style={{ '--stagger-index': index } as CSSProperties}
      className={`map-list-row flex w-full animate-list-item-in items-center gap-2.5 rounded-control py-1.5 pl-6 pr-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
        isSel
          ? 'bg-[color:color-mix(in_srgb,var(--primary)_12%,transparent)] font-semibold text-[color:var(--text-primary)]'
          : isHover
            ? 'bg-[color:var(--bg-hover)] text-[color:var(--text-primary)]'
            : 'text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]'
      }`}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: certStatusColor(m.cert_status) }}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
      {!m.active && (
        <span className="text-2xs uppercase text-[color:var(--text-muted)]">
          {t('mapOrgInactive')}
        </span>
      )}
    </button>
  );
});
