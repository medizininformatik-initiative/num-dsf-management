/**
 * CertificatePurposeControls.test.tsx — the two per-certificate checkboxes ("Publish in allow
 * list", "Use for login"): they reflect the flags (a missing flag counts as set), save the one
 * that was toggled and toast success or the backend error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useCertificates', () => ({
  useUpdateCertificatePurpose: () => ({ mutate, isPending: false }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { CertificatePurposeControls } from '../CertificatePurposeControls';

beforeEach(() => {
  mutate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('CertificatePurposeControls', () => {
  it('treats missing flags as set and shows the explanation', () => {
    renderWithProviders(<CertificatePurposeControls instanceId="i1" cert={{ id: 'c1' }} />);
    expect(screen.getByLabelText('Publish in allow list')).toBeChecked();
    expect(screen.getByLabelText('Use for login')).toBeChecked();
    expect(screen.getByText(/Changes apply after the next approval/)).toBeInTheDocument();
  });

  it('saves the toggled flag only and toasts success', () => {
    mutate.mockImplementation((_v, opts) => opts.onSuccess());
    renderWithProviders(
      <CertificatePurposeControls
        instanceId="i1"
        cert={{ id: 'c1', publishInAllowlist: true, useForLogin: false }}
      />,
    );
    expect(screen.getByLabelText('Use for login')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Publish in allow list'));
    expect(mutate).toHaveBeenCalledWith(
      { certId: 'c1', patch: { publishInAllowlist: false } },
      expect.any(Object),
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('toasts the error of a failed save', () => {
    mutate.mockImplementation((_v, opts) =>
      opts.onError({ response: { data: { error: { message: 'Nope' } } } }),
    );
    renderWithProviders(<CertificatePurposeControls instanceId="i1" cert={{ id: 'c1' }} />);
    fireEvent.click(screen.getByLabelText('Use for login'));
    expect(toast.error).toHaveBeenCalledWith('Nope');
  });
});
