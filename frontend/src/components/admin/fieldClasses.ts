/**
 * fieldClasses.ts – Shared Tailwind class strings for the form controls on
 * the admin pages (text inputs, textareas, selects and their labels), so every
 * field has the same theme-aware surface, border and visible keyboard focus
 * ring, and labels and hints match the entity modals' FormField.
 * Dependencies: the theme variables in src/index.css.
 */

export const FIELD_CLASS =
  'w-full rounded-input border border-[color:var(--border-strong)] bg-[color:var(--bg-input)] px-3 py-2 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] transition-colors duration-short ease-standard focus-visible:border-[color:var(--focus-ring)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-50';

export const LABEL_CLASS = 'mb-1 block text-xs font-semibold text-[color:var(--text-secondary)]';

export const HINT_CLASS = 'mt-1 block text-xs text-[color:var(--text-muted)]';
