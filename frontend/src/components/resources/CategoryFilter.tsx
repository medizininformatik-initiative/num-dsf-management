/**
 * CategoryFilter.tsx — segmented category picker for the DSF Resources page:
 * "All" plus one toggle button (aria-pressed) per category, each with the
 * number of resources it would show. A single selection pill slides behind
 * the active button (transform + size on the spring easing token); it is
 * measured from the buttons' layout offsets, re-measured on resize, and does
 * not animate on first paint. Under Reduce Motion the global stylesheet drops
 * transform/size transitions, so the pill jumps and only colours crossfade.
 * Scrolls horizontally on narrow screens instead of wrapping.
 * Dependencies: react, i18n.store, lib/dsfResources
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../stores/i18n.store';
import {
  CATEGORY_LABEL_KEY,
  RESOURCE_CATEGORIES,
  type CategoryFilter as Filter,
} from '../../lib/dsfResources';

interface Props {
  value: Filter;
  onChange: (value: Filter) => void;
  counts: Record<Filter, number>;
}

interface Pill {
  x: number;
  y: number;
  w: number;
  h: number;
}

const OPTIONS: Filter[] = ['all', ...RESOURCE_CATEGORIES];

export function CategoryFilter({ value, onChange, counts }: Props) {
  const { t, lang } = useI18n();
  const groupRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<Filter, HTMLButtonElement>());
  const [pill, setPill] = useState<Pill | null>(null);
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const el = buttons.current.get(value);
      if (!el) return;
      setPill({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const group = groupRef.current;
    if (!group || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(group);
    return () => ro.disconnect();
  }, [value, lang, counts]);

  // Enable the slide only after the first placement, so the pill does not
  // fly in from the corner on mount.
  useLayoutEffect(() => {
    if (pill && !animated) {
      const id = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(id);
    }
  }, [pill, animated]);

  const label = (f: Filter) =>
    f === 'all' ? t('dsfResourcesFilterAll') : t(CATEGORY_LABEL_KEY[f]);

  return (
    <div className="-mx-6 overflow-x-auto px-6 pb-1 sm:mx-0 sm:px-0">
      <div
        ref={groupRef}
        role="group"
        aria-label={t('dsfResourcesFilterLabel')}
        className="relative inline-flex min-w-max items-center gap-0.5 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-card)] p-1"
      >
        {pill && (
          <span
            aria-hidden="true"
            data-testid="category-pill"
            className={`absolute left-0 top-0 rounded-full bg-[color:var(--accent-solid)] shadow-sm ${
              animated ? 'transition-[transform,width,height] duration-medium ease-spring' : ''
            }`}
            style={{
              transform: `translate(${pill.x}px, ${pill.y}px)`,
              width: pill.w,
              height: pill.h,
            }}
          />
        )}
        {OPTIONS.map((f) => {
          const active = f === value;
          return (
            <button
              key={f}
              ref={(el) => {
                if (el) buttons.current.set(f, el);
                else buttons.current.delete(f);
              }}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(f)}
              className={`press-effect relative z-[1] inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] ${
                active
                  ? 'text-white'
                  : 'text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]'
              }`}
            >
              {label(f)}
              <span
                className={`text-2xs font-medium tabular-nums ${
                  active ? 'text-white/90' : 'text-[color:var(--text-muted)]'
                }`}
              >
                {counts[f]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
