/**
 * BrandMark.tsx – The "DSF Management Tool" mark: a cross of five connected
 * nodes (an echo of the IMI cross, read as a data-sharing network) filled
 * with the IMI logo gradient, next to the product name as text. The glyph is
 * decorative (aria-hidden); the name carries the meaning and is not
 * translated. Motion lives in brand-mark.css: the links draw out and the
 * nodes pop in once on mount, a sheen sweeps across, hovering replays a
 * gentle breathe; all of it only without Reduce Motion.
 * public/favicon.svg is the static twin of this glyph.
 * Dependencies: brand-mark.css.
 */
import { useId, type CSSProperties } from 'react';
import './brand-mark.css';

export const PRODUCT_NAME = 'DSF Management Tool';

/** IMI logo gradient stops, sampled from public/logos/IMI-Logo-grad-eng.png. */
const STOPS = [
  { offset: 0, color: 'var(--brand-magenta, #a7338f)' },
  { offset: 0.36, color: 'var(--brand-violet, #675fa8)' },
  { offset: 0.68, color: 'var(--brand-blue, #3287ba)' },
  { offset: 1, color: 'var(--brand-green, #6dab4a)' },
];

const CENTER = 16;
/** Arm nodes, clockwise from the top. */
const ARMS = [
  [16, 4.5],
  [27.5, 16],
  [16, 27.5],
  [4.5, 16],
] as const;
const RING = `M${ARMS.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;

/** Belt and braces with brand-mark.css: no animation under Reduce Motion. */
const REDUCED_MOTION = 'motion-reduce:[&_*]:!animate-none';

const order = (i: number) => ({ '--bm-i': i }) as CSSProperties;

/** The glyph's shapes in one paint: the gradient, or white for the sheen mask. */
function Glyph({ paint, animated }: { paint: string; animated: boolean }) {
  return (
    <>
      <path
        className={animated ? 'bm-ring' : undefined}
        d={RING}
        fill="none"
        stroke={paint}
        strokeWidth={1.4}
        strokeLinejoin="round"
        opacity={animated ? 0.45 : 1}
      />
      {ARMS.map(([x, y], i) => (
        <line
          key={`l${i}`}
          className={animated ? 'bm-link' : undefined}
          style={animated ? order(i) : undefined}
          x1={CENTER}
          y1={CENTER}
          x2={x}
          y2={y}
          pathLength={1}
          stroke={paint}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      ))}
      {/* The intro pops the circle, a hover breathes its wrapper, so leaving
          the hover never replays the intro. */}
      {ARMS.map(([x, y], i) => (
        <g key={`n${i}`} className={animated ? 'bm-breathe' : undefined} style={order(i + 1)}>
          <circle className={animated ? 'bm-node' : undefined} cx={x} cy={y} r={3.3} fill={paint} />
        </g>
      ))}
      <g className={animated ? 'bm-breathe' : undefined}>
        <circle
          className={animated ? 'bm-core' : undefined}
          cx={CENTER}
          cy={CENTER}
          r={4.6}
          fill={paint}
        />
      </g>
    </>
  );
}

interface BrandMarkProps {
  /** Edge length of the glyph in px. */
  size?: number;
  /** Extra classes for the name, e.g. the sidebar rail's label fade. */
  nameClassName?: string;
  className?: string;
}

export function BrandMark({ size = 28, nameClassName = '', className = '' }: BrandMarkProps) {
  // useId() contains colons; keep the SVG ids to plain characters.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `bm-gradient-${id}`;
  const maskId = `bm-mask-${id}`;
  const sheenId = `bm-sheen-${id}`;

  return (
    <span className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <svg
        aria-hidden="true"
        focusable="false"
        data-testid="brand-mark-glyph"
        className={`brand-mark shrink-0 overflow-visible ${REDUCED_MOTION}`}
        width={size}
        height={size}
        viewBox="0 0 32 32"
      >
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="4"
            y1="4"
            x2="28"
            y2="28"
          >
            {STOPS.map((s) => (
              <stop key={s.offset} offset={s.offset} style={{ stopColor: s.color }} />
            ))}
          </linearGradient>
          <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.7" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
            <Glyph paint="#fff" animated={false} />
          </mask>
        </defs>
        <Glyph paint={`url(#${gradientId})`} animated />
        {/* CSS transforms move the sheen inside the rotated group: the rect
            sweeps once on mount, its wrapper sweeps it again on hover. */}
        <g mask={`url(#${maskId})`}>
          <g transform="rotate(20 16 16)">
            <g className="bm-sheen-hover">
              <rect
                className="bm-sheen"
                x="6"
                y="-6"
                width="10"
                height="44"
                fill={`url(#${sheenId})`}
              />
            </g>
          </g>
        </g>
      </svg>
      <span
        className={`min-w-0 truncate text-[13px] font-semibold tracking-tight text-[color:var(--text-primary)] ${nameClassName}`}
      >
        {PRODUCT_NAME}
      </span>
    </span>
  );
}
