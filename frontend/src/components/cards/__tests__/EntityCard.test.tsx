/**
 * EntityCard.test.tsx — the shared card wrapper renders its title and children
 * and fires onAdd when the add control is clicked.
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

  it('fires onAdd when the add button is clicked', async () => {
    const onAdd = vi.fn();
    renderWithProviders(
      <EntityCard
        id="c"
        title="Contacts"
        borderColor="#000"
        icon="x"
        onAdd={onAdd}
        addLabel="+ Add"
      >
        <span />
      </EntityCard>,
    );
    await userEvent.click(screen.getByText('+ Add'));
    expect(onAdd).toHaveBeenCalledTimes(1);
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
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
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
});
