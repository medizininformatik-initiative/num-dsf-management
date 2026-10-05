/**
 * Sidebar.test.tsx – navigation semantics and variants of the sidebar:
 * NavLink active state with aria-current, instance rows without nested
 * buttons (separate pin toggle), the environment badge, the collapsed rail
 * (icons only, group buttons expand with the group open) and the drawer
 * variant (close button, preset group, onNavigate after a choice).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';
import { useAuthStore } from '../../../stores/auth.store';

vi.mock('../../../hooks/useInstance', () => ({
  useInstances: () => ({
    data: [
      { id: 'i1', label: 'alpha.example.de' },
      { id: 'i2', label: 'beta.example.de' },
    ],
    isLoading: false,
  }),
}));
vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: { email: 'op@imi-test.example.de', isAdmin: true }, isLoading: false }),
}));

import { Sidebar } from '../Sidebar';

beforeEach(() => {
  useCanvasStore.setState({ activeInstanceId: 'i1' });
});

describe('Sidebar navigation', () => {
  it('renders without throwing', () => {
    renderWithProviders(<Sidebar />, { route: '/app' });
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it('marks the dashboard link as the current page on /app only', () => {
    renderWithProviders(<Sidebar />, { route: '/app' });
    const dashboard = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboard).toHaveAttribute('aria-current', 'page');
    expect(dashboard.className).toContain('accent-surface');
    expect(screen.getByRole('link', { name: 'Federation map' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Status' })).not.toHaveAttribute('aria-current');
  });

  it('marks the map and status links as the current page on their routes', () => {
    const { unmount } = renderWithProviders(<Sidebar />, { route: '/app/map' });
    expect(screen.getByRole('link', { name: 'Federation map' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    unmount();

    renderWithProviders(<Sidebar />, { route: '/app/status' });
    expect(screen.getByRole('link', { name: 'Status' })).toHaveAttribute('aria-current', 'page');
  });

  it('lists Help below the Resources group and marks it current on /app/help', () => {
    renderWithProviders(<Sidebar />, { route: '/app/help' });
    const help = screen.getByRole('link', { name: 'Help' });
    expect(help).toHaveAttribute('href', '/app/help');
    expect(help).toHaveAttribute('aria-current', 'page');
    const resources = screen.getByRole('button', { name: 'Resources' });
    expect(resources.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('highlights a closed group that contains the current route and expands it on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar />, { route: '/app/admin/users' });
    const group = screen.getByRole('button', { name: 'Administration' });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(group.className).toContain('accent-surface');

    await user.click(group);

    expect(group).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(group.getAttribute('aria-controls') ?? '');
    expect(list).not.toBeNull();
    const current = within(list as HTMLElement).getByRole('link', { name: 'User management' });
    expect(current).toHaveAttribute('aria-current', 'page');
    // The exact match keeps the parent "Approval Review" link inactive.
    expect(
      within(list as HTMLElement).getByRole('link', { name: 'Approval Review' }),
    ).not.toHaveAttribute('aria-current');
  });
});

describe('Sidebar instance switcher', () => {
  it('renders each instance as a select button next to a separate pin toggle', () => {
    const { container } = renderWithProviders(<Sidebar />, { route: '/app' });
    expect(container.querySelector('button button')).toBeNull();
    expect(container.querySelector('[role="button"]')).toBeNull();

    expect(screen.getByRole('button', { name: 'alpha.example.de' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'beta.example.de' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('button', { name: 'Pin beta.example.de' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('pins an instance to the top and remembers it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar />, { route: '/app' });

    await user.click(screen.getByRole('button', { name: 'Pin beta.example.de' }));

    expect(screen.getByRole('button', { name: 'Pin beta.example.de' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const rows = screen
      .getAllByRole('button', { name: /^(alpha|beta)\.example\.de$/ })
      .map((b) => b.textContent);
    expect(rows).toEqual(['beta.example.de', 'alpha.example.de']);
    expect(JSON.parse(localStorage.getItem('dsf-pinned-instances') ?? '[]')).toEqual(['i2']);
  });

  it('selects an instance with the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar />, { route: '/app' });

    screen.getByRole('button', { name: 'beta.example.de' }).focus();
    await user.keyboard('{Enter}');

    expect(useCanvasStore.getState().activeInstanceId).toBe('i2');
  });
});

describe('Sidebar environment badge', () => {
  it('names the TEST environment once, under the product name', () => {
    renderWithProviders(<Sidebar />, { route: '/app' });
    expect(screen.getByText('DSF Management Tool')).toBeVisible();
    expect(screen.getAllByText('Test environment')).toHaveLength(1);
    expect(screen.getByText('Test environment')).toHaveAttribute('data-env', 'TEST');
  });

  it('keeps the mark and the environment as its tooltip in the rail', () => {
    renderWithProviders(<Sidebar variant="rail" onToggle={vi.fn()} />, { route: '/app' });
    expect(screen.getByTestId('brand-mark-glyph')).toBeInTheDocument();
    expect(screen.getByTitle('Test environment')).toBeInTheDocument();
  });

  it('shows the signed-in email without repeating the active instance', () => {
    useAuthStore.getState().setTokens('tok', { id: 'u1', email: 'op@imi-test.example.de' });
    renderWithProviders(<Sidebar />, { route: '/app' });
    expect(screen.getByText('op@imi-test.example.de')).toBeInTheDocument();
    // alpha.example.de is active: named once, by its switcher row.
    expect(screen.getAllByText('alpha.example.de')).toHaveLength(1);
  });
});

describe('Sidebar variants', () => {
  it('offers a collapse button in the full column', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithProviders(<Sidebar onToggle={onToggle} controls="app-sidebar" />, {
      route: '/app',
    });
    const button = screen.getByRole('button', { name: 'Collapse navigation' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'app-sidebar');

    await user.click(button);
    expect(onToggle).toHaveBeenCalledWith();
  });

  it('shows icon links in the rail and expands with a group open from its button', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithProviders(<Sidebar variant="rail" onToggle={onToggle} controls="app-sidebar" />, {
      route: '/app',
    });

    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    // Links keep their names (and a tooltip) although the labels are faded out.
    expect(screen.getByRole('link', { name: 'Federation map' })).toHaveAttribute(
      'title',
      'Federation map',
    );
    // No room for the instance switcher in the rail.
    expect(screen.queryByRole('button', { name: 'alpha.example.de' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resources' }));
    expect(onToggle).toHaveBeenCalledWith('resources');
  });

  it('closes from its own button in the drawer and reports navigation', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onNavigate = vi.fn();
    renderWithProviders(
      <Sidebar variant="drawer" onToggle={onToggle} initialGroup="admin" onNavigate={onNavigate} />,
      { route: '/app' },
    );

    // The preset group is open on mount.
    expect(screen.getByRole('button', { name: 'Administration' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('link', { name: 'Audit Log' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'beta.example.de' }));
    expect(onNavigate).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('translates its labels', () => {
    renderWithProviders(<Sidebar />, { route: '/app', lang: 'de' });
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();
    expect(screen.getByText('DSF Management Tool')).toBeInTheDocument();
    expect(screen.getByText('Testumgebung')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'alpha.example.de anheften' })).toBeInTheDocument();
  });
});
