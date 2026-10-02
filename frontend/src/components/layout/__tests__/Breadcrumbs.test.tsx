import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { Breadcrumbs } from '../Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders nothing on the top-level route', () => {
    const { container } = renderWithProviders(<Breadcrumbs />, { route: '/app' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a labelled trail on a sub-route', () => {
    renderWithProviders(<Breadcrumbs />, { route: '/app/audit' });
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    // First segment ("app") is a link, last segment ("audit") is plain text.
    const link = screen.getByRole('link', { name: /dashboard/i });
    expect(link).toHaveAttribute('href', '/app');
    expect(screen.getByText(/audit log/i)).toBeInTheDocument();
  });

  it('names the trail and marks the current page', () => {
    renderWithProviders(<Breadcrumbs />, { route: '/app/admin/users' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByText('User management')).toHaveAttribute('aria-current', 'page');
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
