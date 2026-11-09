/**
 * sidebarStyles.ts – class names shared by the Sidebar and its
 * InstanceSwitcher: keyboard focus ring, the 36 px navigation rows with quiet
 * icons, the accent selection pill (light and dark via the accent tokens),
 * section headers, and the label motion of the collapse to the rail.
 * Dependencies: none (Tailwind class strings).
 */

export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';

// Rows draw their ring inside, so clipping containers never cut it off.
export const ROW_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';

// Icons sit 22 px from the column edge in every variant, so they stay put
// while the column narrows to the rail and the selection pill shrinks with it.
export const ROW = `press-effect flex h-9 w-full items-center gap-3 overflow-hidden whitespace-nowrap rounded-control px-[10px] text-left text-[13px] ${ROW_FOCUS}`;

export const IDLE =
  'font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]';

/** The rounded selection pill of the current item. */
export const ACTIVE =
  'bg-[color:var(--accent-surface)] font-semibold text-[color:var(--accent-on-surface)]';

/** Row icons stay quiet; the current item's icon takes the accent. */
export function iconTone(active: boolean): string {
  return active ? 'text-[color:var(--primary)]' : 'text-[color:var(--text-muted)]';
}

/** Small semibold section header (sentence case, no small caps). */
export const SECTION_HEADER = 'text-xs font-semibold text-[color:var(--text-muted)]';

/**
 * Labels slide and fade out before the column narrows to the rail, and back
 * in once it has grown (AppPage delays the width change to match).
 */
export function fade(rail: boolean): string {
  return rail
    ? 'transition-[opacity,transform] duration-short-exit ease-exit -translate-x-1 opacity-0'
    : 'transition-[opacity,transform] duration-short ease-standard delay-[calc(var(--duration-medium)*0.45)]';
}
