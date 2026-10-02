/**
 * fakeMatchMedia.ts – test helper: installs a window.matchMedia whose result
 * the test controls, so code that follows a media query (useWideLayout) can be
 * driven across a breakpoint. jsdom has no matchMedia; uninstall() removes it
 * again. Every query string shares the one `matches` value.
 */
import { act } from '@testing-library/react';

export interface FakeMatchMedia {
  /** Switch the result and notify the change listeners (wrapped in act). */
  set: (matches: boolean) => void;
  uninstall: () => void;
}

export function installMatchMedia(initial: boolean): FakeMatchMedia {
  let matches = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = (media: string) =>
    ({
      get matches() {
        return matches;
      },
      media,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;

  return {
    set(next) {
      matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
    uninstall() {
      // jsdom does not define matchMedia; restore that state.
      delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}
