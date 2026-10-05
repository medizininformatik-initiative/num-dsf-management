/**
 * GermanyOutline.tsx – Inlined Germany silhouette (16 federal-state paths)
 * drawn as a calm base map: soft land on a faint drop shadow, a coastline
 * hairline and very faint state borders. The 16 paths live once in <defs>
 * and are reused for three layers: (1) land stroked with the coast hairline,
 * (2) land fill covering the inner halves of that stroke, so only the outer
 * edge keeps it, (3) the state borders. Strokes keep their on-screen width at
 * every zoom. Colours come from the .map-root tokens in map.css (light/dark).
 * Dependencies: germanyPaths, map.css.
 */
import React, { useId } from 'react';
import { GERMANY_PATHS } from './germanyPaths';

export const GermanyOutline = React.memo(function GermanyOutline() {
  const prefix = `de${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const ref = (i: number) => `#${prefix}-${i}`;
  const shadowId = `${prefix}-shadow`;
  return (
    <g style={{ pointerEvents: 'none' }} aria-hidden="true">
      <defs>
        <filter id={shadowId} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow
            dx="0"
            dy="6"
            stdDeviation="10"
            style={{ floodColor: 'var(--map-land-shadow)' }}
          />
        </filter>
        {GERMANY_PATHS.map((p, i) => (
          <path
            key={p.id}
            id={`${prefix}-${i}`}
            d={p.d}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </defs>
      <g className="map-coast" filter={`url(#${shadowId})`}>
        {GERMANY_PATHS.map((p, i) => (
          <use key={p.id} href={ref(i)} />
        ))}
      </g>
      <g className="map-land">
        {GERMANY_PATHS.map((p, i) => (
          <use key={p.id} href={ref(i)} />
        ))}
      </g>
      <g className="map-state-borders">
        {GERMANY_PATHS.map((p, i) => (
          <use key={p.id} href={ref(i)} />
        ))}
      </g>
    </g>
  );
});
