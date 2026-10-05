/**
 * DsfResourcesPage.test.tsx — the DSF resources page: one h1 with the intro,
 * the featured "Start here" row, external links that open safely in a new tab
 * with an accessible name saying so, the category filter, search, the empty
 * state and "Clear filters". Default language is English (no `dsf-lang` in
 * localStorage), so assertions use the English strings.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { DsfResourcesPage } from '../DsfResourcesPage';
import { DSF_RESOURCES } from '../../lib/dsfResources';

function section(name: string) {
  return screen.getByRole('region', { name });
}

describe('DsfResourcesPage', () => {
  it('renders a single title with the intro, the Start here row and the full list', () => {
    renderWithProviders(<DsfResourcesPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'DSF Resources' })).toBeInTheDocument();
    const featured = DSF_RESOURCES.filter((r) => r.featured);
    expect(within(section('Start here')).getAllByRole('link')).toHaveLength(featured.length);
    expect(within(section('All resources')).getAllByRole('link')).toHaveLength(
      DSF_RESOURCES.length - featured.length,
    );
    expect(screen.getByText(`${DSF_RESOURCES.length} resources`)).toBeInTheDocument();
  });

  it('renders external links that open safely in a new tab and say so', () => {
    renderWithProviders(<DsfResourcesPage />);
    const linter = screen.getByRole('link', { name: 'DSF Linter, opens dsf.dev in a new tab' });
    expect(linter).toHaveAttribute(
      'href',
      'https://dsf.dev/process-development/linter-tool/linter-tool.html',
    );
    expect(linter).toHaveAttribute('target', '_blank');
    expect(linter).toHaveAttribute('rel', 'noopener noreferrer');
    expect(linter).toHaveAccessibleDescription('Validate BPMN process plugins against DSF rules.');
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('filters by category and hides the Start here row', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DsfResourcesPage />);
    const networks = screen.getByRole('button', { name: /Networks & consortia/ });
    await user.click(networks);
    expect(networks).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'Start here' })).not.toBeInTheDocument();
    const list = section('Networks & consortia');
    const expected = DSF_RESOURCES.filter((r) => r.category === 'networks');
    expect(within(list).getAllByRole('link')).toHaveLength(expected.length);
    expect(within(list).getByText(`${expected.length} resources`)).toBeInTheDocument();
  });

  it('searches titles, descriptions and hosts, and offers to clear an empty result', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DsfResourcesPage />);
    const search = screen.getByRole('searchbox', { name: 'Search resources' });

    await user.type(search, 'omg.org');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      'https://www.omg.org/spec/BPMN/2.0/',
    ]);
    expect(screen.getByText('1 resource')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'no-such-resource-xyz');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('No matching resources')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(search).toHaveValue('');
    expect(section('Start here')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(DSF_RESOURCES.length);
  });
});
