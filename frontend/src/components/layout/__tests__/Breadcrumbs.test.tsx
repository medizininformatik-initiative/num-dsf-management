import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { Breadcrumbs } from '../Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders nothing on the top-level route', () => {
    const { container } = renderWithProviders(<Breadcrumbs />, { route: '/app' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing one level deep, where the sidebar and page header suffice', () => {
    const { container } = renderWithProviders(<Breadcrumbs />, { route: '/app/audit' });
    expect(container).toBeEmptyDOMElement();
  });

  it('names the trail and marks the current page', () => {
    renderWithProviders(<Breadcrumbs />, { route: '/app/admin/users' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelectorAll('li')).toHaveLength(3);
    // The page header names the current page; the trail keeps it for screen readers only.
    const current = screen.getByText('User management');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.closest('li')).toHaveClass('sr-only');
    expect(screen.getByRole('link', { name: 'Approval Review' })).toHaveAttribute(
      'href',
      '/app/admin',
    );
  });

  it('translates every route segment instead of showing the raw path', () => {
    renderWithProviders(<Breadcrumbs />, { route: '/app/admin/ca-blacklist', lang: 'de' });
    expect(screen.getByRole('navigation', { name: 'Brotkrümelnavigation' })).toBeInTheDocument();
    expect(screen.queryByText('ca-blacklist')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Übersicht' })).toHaveAttribute('href', '/app');
  });
});
