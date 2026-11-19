/**
 * MapPage.tsx – Interactive P2P allow-list network map (role-aware, i18n).
 * A calm full-bleed map canvas with floating glass chrome: the filter toolbar
 * on top, the organization list as a collapsible sidebar (bottom sheet below
 * 1024px), zoom controls on the map, the legend strip below it, and the details sheet. The
 * map viewport insets itself beside the open list and sheet (easing with the
 * sheets), so focusing a selection centres it in the visible area. The
 * details sheet always docks on the right (bottom below 1024px); selecting a
 * site collapses the list on wide screens and closing the sheet restores it.
 * Hover and selection are shared between list and map; hover lives in a
 * small store (hoverStore) rather than page state, so hovering never
 * re-renders the page, the list or the whole map.
 * Dependencies: useNetworkMap, GeoMap, MapOrgList, NodeDetailsPanel,
 * MapFilters, VerbundPills, mapGeometry, hoverStore, lib/germanCities, lib/peerEdges,
 * ui/Icon, ui/Button, i18n.store, map.css.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNetworkMap } from '../hooks/useNetworkMap';
import { GeoMap } from '../components/map/GeoMap';
import { MapOrgList } from '../components/map/MapOrgList';
import { NodeDetailsPanel, type SheetSide } from '../components/map/NodeDetailsPanel';
import { MapFilters, MapFilterState } from '../components/map/MapFilters';
import { MapLegend } from '../components/map/MapLegend';
import { VerbundPills } from '../components/map/VerbundPills';
import { useOwnHoverStore } from '../components/map/hoverStore';
import { clusterGroupFor, isOnMap } from '../components/map/mapGeometry';
import { Icon } from '../components/ui/Icon';
import { Button } from '../components/ui/Button';
import { useI18n } from '../stores/i18n.store';
import type { MapOrganization } from '../api/network.api';
import { deriveVerbunds, verbundCounts } from '../lib/peerEdges';
import '../components/map/map.css';

const WIDE_QUERY = '(min-width: 1024px)';
const LIST_INSET = 296; // 272px list + 12px gap on each side
const SHEET_INSET = 404; // 380px sheet + 12px gap on each side
const MIN_MAP_WIDTH = 480;

function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const q = window.matchMedia(WIDE_QUERY);
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
}
function getWide(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_QUERY).matches
    : window.innerWidth >= 1024;
}

/** Width of an element, following resizes (0 without ResizeObserver). */
function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}

const ALL_STATUSES = (): MapFilterState['certStatuses'] =>
  new Set(['VALID', 'EXPIRING', 'EXPIRED', 'NONE']);

