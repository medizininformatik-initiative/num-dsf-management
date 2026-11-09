import type { Config } from 'tailwindcss';

/**
 * Motion utilities. Durations and easings resolve to the CSS custom properties
 * in src/index.css (the single source of truth, incl. the linear() spring curves
 * and their cubic-bezier fallbacks), so `duration-medium ease-spring` and
 * `var(--duration-medium) var(--ease-spring)` always agree.
 *
 * Every animate-* utility is an entrance (spring, `both` fill) or its exit
 * (ease-in at ~70% of the entrance). Pair them through a data-state attribute,
 * e.g. `data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out`
 * with usePresence(). Under prefers-reduced-motion, index.css redefines the
 * movement keyframes below as plain opacity crossfades.
 */
const duration = (name: string) => `var(--duration-${name})`;

const motion = {
  transitionDuration: {
    micro: duration('micro'),
    short: duration('short'),
    medium: duration('medium'),
    long: duration('long'),
    'micro-exit': duration('micro-exit'),
    'short-exit': duration('short-exit'),
    'medium-exit': duration('medium-exit'),
    'long-exit': duration('long-exit'),
  },
  transitionTimingFunction: {
    standard: 'var(--ease-standard)',
    spring: 'var(--ease-spring)',
    'spring-bouncy': 'var(--ease-spring-bouncy)',
    exit: 'var(--ease-exit)',
  },
  keyframes: {
    'fade-in': { from: { opacity: '0' } },
    'fade-out': { to: { opacity: '0' } },
    // Dialogs: opacity + scale .96 + 8px rise.
    'scale-in': { from: { opacity: '0', transform: 'translateY(8px) scale(0.96)' } },
    'scale-out': { to: { opacity: '0', transform: 'translateY(8px) scale(0.96)' } },
    // Drawers / sheets slide fully in from an edge.
    'sheet-in-right': { from: { transform: 'translateX(100%)' } },
    'sheet-out-right': { to: { transform: 'translateX(100%)' } },
    'sheet-in-left': { from: { transform: 'translateX(-100%)' } },
    'sheet-out-left': { to: { transform: 'translateX(-100%)' } },
    'sheet-in-bottom': { from: { transform: 'translateY(100%)' } },
    'sheet-out-bottom': { to: { transform: 'translateY(100%)' } },
    // Popovers grow from their anchor: set transform-origin (e.g. origin-top-right).
    'popover-in': { from: { opacity: '0', transform: 'scale(0.96)' } },
    'popover-out': { to: { opacity: '0', transform: 'scale(0.96)' } },
    'list-item-in': { from: { opacity: '0', transform: 'translateY(6px)' } },
    // Disclosure content: a grid wrapper grows its single row from 0fr to 1fr
    // (the child needs min-h-0 overflow-hidden), so the height follows the
    // content without measuring it.
    'expand-in': { from: { gridTemplateRows: '0fr', opacity: '0' } },
    'expand-out': { to: { gridTemplateRows: '0fr', opacity: '0' } },
    // A completed step's check pops in where the step icon was.
    'check-in': { from: { opacity: '0', transform: 'scale(0.4) rotate(-25deg)' } },
    'toast-in': { from: { opacity: '0', transform: 'translateY(12px) scale(0.96)' } },
    'toast-out': { to: { opacity: '0', transform: 'scale(0.96)' } },
    shimmer: { from: { backgroundPosition: '150% 0' }, to: { backgroundPosition: '-50% 0' } },
  },
  animation: {
    'fade-in': 'fade-in var(--duration-short) var(--ease-standard) both',
    'fade-out': 'fade-out var(--duration-short-exit) var(--ease-exit) both',
    // Scrims / backdrops: fade on the dialog timeline so both leave together.
    'overlay-in': 'fade-in var(--duration-medium) var(--ease-standard) both',
    'overlay-out': 'fade-out var(--duration-medium-exit) var(--ease-exit) both',
    'scale-in': 'scale-in var(--duration-medium) var(--ease-spring) both',
    'scale-out': 'scale-out var(--duration-medium-exit) var(--ease-exit) both',
    'sheet-in-right': 'sheet-in-right var(--duration-long) var(--ease-spring) both',
    'sheet-out-right': 'sheet-out-right var(--duration-long-exit) var(--ease-exit) both',
    'sheet-in-left': 'sheet-in-left var(--duration-long) var(--ease-spring) both',
    'sheet-out-left': 'sheet-out-left var(--duration-long-exit) var(--ease-exit) both',
    'sheet-in-bottom': 'sheet-in-bottom var(--duration-long) var(--ease-spring) both',
    'sheet-out-bottom': 'sheet-out-bottom var(--duration-long-exit) var(--ease-exit) both',
    'popover-in': 'popover-in var(--duration-short) var(--ease-spring) both',
    'popover-out': 'popover-out var(--duration-short-exit) var(--ease-exit) both',
    // Stagger: set style={{ '--stagger-index': i }} on each item (capped at 12).
    'list-item-in':
      'list-item-in var(--duration-medium) var(--ease-spring) calc(min(var(--stagger-index, 0), 12) * var(--stagger-step)) both',
    'expand-in': 'expand-in var(--duration-medium) var(--ease-spring) both',
    'expand-out': 'expand-out var(--duration-medium-exit) var(--ease-exit) both',
    'check-in': 'check-in var(--duration-medium) var(--ease-spring-bouncy) both',
    'toast-in': 'toast-in var(--duration-medium) var(--ease-spring-bouncy) both',
    'toast-out': 'toast-out var(--duration-short-exit) var(--ease-exit) both',
    shimmer: 'shimmer calc(var(--duration-long) * 3) var(--ease-standard) infinite',
  },
};

