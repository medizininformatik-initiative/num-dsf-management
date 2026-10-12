/**
 * CanvasViewSwitch.test.tsx — the Simple/Detailed switch: role-based default (admin →
 * detailed, member → simple), the explicit choice overrides it and is remembered in
 * localStorage, and the buttons are keyboard operable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { CANVAS_VIEW_KEY, useCanvasViewStore } from '../../../stores/canvasView.store';

let isAdmin = false;
vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: { email: 'a@b.de', isAdmin } }),
}));

import { CanvasViewSwitch } from '../CanvasViewSwitch';

const simple = () => screen.getByRole('button', { name: 'Simple' });
const detailed = () => screen.getByRole('button', { name: 'Detailed' });

beforeEach(() => {
  useCanvasViewStore.setState({ choice: null });
});

describe('CanvasViewSwitch', () => {
  it('defaults to the simplified view for members', () => {
    isAdmin = false;
    renderWithProviders(<CanvasViewSwitch />);
    expect(simple()).toHaveAttribute('aria-pressed', 'true');
    expect(detailed()).toHaveAttribute('aria-pressed', 'false');
  });

  it('defaults to the detailed view for admins', () => {
    isAdmin = true;
    renderWithProviders(<CanvasViewSwitch />);
    expect(detailed()).toHaveAttribute('aria-pressed', 'true');
  });

  it('remembers an explicit choice per browser and lets it override the default', async () => {
    isAdmin = true;
    renderWithProviders(<CanvasViewSwitch />);
    await userEvent.click(simple());
    expect(simple()).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(CANVAS_VIEW_KEY)).toBe('simple');
  });

  it('is operable with the keyboard', async () => {
    isAdmin = false;
    renderWithProviders(<CanvasViewSwitch />);
    await userEvent.tab();
    await userEvent.tab();
    expect(detailed()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(detailed()).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(CANVAS_VIEW_KEY)).toBe('detailed');
  });
});
