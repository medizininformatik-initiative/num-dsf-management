/**
 * MapOrgList.tsx – Left-rail list of organizations grouped by parent_organization
 * (verbund). Mirrors map-pin selection: clicking a row calls onSelect with the
 * org identifier, the same value the GeoMap pins emit.
 */
import { useMemo, useState } from 'react';
import { useScrollEdges } from '../../hooks/useScrollEdges';
import type { MapOrganization } from '../../api/network.api';
import { useI18n } from '../../stores/i18n.store';
import { STATUS_COLOR } from '../../lib/statusColors';

interface Props {
  organizations: MapOrganization[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function verbundColor(parent: string): string {
  const p = parent.toLowerCase();
  if (p.includes('mii')) return '#b01e66';
  if (p.includes('num')) return '#4a90d9';
  return '#64748b';
}

interface Group {
  parent: string;
  members: MapOrganization[];
}

function groupByParent(orgs: MapOrganization[]): Group[] {
  const buckets = new Map<string, MapOrganization[]>();
  const NONE_KEY = '__none__';
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

export function MapOrgList({ organizations, selectedId, onSelect }: Props) {
  const { t } = useI18n();
  const groups = useMemo(() => groupByParent(organizations), [organizations]);
  const scrollEdgesRef = useScrollEdges<HTMLElement>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(parent: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  }

  return (
    <aside
      ref={scrollEdgesRef}
      className="glass-thin scroll-edges rounded-none border-y-0 border-l-0"
      style={{
        width: '260px',
        flexShrink: 0,
        overflowY: 'auto',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <p
          style={{
            margin: 0,
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {t('mapOrgListTitle')}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
          {t('mapOrgListCount', { n: organizations.length, v: groups.length })}
        </p>
      </div>
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.parent);
        const labelText = g.parent === '__none__' ? t('mapOrgNoVerbund') : g.parent;
        return (
          <div key={g.parent}>
            <button
              onClick={() => toggle(g.parent)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                border: 'none',
                background: 'color-mix(in srgb, var(--bg-hover) 70%, transparent)',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: verbundColor(g.parent),
                  flexShrink: 0,
                }}
              />
              <span
                style={{ flex: 1, fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}
              >
                {labelText}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {g.members.length}
              </span>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '14px', color: 'var(--text-muted)' }}
              >
                {isCollapsed ? 'expand_more' : 'expand_less'}
              </span>
            </button>
            {!isCollapsed &&
              g.members.map((m) => {
                const isSel = selectedId === m.identifier;
                return (
                  <button
                    key={m.identifier}
                    onClick={() => onSelect(m.identifier)}
                    title={m.identifier}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 16px 6px 28px',
                      border: 'none',
                      background: isSel
                        ? 'color-mix(in srgb, var(--primary) 14%, transparent)'
                        : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      borderLeft: isSel ? '3px solid var(--primary)' : '3px solid transparent',
                    }}
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: STATUS_COLOR[m.cert_status],
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: '11px',
                        color: isSel ? 'var(--primary)' : 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.name}
                    </span>
                    {!m.active && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {t('mapOrgInactive')}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        );
      })}
      {groups.length === 0 && (
        <p
          style={{
            padding: '16px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            margin: 0,
          }}
        >
          {t('mapOrgListEmpty')}
        </p>
      )}
    </aside>
  );
}
