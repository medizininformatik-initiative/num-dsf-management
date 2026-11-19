/**
 * PurgeAllowListSection.test.tsx — the purge "danger zone": the consequences are always shown,
 * the purge URL and the curl command stay hidden until the endpoint identifier is typed exactly,
 * and both can be copied.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { PurgeAllowListSection } from '../PurgeAllowListSection';

const ENDPOINT = 'dsf.klinik.example.de';
const URL = `https://portal.example.de/fhir/Bundle/${ENDPOINT}/purge`;

function setup() {
  const onCopy = vi.fn();
  renderWithProviders(
    <PurgeAllowListSection endpointId={ENDPOINT} purgeUrl={URL} onCopy={onCopy} />,
  );
  return { onCopy, input: screen.getByLabelText(`Type ${ENDPOINT} to show the purge link`) };
}

describe('PurgeAllowListSection', () => {
  it('explains the consequences and hides the link at first', () => {
    setup();
    expect(screen.getByTestId('purge-section')).toHaveTextContent(
      /Communication with all other sites stops/,
    );
    expect(screen.queryByTestId('purge-unlocked')).toBeNull();
    expect(screen.queryByText(URL)).toBeNull();
  });

  it('stays locked for a wrong or partial phrase', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'dsf.klinik' } });
    expect(screen.queryByTestId('purge-unlocked')).toBeNull();
    fireEvent.change(input, { target: { value: `${ENDPOINT}x` } });
    expect(screen.queryByTestId('purge-unlocked')).toBeNull();
  });

  it('shows the URL and the curl command after the endpoint was typed, and copies them', () => {
    const { input, onCopy } = setup();
    fireEvent.change(input, { target: { value: ENDPOINT } });
    expect(screen.getByTestId('purge-unlocked')).toBeInTheDocument();
    expect(screen.getByText(URL)).toBeInTheDocument();
    const curl = screen.getByText(/^curl --cert client_certificate\.pem/);
    expect(curl).toHaveTextContent(`-o dsf-allow-list-purge.json '${URL}'`);

    fireEvent.click(screen.getByRole('button', { name: /purge URL/ }));
    expect(onCopy).toHaveBeenCalledWith(URL);
    fireEvent.click(screen.getByRole('button', { name: /purge curl command/ }));
    expect(onCopy).toHaveBeenLastCalledWith(curl.textContent);
  });
});
