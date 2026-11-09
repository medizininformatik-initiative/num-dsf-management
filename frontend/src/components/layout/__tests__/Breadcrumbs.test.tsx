import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { Breadcrumbs } from '../Breadcrumbs';

function trail(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  return Array.from(nav.querySelectorAll('li')).map(
    (li) => li.querySelector('a, [aria-current]')?.textContent ?? '',
  );
}

describe('Breadcrumbs', () => {
  it('renders nothing on the dashboard', () => {
    const { container } = renderWithProviders(<Breadcrumbs />, { route: '/app' });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the overview and the current page on a top-level route', () => {
    renderWithProviders(<Breadcrumbs />, { route: '/app/audit' });
    expect(trail()).toEqual(['Dashboard', 'Audit log']);
    expect(screen.getByText('Audit log')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/app');
  });

  it('does not show another admin page as the parent of a sibling', () => {
    renderWithProviders(<Breadcrumbs />, { route: '/app/admin/onboarding' });
    expect(trail()).toEqual(['Dashboard', 'Onboarding']);
    expect(screen.queryByRole('link', { name: 'Approval review' })).not.toBeInTheDocument();
  });

  it('nests the admin guide below the approval review', () => {
    renderWithProviders(<Breadcrumbs />, { route: '/app/admin/help' });
    expect(trail()).toEqual(['Dashboard', 'Approval review', 'Admin reference']);
    expect(screen.getByRole('link', { name: 'Approval review' })).toHaveAttribute(
      'href',
      '/app/admin',
    );
  });

  it('puts the entry name last on a marketplace detail page', () => {
    renderWithProviders(<Breadcrumbs current="Cohort Explorer" />, {
      route: '/app/marketplace/cohort-explorer',
    });
    expect(trail()).toEqual(['Dashboard', 'Marketplace', 'Cohort Explorer']);
    expect(screen.getByRole('link', { name: 'Marketplace' })).toHaveAttribute(
      'href',
      '/app/marketplace',
    );
  });

  it('translates the trail', () => {
    renderWithProviders(<Breadcrumbs />, { route: '/app/map', lang: 'de' });
    expect(screen.getByRole('navigation', { name: 'Brotkrümelnavigation' })).toBeInTheDocument();
    expect(screen.getByText('Verbundkarte')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Übersicht' })).toHaveAttribute('href', '/app');
  });
});
