/**
 * Sidebar.env.test.tsx – the sidebar marks a PRODUCTION build differently
 * from TEST: its own label and accent dot under the product name, and the
 * label as the rail mark's tooltip. lib/environment is mocked to PRODUCTION here
 * (Sidebar.test.tsx covers the TEST default).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
  it('names the production environment with its accent dot', () => {
    renderWithProviders(<Sidebar />, { route: '/app' });
    const badge = screen.getByText('Production environment');
    expect(badge).toHaveAttribute('data-env', 'PRODUCTION');
    expect(within(badge).getByTestId('env-dot')).toHaveStyle({ background: '#1d4ed8' });
    expect(screen.queryByText('Test environment')).not.toBeInTheDocument();
  });

  it('keeps the production label as the rail mark tooltip', () => {
    renderWithProviders(<Sidebar variant="rail" onToggle={vi.fn()} />, { route: '/app' });
    expect(screen.getByTitle('Production environment')).toContainElement(
      screen.getByText('Production environment'),
    );
  });
});
