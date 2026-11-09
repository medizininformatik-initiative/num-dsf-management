/**
 * EntityCard.test.tsx — the shared card wrapper: a region named by its title
 * that FK links can focus, a translated add Button whose accessible name
 * includes the card title, and the loading / error body states.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { EntityCard } from '../EntityCard';

describe('EntityCard', () => {
  it('renders the title and children', () => {
    renderWithProviders(
      <EntityCard id="org" title="Organization" borderColor="#b01e66" icon="business">
        <p>card body</p>
      </EntityCard>,
    );
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('card body')).toBeInTheDocument();
  });

  it('is a region named by its title that can take focus as a jump target', () => {
    renderWithProviders(
      <EntityCard id="organization" title="Organization" borderColor="#000" icon="x">
        <span />
      </EntityCard>,
    );
    const region = screen.getByRole('region', { name: 'Organization' });
    expect(region).toHaveAttribute('id', 'card-organization');
    region.focus();
    expect(region).toHaveFocus();
    // Focusable by script only, never an extra tab stop.
    expect(region).toHaveAttribute('tabindex', '-1');
  });

  it('fires onAdd from an add Button named after the card', async () => {
    const onAdd = vi.fn();
    renderWithProviders(
      <EntityCard id="c" title="Contacts" borderColor="#000" icon="x" onAdd={onAdd}>
        <span />
      </EntityCard>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add Contacts' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('translates the default add label', () => {
    renderWithProviders(
      <EntityCard id="c" title="Kontakte" borderColor="#000" icon="x" onAdd={() => {}}>
        <span />
      </EntityCard>,
      { lang: 'de' },
    );
    expect(screen.getByRole('button', { name: 'Hinzufügen Kontakte' })).toBeInTheDocument();
  });

  it('uses a custom add label and still names the card', () => {
    renderWithProviders(
      <EntityCard
        id="organization"
        title="Organization"
        borderColor="#000"
        icon="x"
        onAdd={() => {}}
        addLabel="Edit"
      >
        <span />
      </EntityCard>,
    );
    expect(screen.getByRole('button', { name: 'Edit Organization' })).toBeInTheDocument();
  });
});

describe('EntityCard data states', () => {
  it('shows a busy skeleton instead of the body while loading', () => {
    renderWithProviders(
      <EntityCard id="e" title="Endpoints" borderColor="#000" icon="x" status="loading">
        <p>card body</p>
      </EntityCard>,
    );
    expect(screen.queryByText('card body')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Endpoints' })).toHaveAttribute('aria-busy', 'true');
    // The skeleton bars are decorative; screen readers hear "Loading…".
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('announces a load error and retries on request', async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <EntityCard
        id="e"
        title="Endpoints"
        borderColor="#000"
        icon="x"
        status="error"
        onRetry={onRetry}
      >
        <p>card body</p>
      </EntityCard>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this data.');
    expect(screen.queryByText('card body')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry Button when there is nothing to retry', () => {
    renderWithProviders(
      <EntityCard id="e" title="Endpoints" borderColor="#000" icon="x" status="error">
        <p>card body</p>
      </EntityCard>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
