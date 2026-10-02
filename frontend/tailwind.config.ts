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
    'toast-in': 'toast-in var(--duration-medium) var(--ease-spring-bouncy) both',
    'toast-out': 'toast-out var(--duration-short-exit) var(--ease-exit) both',
    shimmer: 'shimmer calc(var(--duration-long) * 3) var(--ease-standard) infinite',
  },
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f7f9ff',
        surface: '#f7f9ff',
        'surface-container-low': '#f1f3f9',
        'surface-container-lowest': '#ffffff',
        'on-surface': '#181c20',
        'on-surface-variant': '#464555',
        'outline-variant': '#c7c4d8',
        primary: '#b01e66',
        'primary-container': '#8a1750',
        secondary: '#006b5a',
        tertiary: '#805200',
        error: '#ba1a1a',
        brand: {
          50: '#fde3ef',
          100: '#fbc9de',
          400: '#e06399',
          600: '#b01e66',
          700: '#8a1750',
          900: '#4a0b28',
        },
        canvas: '#f0f2f8',
        card: '#ffffff',
        border: '#e8eaf0',
        muted: '#9b9fad',
        ink: '#1a1a2e',
      },
      borderRadius: {
        card: '16px',
        button: '10px',
        input: '10px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(176,30,102,0.07)',
        'card-hover': '0 4px 16px rgba(176,30,102,0.13)',
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
