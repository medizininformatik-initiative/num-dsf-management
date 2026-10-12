/**
 * test-setup.ts – Vitest setup file.
 * Loaded once before each test file via vite.config.ts `setupFiles`.
 * Adds jest-dom matchers to expect, and clears localStorage after every test
 * so persisted UI state (theme, language) cannot leak between tests.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { useCanvasViewStore } from './stores/canvasView.store';

// The entity cards default to the detailed view in tests, which assert on all fields;
// the simplified view has its own tests that set the choice explicitly.
beforeEach(() => {
  useCanvasViewStore.setState({ choice: 'detailed' });
});

afterEach(() => {
  localStorage.clear();
});
