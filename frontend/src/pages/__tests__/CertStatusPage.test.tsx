/**
 * CertStatusPage.test.tsx — the cert-variant sign-in status screen on the
 * shared auth layout: the checking state is a status without a retry button,
 * a failure is announced as an alert with the code-specific message and a
 * Retry button, and unknown codes fall back to the generic message.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { CertStatusPage } from '../CertStatusPage';

describe('CertStatusPage', () => {
  it('announces the not-registered message for CERT_NOT_REGISTERED with a retry', () => {
    renderWithProviders(<CertStatusPage code="CERT_NOT_REGISTERED" />);
    expect(screen.getByRole('heading', { name: 'Certificate sign-in' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/not in the allow-list/i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the checking state when code is null', () => {
    renderWithProviders(<CertStatusPage code={null} />);
    expect(screen.getByRole('status')).toHaveTextContent(/checking your certificate/i);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('falls back to the generic message for an unknown code', () => {
    renderWithProviders(<CertStatusPage code="WHATEVER" />);
    expect(screen.getByText(/sign-in with your certificate failed/i)).toBeInTheDocument();
  });
});
