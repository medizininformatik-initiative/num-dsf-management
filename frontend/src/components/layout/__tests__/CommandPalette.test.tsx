/**
 * CommandPalette.test.tsx — the palette holds its open state internally and
 * opens on Ctrl+K (a window keydown listener). Data hooks are mocked. While
 * closed it renders nothing; open, it is a labelled modal dialog (DialogShell:
 * glass, spring motion) with the search field focused.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

vi.mock('../../../hooks/useInstance', () => ({
  useInstances: () => ({ data: [] }),
}));
vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: { isAdmin: false } }),
}));

import { CommandPalette } from '../CommandPalette';

describe('CommandPalette', () => {
  it('renders nothing while closed', () => {
    const { container } = renderWithProviders(<CommandPalette />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on Ctrl+K and shows the command placeholder', () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
  });

  it('opens as a labelled modal dialog on glass with the search field focused', () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toContain('glass-thick');
    expect(dialog.className).toContain('data-[state=open]:animate-scale-in');
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toHaveFocus();
  });

  it('toggles closed on a second Ctrl+K', () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
