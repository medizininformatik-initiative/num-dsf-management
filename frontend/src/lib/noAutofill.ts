/**
 * noAutofill.ts – data attributes that keep password managers (1Password,
 * LastPass, Bitwarden, generic form-type hints) from injecting a stale value
 * into a TOTP / TAN field. Spread onto the input; the value itself is always
 * read from React state.
 * Dependencies: none.
 */
export const NO_AUTOFILL = {
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const;