/**
 * Status tones: the central colour scale behind StatusPill and
 * src/lib/statusColors.ts, e.g. `text-danger-fg bg-danger-surface
 * border-danger-border`. Values are the --tone-* custom properties in
 * src/index.css, which switch with the .dark class (no dark: variant needed).
 */
const tone = (name: string) => ({
  fg: `var(--tone-${name}-fg)`,
  surface: `var(--tone-${name}-surface)`,
  border: `var(--tone-${name}-border)`,
});

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // dark: variants follow the theme store's .dark class on <html>, not the OS.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        success: tone('success'),
        warning: tone('warning'),
        danger: tone('danger'),
        info: tone('info'),
        neutral: tone('neutral'),
        background: '#f7f9ff',
        surface: '#f7f9ff',
        'surface-container-low': '#f1f3f9',
        'surface-container-lowest': '#ffffff',
        'on-surface': '#181c20',
        'on-surface-variant': '#464555',
        'outline-variant': '#c7c4d8',
        // Accent from the violet of the IMI logo gradient: filled controls with
        // white text (5.6:1) and, with dark:text-brand-400, accent text. The
        // theme-aware text/ring colour is var(--primary) in src/index.css.
        primary: '#675fa8',
        'primary-container': '#554e8f',
        secondary: '#006b5a',
        tertiary: '#805200',
        error: '#ba1a1a',
        // Accent scale around primary (600). Light text: 700 (7.3:1 on white);
        // dark text: 400 (5.6:1 on the dark card).
        brand: {
          50: '#f1f0f9',
          100: '#e2dff2',
          400: '#8f87cc',
          600: '#675fa8',
          700: '#554e8f',
          900: '#2a2748',
        },
        // IMI logo gradient stops (sampled from the logo) — brand use only.
        imi: {
          magenta: '#a7338f',
          violet: '#675fa8',
          blue: '#3287ba',
          green: '#6dab4a',
        },
        canvas: '#f0f2f8',
        card: '#ffffff',
        border: '#e8eaf0',
        muted: '#9b9fad',
        ink: '#1a1a2e',
      },
      // Radius scale by role: small (code, kbd, tiny badges, segment items),
      // control (buttons, inputs, and anything nested inside a surface), card
      // (standalone surfaces: page boxes, panels, dialogs, popovers, banners)
      // and full for pills. button / input are the control step under their
      // older names.
      borderRadius: {
        small: '6px',
        control: '10px',
        card: '16px',
        button: '10px',
        input: '10px',
      },
      // Type scale: 2xs 11 (captions, badges, table heads), xs 12 (meta,
      // hints), sm 14 (body, controls), base 16 (card and section titles),
      // lg 18 (section titles on reading pages), xl 20 (page title), 2xl 24
      // (display: not-found, process name, sign-in card).
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        'card-elevated': '0 2px 8px rgba(24,28,32,0.06)',
        'card-elevated-hover': '0 4px 16px rgba(24,28,32,0.1)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      ...motion,
    },
  },
  plugins: [],
} satisfies Config;
