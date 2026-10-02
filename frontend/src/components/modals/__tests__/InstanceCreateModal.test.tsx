import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

const createInstance = vi.hoisted(() => vi.fn());
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ createInstance }),
}));

import { InstanceCreateModal } from '../InstanceCreateModal';

beforeEach(() => {
  createInstance.mockReset();
});

describe('InstanceCreateModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <InstanceCreateModal open={false} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the title and the create button when open', () => {
    renderWithProviders(<InstanceCreateModal open onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: /add new instance/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create instance/i })).toBeInTheDocument();
  });

  it('shows the busy label while creating and closes when done', async () => {
    let finish: (value: unknown) => void = () => {};
    createInstance.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onClose = vi.fn();
    renderWithProviders(<InstanceCreateModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /create instance/i }));
    expect(await screen.findByRole('button', { name: /creating/i })).toBeDisabled();

    finish({ data: { data: { id: 'new-instance' } } });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
