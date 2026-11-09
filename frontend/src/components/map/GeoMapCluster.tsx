/**
 * GeoMapCluster.tsx – Soft count bubble for ≥2 sites sharing a city. A glass
 * disc shows the site count ("visible/total" when filters hide some); its
 * ring is split into arcs in the certificate tones of the members, so the
 * status mix reads at a glance. Selecting it expands the city: the bubble
 * shrinks to a hub while GeoMap fans the members out around it. Like pins it
 * keeps its on-screen size at every zoom and enters/leaves with a spring.
 * Dependencies: network.api types, lib/statusColors, mapGeometry, mapLabels,
 * i18n.store, map.css.
 */
import type { CSSProperties } from 'react';
import type { MapClusterGroup, MapOrganization } from '../../api/network.api';
import { certStatusColor } from '../../lib/statusColors';
import { useI18n } from '../../stores/i18n.store';
import { PIN_SHADOW_GRADIENT_ID, clusterKeyOf } from './mapGeometry';
import { CERT_STATUSES } from './mapLabels';

interface Props {
  group: MapClusterGroup;
  x: number;
  y: number;
  isHovered: boolean;
  isSelected: boolean;
  /** True while the members are fanned out around the hub. */
  expanded?: boolean;
  matchedCount: number; // members passing the filters
  /** Sites in this city without filters; defaults to group.members.length. */
  totalCount?: number;
  onSelect: (clusterKey: string) => void;
  onHover: (clusterKey: string | null) => void;
  staggerIndex?: number;
  leaving?: boolean;
}

interface Arc {
  status: MapOrganization['cert_status'];
  length: number;
  offset: number;
}

/** Ring arcs (in circumference units) per certificate status, with gaps. */
function statusArcs(members: MapOrganization[], circumference: number): Arc[] {
  const counts = CERT_STATUSES.map((s) => members.filter((m) => m.cert_status === s).length);
  const present = counts.filter((c) => c > 0).length;
  const gap = present > 1 ? 3 : 0;
  const n = members.length || 1;
  const arcs: Arc[] = [];
  let offset = 0;
  CERT_STATUSES.forEach((status, i) => {
    if (counts[i] === 0) return;
    const share = (counts[i] / n) * circumference;
    arcs.push({ status, length: Math.max(share - gap, 1), offset });
    offset += share;
  });
  return arcs;
}

export function GeoMapCluster({
  group,
  x,
  y,
  isHovered,
  isSelected,
  expanded = false,
  matchedCount,
  totalCount,
  onSelect,
  onHover,
  staggerIndex = 0,
  leaving = false,
}: Props) {
  const { t } = useI18n();
  const key = clusterKeyOf(group);
  const total = totalCount ?? group.members.length;
  const visible = matchedCount;
  const countText = visible < total ? `${visible}/${total}` : `${total}`;
  const r = Math.min(24, 17 + Math.log2(Math.max(total, 2)) * 1.5);
  const ringR = r - 1.5;
  const circumference = 2 * Math.PI * ringR;
  const arcs = statusArcs(group.members, circumference);
  const city = group.city ?? '?';

  return (
    <g
      className="map-marker"
      data-map-node={leaving ? undefined : key}
      data-leaving={leaving || undefined}
      role={leaving ? undefined : 'button'}
      tabIndex={leaving ? undefined : 0}
      aria-hidden={leaving || undefined}
      aria-label={leaving ? undefined : t('mapClusterLabel', { city, n: total })}
      aria-expanded={leaving ? undefined : expanded}
      transform={`translate(${x} ${y})`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(key);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(key);
        }
      }}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
    >
      <g className="map-counter-scale">
        <g
          className={leaving ? 'map-animate-node-out' : 'map-animate-node-in'}
          style={{ '--stagger-index': staggerIndex } as CSSProperties}
        >
          <g
            className="map-marker-body"
            data-hovered={isHovered || undefined}
            data-selected={(isSelected && !expanded) || undefined}
            style={expanded ? { transform: 'scale(0.7)' } : undefined}
          >
            <circle
              r={r + 7}
              className="map-halo"
              style={{ fill: certStatusColor(group.worstStatus) }}
              aria-hidden="true"
            />
            <ellipse
              cy={r * 0.45}
              rx={r + 5}
              ry={r + 3}
              fill={`url(#${PIN_SHADOW_GRADIENT_ID})`}
              aria-hidden="true"
            />
            <circle r={r} className="map-cluster-fill" />
            <g transform="rotate(-90)" aria-hidden="true">
              {arcs.map((a) => (
                <circle
                  key={a.status}
                  r={ringR}
                  fill="none"
                  style={{ stroke: certStatusColor(a.status) }}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeDasharray={`${a.length} ${circumference - a.length}`}
                  strokeDashoffset={-a.offset}
                />
              ))}
            </g>
            <text
              textAnchor="middle"
              dominantBaseline="central"
              className="map-pin-label"
              style={{
                fontSize: countText.length > 3 ? '11px' : '13px',
                // The fanned-out members take over; the shrunken hub drops its
                // count rather than rendering it below the 11px minimum.
                opacity: expanded ? 0 : 1,
                transition: 'opacity var(--duration-short) var(--ease-standard)',
              }}
            >
              {countText}
            </text>
            <circle r={r + 4} className="map-focus-ring" aria-hidden="true" />
          </g>
        </g>
      </g>
    </g>
  );
}
