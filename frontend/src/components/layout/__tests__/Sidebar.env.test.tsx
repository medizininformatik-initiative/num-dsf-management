/**
 * Sidebar.env.test.tsx – the sidebar marks a PRODUCTION build differently
 * from TEST: its own label, icon and accent colour, in the full column and
 * as the compact rail badge. lib/environment is mocked to PRODUCTION here
 * (Sidebar.test.tsx covers the TEST default).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

vi.mock('../../../lib/environment', () => ({
  DSF_ENVIRONMENT: 'PRODUCTION',
  IS_PRODUCTION: true,
  ENV_ACCENT: '#1d4ed8',
}));
vi.mock('../../../hooks/useInstance', () => ({
  useInstances: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: { email: 'op@imi-test.example.de', isAdmin: false }, isLoading: false }),
}));

import { Sidebar } from '../Sidebar';

describe('Sidebar environment badge (PRODUCTION)', () => {
  it('names the production environment with its accent and icon', () => {
    renderWithProviders(<Sidebar />, { route: '/app' });
    const label = screen.getByText('Production environment');
    const badge = label.parentElement as HTMLElement;
    expect(badge).toHaveStyle({ background: '#1d4ed8' });
    expect(badge).toHaveTextContent('verified_user');
    expect(screen.queryByText('Test environment')).not.toBeInTheDocument();
  });

  it('shows the compact PROD badge in the rail', () => {
    renderWithProviders(<Sidebar variant="rail" onToggle={vi.fn()} />, { route: '/app' });
    expect(screen.getByText('PROD')).toBeInTheDocument();
    expect(screen.getByText('Production environment')).toHaveClass('sr-only');
  });
});
