/**
 * MapTooltip.tsx – The label bubble above the hovered, focused or selected
 * map node: organization name and city (or city and site count for a
 * cluster). Drawn in SVG inside the zoom layer, counter-scaled so it keeps
 * its size, on the near-opaque glass tokens of map.css. Decorative for
 * assistive technology: the node's own accessible name carries the text.
 * Dependencies: network.api types, mapGeometry types, i18n.store, map.css.
 */
import type { MapOrganization } from '../../api/network.api';
import type { Placed } from './mapGeometry';
import { useI18n } from '../../stores/i18n.store';

interface FanNode {
  org: MapOrganization;
  x: number;
  y: number;
  offset: [number, number];
}

interface Props {
  node: Placed | FanNode;
}

const CHAR_WIDTH = 6.6; // ≈ average glyph width of 12px Inter semibold
const MAX_CHARS = 40;

function clip(s: string): string {
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1)}…` : s;
}

export function MapTooltip({ node }: Props) {
  const { t } = useI18n();
  let title: string;
  let subtitle: string;
  if ('kind' in node && node.kind === 'cluster') {
    title = node.group.city ?? '?';
    subtitle = t('mapClusterCity', { n: node.totalMembers, city: node.group.city ?? '?' });
  } else {
    const org = node.org;
    title = org.name || org.identifier;
    subtitle =
      'kind' in node && !node.known
        ? t('mapCityUnknown')
        : `${org.city ?? '—'}${org.country_code ? ` · ${org.country_code}` : ''}`;
  }
  title = clip(title);
  subtitle = clip(subtitle);
  const [dx, dy] = 'offset' in node ? node.offset : [0, 0];
  const width = Math.min(
    280,
    Math.max(120, Math.max(title.length, subtitle.length * 0.92) * CHAR_WIDTH + 24),
  );
  const height = 40;
  const lift = 'offset' in node ? 24 : 30;

  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <g className="map-counter-scale">
        <g transform={`translate(${dx} ${dy - lift - height})`} className="animate-fade-in">
          <rect
            x={-width / 2}
            width={width}
            height={height}
            rx={12}
            style={{ fill: 'var(--map-tooltip-fill)', stroke: 'var(--map-tooltip-stroke)' }}
          />
          <text
            y={16}
            textAnchor="middle"
            style={{ fill: 'var(--text-primary)', fontSize: '12px', fontWeight: 600 }}
          >
            {title}
          </text>
          <text
            y={31}
            textAnchor="middle"
            style={{ fill: 'var(--text-secondary)', fontSize: '11px' }}
          >
            {subtitle}
          </text>
        </g>
      </g>
    </g>
  );
}
