/**
 * sidebarStyles.ts – class names shared by the Sidebar and its
 * InstanceSwitcher: keyboard focus ring, navigation rows and the brand-colour
 * active state (light and dark), plus the label fade used by the rail.
 * Dependencies: none (Tailwind class strings).
 */

export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';

// Icons sit 22 px from the column edge in every variant, so they stay put
// while the column narrows to the rail.
export const ROW = `press-effect flex w-full items-center gap-3 overflow-hidden whitespace-nowrap rounded-lg px-[10px] text-left text-xs ${FOCUS_RING}`;

export const IDLE =
  'text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]';

export const ACTIVE =
  'bg-brand-50 font-bold text-brand-700 dark:bg-brand-400/15 dark:text-brand-100';

/** Labels fade out in the rail, where the narrowing column also clips them. */
export function fade(rail: boolean): string {
  return `transition-opacity duration-short ease-standard ${rail ? 'opacity-0' : ''}`;
}
