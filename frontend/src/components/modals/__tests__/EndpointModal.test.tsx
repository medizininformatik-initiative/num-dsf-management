/**
 * EndpointModal.test.tsx — open/close, edits surviving a background refetch,
 * and the IP rows: a new endpoint starts without rows, "Add IP address"
 * appends a focused row, an invalid row shows its own announced error wired
 * through aria-invalid/aria-describedby (no silent failure), and a row's
 * named remove button collapses it and moves focus to its neighbour.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EndpointModal } from '../EndpointModal';

const createEndpoint = vi.hoisted(() => vi.fn());

const initialEndpoints = () => [
  {
    identifier: 'ep1',
    name: 'Original',
    address: 'https://orig.example.de/dsf',
    ipAddresses: [{ ip: '10.0.0.1', isFhir: true, isBpe: false }],
  },
];
let endpointsArr: any[] = initialEndpoints();

// Reset the mutable fixture before each test so order/shuffle cannot leak the
// refetch test's mutation into the others.
beforeEach(() => {
  endpointsArr = initialEndpoints();
  createEndpoint.mockReset().mockResolvedValue(undefined);
});

vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: endpointsArr, isLoading: false }),
  useCreateEndpoint: () => ({ mutateAsync: createEndpoint, isPending: false }),
  useUpdateEndpoint: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEndpoint: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

function renderAdd() {
  return render(
    <Wrapper>
      <EndpointModal open onClose={() => {}} instanceId="i1" />
    </Wrapper>,
  );
}

function addIp() {
  fireEvent.click(screen.getByRole('button', { name: /add ip address/i }));
}

describe('EndpointModal open/close', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Wrapper>
        <EndpointModal open={false} onClose={() => {}} instanceId="i1" />
      </Wrapper>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the add title and an identifier field when open', () => {
    renderAdd();
    expect(screen.getByRole('heading', { name: /add new endpoint/i })).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-identifier-input')).toBeInTheDocument();
  });
});

describe('EndpointModal', () => {
  it('does not overwrite user input when endpoints list refetches', async () => {
    const { rerender } = render(
      <Wrapper>
        <EndpointModal open={true} onClose={() => {}} instanceId="i1" endpointId="ep1" />
      </Wrapper>,
    );

    const addressInput = screen.getByDisplayValue(
      'https://orig.example.de/dsf',
    ) as HTMLInputElement;
    // Set the value atomically — char-by-char typing races under CI load and
    // can truncate the string; this test only needs the field to hold an edit.
    fireEvent.change(addressInput, { target: { value: 'https://new.example.de/dsf' } });
    expect(addressInput.value).toBe('https://new.example.de/dsf');

    // Simulate background refetch: same data, new array reference.
    endpointsArr = [...endpointsArr];
    rerender(
      <Wrapper>
        <EndpointModal open={true} onClose={() => {}} instanceId="i1" endpointId="ep1" />
      </Wrapper>,
    );

    expect((screen.getByDisplayValue('https://new.example.de/dsf') as HTMLInputElement).value).toBe(
      'https://new.example.de/dsf',
    );
  });
});

describe('EndpointModal IP rows', () => {
  it('starts a new endpoint without IP rows', () => {
    renderAdd();
    expect(screen.queryByRole('textbox', { name: /ip address 1/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no ip addresses yet/i)).toBeInTheDocument();
  });

  it('adds a row and focuses its address field', async () => {
    renderAdd();
    addIp();
    const ip = await screen.findByRole('textbox', { name: 'IP address 1' });
    await waitFor(() => expect(ip).toHaveFocus());
  });

  it('submits an endpoint without IP addresses', async () => {
    renderAdd();
    fireEvent.change(screen.getByTestId('endpoint-identifier-input'), {
      target: { value: 'dsf-fhir.hospital.de' },
    });
    fireEvent.change(screen.getByPlaceholderText(/dsf-fhir\.hospital\.de\/fhir/i), {
      target: { value: 'https://dsf-fhir.hospital.de/fhir' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add endpoint/i }));
    await waitFor(() =>
      expect(createEndpoint).toHaveBeenCalledWith(expect.objectContaining({ ipAddresses: [] })),
    );
  });

  it('shows the error of an invalid row instead of failing silently', async () => {
    renderAdd();
    fireEvent.change(screen.getByTestId('endpoint-identifier-input'), {
      target: { value: 'dsf-fhir.hospital.de' },
    });
    fireEvent.change(screen.getByPlaceholderText(/dsf-fhir\.hospital\.de\/fhir/i), {
      target: { value: 'https://dsf-fhir.hospital.de/fhir' },
    });
    addIp();
    fireEvent.click(screen.getByRole('button', { name: /add endpoint/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/valid IPv4 address/i);
    const ip = screen.getByRole('textbox', { name: 'IP address 1' });
    expect(ip).toHaveAttribute('aria-invalid', 'true');
    expect(ip.getAttribute('aria-describedby')).toBe(alert.id);
    expect(createEndpoint).not.toHaveBeenCalled();
  });

  it('removes a row through its named button and focuses the next row', async () => {
    renderAdd();
    addIp();
    addIp();
    fireEvent.change(await screen.findByRole('textbox', { name: 'IP address 1' }), {
      target: { value: '10.0.0.1' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'IP address 2' }), {
      target: { value: '10.0.0.2' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove IP address 1' }));
    expect(screen.getByDisplayValue('10.0.0.2')).toHaveFocus();

    await waitFor(() => expect(screen.queryByDisplayValue('10.0.0.1')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'IP address 1' })).toHaveValue('10.0.0.2');
    expect(screen.queryByRole('textbox', { name: 'IP address 2' })).not.toBeInTheDocument();
  });
});
