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
    expect(dashboard.className).toContain('bg-brand-50');
    expect(screen.getByRole('link', { name: 'Network Map' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Status' })).not.toHaveAttribute('aria-current');
  });

  it('marks the map and status links as the current page on their routes', () => {
    const { unmount } = renderWithProviders(<Sidebar />, { route: '/app/map' });
    expect(screen.getByRole('link', { name: 'Network Map' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    unmount();

    renderWithProviders(<Sidebar />, { route: '/app/status' });
    expect(screen.getByRole('link', { name: 'Status' })).toHaveAttribute('aria-current', 'page');
  });

  it('highlights a closed group that contains the current route and expands it on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar />, { route: '/app/admin/users' });
    const group = screen.getByRole('button', { name: 'Administration' });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(group.className).toContain('bg-brand-50');

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
  it('names the TEST environment in the full sidebar', () => {
    renderWithProviders(<Sidebar />, { route: '/app' });
    expect(screen.getByText('Test environment')).toBeVisible();
  });

  it('keeps a compact TEST badge in the rail', () => {
    renderWithProviders(<Sidebar variant="rail" onToggle={vi.fn()} />, { route: '/app' });
    expect(screen.getByText('TEST')).toBeInTheDocument();
    expect(screen.getByText('Test environment')).toHaveClass('sr-only');
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
    expect(screen.getByRole('link', { name: 'Network Map' })).toHaveAttribute(
      'title',
      'Network Map',
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
    expect(screen.getByText('Verwaltungsportal')).toBeInTheDocument();
    expect(screen.getByText('Testumgebung')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'alpha.example.de anheften' })).toBeInTheDocument();
  });
});
