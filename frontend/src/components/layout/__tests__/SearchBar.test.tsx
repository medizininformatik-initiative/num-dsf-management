/**
 * SearchBar.test.tsx — renders the global SearchBar with all five entity hooks
 * mocked to known fixtures. Asserts the placeholder, matching results with
 * translated type labels, the reduced-motion-safe scroll to the chosen card,
 * and dismissal: Escape on the field (marked handled), an outside
 * pointer-down — and no global key listeners (Ctrl+K belongs to the
 * CommandPalette). Uses fireEvent.change to set the input value in one shot
 * (avoids char-by-char typing races in CI).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: { name: 'Uniklinik Muenster', identifier: 'ukm.de' } }),
}));
vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => ({ data: [{ name: 'Ada Lovelace', email: 'ada@ukm.de' }] }),
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({
    data: [{ identifier: 'fhir.ukm.de', name: 'FHIR', address: 'https://fhir.ukm.de' }],
  }),
}));
vi.mock('../../../hooks/useCertificates', () => ({
  useCertificates: () => ({
    data: [{ subject: 'CN=dsf.ukm.de', thumbprint: 'AB12', valid_until: '2027-03-01' }],
  }),
}));
vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({ data: [] }),
}));

import { SearchBar } from '../SearchBar';

function search(value: string) {
  const input = screen.getByPlaceholderText(/search entities/i);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  return input;
}

afterEach(() => {
  document.getElementById('card-contacts')?.remove();
});

describe('SearchBar', () => {
  it('renders the search input with its placeholder', () => {
    renderWithProviders(<SearchBar />);
    expect(screen.getByPlaceholderText(/search entities/i)).toBeInTheDocument();
    // Ctrl+K is the command palette's shortcut, no longer advertised here.
    expect(screen.getByPlaceholderText(/search entities/i)).not.toHaveAttribute(
      'placeholder',
      expect.stringContaining('Ctrl+K'),
    );
  });

  it('shows a matching contact result when a query is typed', () => {
    renderWithProviders(<SearchBar />);
    search('ada');
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('labels result types and dates in the app language', () => {
    renderWithProviders(<SearchBar />, { lang: 'de' });
    fireEvent.focus(screen.getByPlaceholderText(/entitäten suchen/i));
    fireEvent.change(screen.getByPlaceholderText(/entitäten suchen/i), {
      target: { value: 'ukm' },
    });
    expect(screen.getByRole('option', { name: 'Kontakt: Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Zertifikat: CN=dsf.ukm.de' })).toHaveTextContent(
      'Gültig bis 01.03.2027',
    );
  });

  it('drops the results down as an origin-aware glass popover', () => {
    renderWithProviders(<SearchBar />);
    search('ada');
    const panel = screen.getByRole('listbox', { name: 'Search results' }).parentElement;
    expect(panel?.className).toContain('glass-thin');
    expect(panel?.className).toContain('origin-top');
    expect(panel?.className).toContain('data-[state=open]:animate-popover-in');
  });

  it('highlights and scrolls to the chosen card', async () => {
    const user = userEvent.setup();
    const card = document.createElement('div');
    card.id = 'card-contacts';
    card.scrollIntoView = vi.fn();
    document.body.appendChild(card);
    renderWithProviders(<SearchBar />);

    search('ada');
    await user.click(screen.getByRole('option', { name: 'Contact: Ada Lovelace' }));

    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(screen.getByPlaceholderText(/search entities/i)).toHaveValue('');
  });

  it('closes and clears on Escape in the field, marking the key as handled', async () => {
    renderWithProviders(<SearchBar />);
    const input = search('ada');

    const notCancelled = fireEvent.keyDown(input, { key: 'Escape' });

    expect(notCancelled).toBe(false);
    expect(input).toHaveValue('');
    await waitFor(() => expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument());
  });

  it('ignores Escape and Ctrl+K pressed outside the search', () => {
    renderWithProviders(<SearchBar />);
    const input = search('ada');
    input.blur();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });

    expect(input).toHaveValue('ada');
    expect(input).not.toHaveFocus();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('closes on a pointer-down outside the search', async () => {
    renderWithProviders(
      <div>
        <SearchBar />
        <p>elsewhere</p>
      </div>,
    );
    search('ada');

    fireEvent.pointerDown(screen.getByText('elsewhere'));

    await waitFor(() => expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument());
  });
});
