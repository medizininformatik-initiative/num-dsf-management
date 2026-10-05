/**
 * GeoMapPin.tsx – Single-organization marker: a glass disc with a soft shadow
 * and a status ring in the certificate tone (dashed when inactive), initials
 * inside. Hover and keyboard focus lift it on a short spring; selected, it
 * grows, fills with the status tone and gains a halo. The marker keeps its
 * on-screen size at every zoom (counter-scaled by 1/zoom). It enters with a
 * staggered spring (or flies out of its cluster when `offset` is set) and,
 * while `leaving`, plays its exit and ignores input.
 * Dependencies: network.api types, lib/statusColors, i18n.store, map.css.
 */
import type { CSSProperties } from 'react';
import type { MapOrganization } from '../../api/network.api';
import { certStatusColor } from '../../lib/statusColors';
import { useI18n } from '../../stores/i18n.store';
import { CERT_STATUS_LABEL_KEY } from './mapLabels';
import { PIN_SHADOW_GRADIENT_ID, initialsOf } from './mapGeometry';

interface Props {
  org: MapOrganization;
  x: number;
  y: number;
  /** Current map zoom; the marker is counter-scaled to keep its size. */
  k?: number;
  isHovered: boolean;
  isSelected: boolean;
  isUnknown: boolean; // true when city falls back to the "Other" zone
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Entrance stagger position (0 = no delay). */
  staggerIndex?: number;
  /** Screen-pixel offset from (x, y) when fanned out of a cluster. */
  offset?: [number, number];
  leaving?: boolean;
  /** Smaller disc for fanned-out cluster members. */
  compact?: boolean;
}

export function GeoMapPin({
  org,
  x,
  y,
  k = 1,
  isHovered,
  isSelected,
  isUnknown,
  onSelect,
  onHover,
  staggerIndex = 0,
  offset,
  leaving = false,
  compact = false,
}: Props) {
  const { t } = useI18n();
  const color = certStatusColor(org.cert_status);
  const isInactive = !org.active;
  const r = compact ? 11 : 13;
  const status = t(CERT_STATUS_LABEL_KEY[org.cert_status]);
  const name = org.name || org.identifier;
  const label = isInactive
    ? t('mapNodeLabelInactive', { name, status })
    : t('mapNodeLabel', { name, status });
  const [dx, dy] = offset ?? [0, 0];
  const motionClass = offset
    ? leaving
      ? 'map-animate-fan-out'
      : 'map-animate-fan-in'
    : leaving
      ? 'map-animate-node-out'
      : 'map-animate-node-in';
  const motionStyle = {
    '--stagger-index': staggerIndex,
    '--dx': `${dx}px`,
    '--dy': `${dy}px`,
  } as CSSProperties;

  return (
    <g
      className="map-marker"
      data-map-node={leaving ? undefined : org.identifier}
      data-leaving={leaving || undefined}
      role={leaving ? undefined : 'button'}
      tabIndex={leaving ? undefined : 0}
      aria-hidden={leaving || undefined}
      aria-label={leaving ? undefined : label}
      aria-current={isSelected && !leaving ? 'true' : undefined}
      transform={`translate(${x} ${y})`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(org.identifier);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(org.identifier);
        }
      }}
      onMouseEnter={() => onHover(org.identifier)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(org.identifier)}
      onBlur={() => onHover(null)}
    >
      <g className="map-counter-scale" style={{ transform: `scale(${1 / k})` }}>
        <g className={motionClass} style={motionStyle}>
          <g transform={offset ? `translate(${dx} ${dy})` : undefined}>
            <g
              className="map-marker-body"
              data-hovered={isHovered || undefined}
              data-selected={isSelected || undefined}
            >
              <circle r={r + 7} className="map-halo" style={{ fill: color }} aria-hidden="true" />
              <ellipse
                cy={r * 0.45}
                rx={r + 4}
                ry={r + 2}
                fill={`url(#${PIN_SHADOW_GRADIENT_ID})`}
                aria-hidden="true"
              />
              <circle
                r={r}
                className="map-pin-fill"
                style={isSelected ? { fill: color } : undefined}
              />
              <circle
                r={r - 1}
                fill="none"
                style={{ stroke: color }}
                strokeWidth={2.25}
                strokeDasharray={isInactive ? '3 2.5' : undefined}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                className="map-pin-label"
                data-inactive={isInactive || undefined}
              >
                {initialsOf(org)}
              </text>
              {isUnknown && (
                <g transform={`translate(${r - 1} ${-r + 1})`} aria-hidden="true">
                  <circle
                    r={7}
                    className="map-pin-fill"
                    style={{ stroke: 'var(--border-strong)' }}
                  />
                  <text textAnchor="middle" dominantBaseline="central" className="map-pin-label">
                    ?
                  </text>
                </g>
              )}
              <circle r={r + 4} className="map-focus-ring" aria-hidden="true" />
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}