export function MapPage() {
  const { t } = useI18n();
  const { data, isLoading, error, refetch } = useNetworkMap();
  const organizations = useMemo(() => data?.organizations ?? [], [data]);
  const isAdmin = !!data?.isAdmin;
  const wide = useSyncExternalStore(subscribeWide, getWide);
  const listId = useId();
  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const hover = useOwnHoverStore();
  const [listOpen, setListOpen] = useState(wide);
  useEffect(() => setListOpen(wide), [wide]);
  const listOpenRef = useRef(listOpen);
  listOpenRef.current = listOpen;

  const [filter, setFilter] = useState<MapFilterState>({
    query: '',
    activeMode: 'all',
    certStatuses: ALL_STATUSES(),
  });
  const [activeVerbunds, setActiveVerbunds] = useState<Set<string>>(new Set());
  const [showAllEdges, setShowAllEdges] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.query.trim().toLowerCase();
    return organizations.filter((o) => {
      if (filter.activeMode === 'active' && !o.active) return false;
      if (filter.activeMode === 'inactive' && o.active) return false;
      if (!filter.certStatuses.has(o.cert_status)) return false;
      if (
        q &&
        !(
          o.name.toLowerCase().includes(q) ||
          o.identifier.toLowerCase().includes(q) ||
          (o.city ?? '').toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [organizations, filter]);

  const verbunds = useMemo(() => deriveVerbunds(filtered), [filtered]);
  const counts = useMemo(() => verbundCounts(filtered), [filtered]);

  const cityCount = useMemo(() => {
    const set = new Set<string>();
    for (const o of filtered) {
      if (!isOnMap(o)) continue;
      set.add(`${(o.city ?? '__unknown__').toLowerCase().trim()}|${o.country_code ?? 'DE'}`);
    }
    return set.size;
  }, [filtered]);

  function toggleVerbund(parent: string) {
    setActiveVerbunds((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  }

  const resetFilters = useCallback(() => {
    setFilter({ query: '', activeMode: 'all', certStatuses: ALL_STATUSES() });
  }, []);
  const closeDetails = useCallback(() => setSelectedId(null), []);

  const selectedOrg = organizations.find((o) => o.identifier === selectedId) ?? null;
  const selectedCluster = useMemo(
    () => clusterGroupFor(selectedId, organizations),
    [selectedId, organizations],
  );
  const isPanelOpen = !!selectedOrg || !!selectedCluster;

  // On wide screens the sheet takes the list's room: collapse the list while a
  // site is selected and restore its previous state when the sheet closes.
  const panelWasOpen = useRef(false);
  const listBeforePanel = useRef<boolean | null>(null);
  useEffect(() => {
    if (wide && isPanelOpen && !panelWasOpen.current) {
      listBeforePanel.current = listOpenRef.current;
      setListOpen(false);
    } else if (!isPanelOpen && panelWasOpen.current && listBeforePanel.current !== null) {
      setListOpen(listBeforePanel.current);
    }
    if (!isPanelOpen) listBeforePanel.current = null;
    panelWasOpen.current = isPanelOpen;
  }, [isPanelOpen, wide]);

  // The sheet always docks on the right on wide screens, at the bottom below.
  const sheetSide: SheetSide = wide ? 'right' : 'bottom';

  // Inset the map beside the open list / sheet, as long as enough map remains.
  const listInset = wide && listOpen ? LIST_INSET : 0;
  const sheetFits = rootWidth - listInset - SHEET_INSET >= MIN_MAP_WIDTH;
  const sheetInset = wide && isPanelOpen && sheetFits ? SHEET_INSET : 0;
  // Where the sheet floats over the map instead, focus a selection beside it.
  const focusShiftPx = wide && isPanelOpen && !sheetFits ? -(SHEET_INSET / 2) : 0;
  const insetRight = sheetInset;
  // Below 1024px the sheet covers the lower half; the map keeps the upper half.
  const insetBottom = !wide && isPanelOpen ? '50%' : 0;

  const listToggle = (
    <button
      type="button"
      onClick={() => setListOpen((v) => !v)}
      aria-expanded={listOpen}
      aria-controls={listId}
      aria-label={t(listOpen ? 'mapHideList' : 'mapShowList')}
      className={`press-effect flex h-9 w-9 shrink-0 items-center justify-center rounded-control border transition-colors duration-short ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
        listOpen
          ? 'border-[color:var(--primary)] bg-[color:color-mix(in_srgb,var(--primary)_12%,transparent)] text-[color:var(--text-primary)]'
          : 'border-[color:var(--border)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)]'
      }`}
    >
      <Icon name="format_list_bulleted" size={18} />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="map-root map-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <MapOrgList
        id={listId}
        organizations={filtered}
        selectedId={selectedId}
        onSelect={setSelectedId}
        hover={hover}
        onHover={hover.set}
        open={listOpen}
        onClose={() => setListOpen(false)}
        variant={wide ? 'sidebar' : 'sheet'}
      />

      <div
        className="map-viewport absolute top-0 flex flex-col"
        style={{ left: listInset, right: insetRight, bottom: insetBottom }}
      >
        <div className="relative z-[2] flex shrink-0 flex-col gap-2 p-3 pb-0">
          <MapFilters
            state={filter}
            onChange={setFilter}
            totalCount={organizations.length}
            visibleCount={filtered.length}
            cityCount={cityCount}
            showAllEdges={showAllEdges}
            onToggleShowAllEdges={() => setShowAllEdges((v) => !v)}
            leading={listToggle}
            verbundPills={
              <VerbundPills counts={counts} active={activeVerbunds} onToggle={toggleVerbund} />
            }
          />
          <InternationalStrip
            orgs={organizations}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        <div className="relative min-h-0 flex-1">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                role="status"
                className="glass flex animate-fade-in items-center gap-2.5 rounded-full px-4 py-2 text-sm text-[color:var(--text-secondary)]"
              >
                <Icon name="progress_activity" size={16} className="animate-spin" />
                {t('mapLoadingNetwork')}
              </div>
            </div>
          )}
          {!!error && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="glass flex max-w-sm animate-scale-in flex-col items-center gap-3 rounded-card p-5 text-center">
                <Icon name="cloud_off" size={40} className="text-danger-fg" />
                <p role="alert" className="m-0 text-sm text-[color:var(--text-primary)]">
                  {t('mapLoadFailed')}
                </p>
                <Button variant="secondary" size="sm" onClick={() => void refetch?.()}>
                  {t('mapRetry')}
                </Button>
              </div>
            </div>
          )}
          {!isLoading && !error && (
            <GeoMap
              organizations={filtered}
              allOrganizations={organizations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              hover={hover}
              verbunds={verbunds}
              activeVerbunds={activeVerbunds}
              showAllEdges={showAllEdges}
              onResetFilters={resetFilters}
              focusShiftPx={focusShiftPx}
            />
          )}
        </div>
        <MapLegend />
      </div>

      <NodeDetailsPanel
        org={selectedOrg}
        cluster={selectedOrg ? null : selectedCluster}
        isAdmin={isAdmin}
        side={sheetSide}
        onClose={closeDetails}
        onSelectMember={setSelectedId}
      />
    </div>
  );
}

function InternationalStrip({
  orgs,
  selectedId,
  onSelect,
}: {
  orgs: MapOrganization[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const intl = orgs.filter((o) => !isOnMap(o));
  if (intl.length === 0) return null;
  const countries = [...new Set(intl.map((o) => o.country_code ?? '?'))].sort().join(', ');
  return (
    <div className="glass flex flex-wrap items-center gap-2 self-start rounded-control px-3 py-1.5 text-xs text-[color:var(--text-secondary)]">
      <Icon name="public" size={14} className="text-[color:var(--text-muted)]" />
      <span className="font-semibold">
        {t('mapInternationalCount', { n: intl.length, countries })}
      </span>
      {intl.map((o) => (
        <button
          key={o.identifier}
          type="button"
          onClick={() => onSelect(o.identifier)}
          aria-current={selectedId === o.identifier ? 'true' : undefined}
          className={`press-effect rounded-control border px-2 py-0.5 text-xs transition-colors duration-short focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
            selectedId === o.identifier
              ? 'border-[color:var(--primary)] text-[color:var(--text-primary)]'
              : 'border-[color:var(--border)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)]'
          }`}
        >
          {o.country_code} · {o.name}
        </button>
      ))}
    </div>
  );
}
