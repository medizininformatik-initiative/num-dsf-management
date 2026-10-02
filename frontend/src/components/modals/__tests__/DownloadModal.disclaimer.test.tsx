import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { DownloadModal } from '../DownloadModal';

// One endpoint, so the endpoint bundle has something to download.
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: [{ identifier: 'fhir.ukm.de' }], isLoading: false }),
}));

// BundlePreview pulls more API state we don't care about for this gate.
vi.mock('../BundlePreview', () => ({
  BundlePreview: () => null,
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

const downloadButtons = () => [
  screen.getByTestId('download-bundle-btn'),
  screen.getByTestId('download-full-bundle-btn'),
  screen.getByTestId('download-ip-btn'),
];

describe('DownloadModal disclaimer gate', () => {
  it('renders the disclaimer block and keeps every download button disabled initially', () => {
    render(
      <Wrapper>
        <DownloadModal open={true} onClose={() => {}} instanceId="i1" />
      </Wrapper>,
    );

    expect(screen.getByTestId('bundle-disclaimer')).toBeInTheDocument();
    const checkbox = screen.getByTestId('disclaimer-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    for (const button of downloadButtons()) expect(button).toBeDisabled();
    // The disabled buttons point at the reason.
    expect(screen.getByTestId('download-bundle-btn')).toHaveAccessibleDescription(
      'Confirm the notice above to enable the downloads.',
    );
  });

  it('enables every download button once the operator ticks the acknowledgment', () => {
    render(
      <Wrapper>
        <DownloadModal open={true} onClose={() => {}} instanceId="i1" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId('disclaimer-checkbox'));

    for (const button of downloadButtons()) expect(button).toBeEnabled();
  });
});
