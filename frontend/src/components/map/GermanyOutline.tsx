/**
 * GermanyOutline.tsx – Inlined Germany silhouette (16 federal-state paths)
 * drawn as a calm base map: soft land on a faint drop shadow, a coastline
 * hairline and very faint state borders. The 16 paths live once in <defs>
 * and are reused for three layers: (1) land stroked with the coast hairline,
 * (2) land fill covering the inner halves of that stroke, so only the outer
 * edge keeps it, (3) the state borders. Strokes keep their on-screen width at
 * every zoom. The drop shadow is a pre-rendered, blurred silhouette image
 * (germanyShadow.webp, black on transparent) whose strength comes from a
 * theme token, so no SVG filter has to be recomputed while the map moves.
 * Colours come from the .map-root tokens in map.css (light/dark).
 * Dependencies: germanyPaths, germanyShadow.webp, map.css.
 */
import React, { useId } from 'react';
import { GERMANY_PATHS } from './germanyPaths';
import shadowUrl from './germanyShadow.webp';

/** Area the shadow image covers, in map units (silhouette plus blur margin). */
const SHADOW_BOX = { x: -30, y: -30, width: 660, height: 870 } as const;

export const GermanyOutline = React.memo(function GermanyOutline() {
  const prefix = `de${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const ref = (i: number) => `#${prefix}-${i}`;
  return (
    <g style={{ pointerEvents: 'none' }} aria-hidden="true">
      <defs>
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
      <image
        href={shadowUrl}
        {...SHADOW_BOX}
        preserveAspectRatio="none"
        className="map-land-shadow"
      />
      <g className="map-coast">
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
