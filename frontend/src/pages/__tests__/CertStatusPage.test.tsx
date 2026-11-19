/**
 * CertStatusPage.test.tsx — the cert-variant sign-in status screen on the
 * shared auth layout: the checking state is a status without a retry button,
 * a failure is announced as an alert with the code-specific message and a
 * Retry button, and unknown codes fall back to the generic message. The
 * decorative certificate-check visual shows only while checking.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { CertStatusPage } from '../CertStatusPage';

describe('CertStatusPage', () => {
  it('announces the not-registered message for CERT_NOT_REGISTERED with a retry', () => {
    renderWithProviders(<CertStatusPage code="CERT_NOT_REGISTERED" />);
    expect(screen.getByRole('heading', { name: 'Certificate sign-in' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /not enabled for sign-in.*IMI admin.*certificates card/i,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('cert-checking')).not.toBeInTheDocument();
  });

  it('tells the user the proxy is misconfigured for PROXY_NOT_TRUSTED, not that no certificate was sent', () => {
    renderWithProviders(<CertStatusPage code="PROXY_NOT_TRUSTED" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /received your certificate.*proxy configuration is incomplete.*IMI operator/i,
    );
    expect(screen.queryByText(/No client certificate was presented/)).not.toBeInTheDocument();
  });

  it('shows the checking state when code is null', () => {
    renderWithProviders(<CertStatusPage code={null} />);
    expect(screen.getByRole('status')).toHaveTextContent(/checking your certificate/i);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByTestId('cert-checking')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/presenting your client certificate/i)).toBeInTheDocument();
  });

  it('falls back to the generic message for an unknown code', () => {
    renderWithProviders(<CertStatusPage code="WHATEVER" />);
    expect(screen.getByText(/sign-in with your certificate failed/i)).toBeInTheDocument();
  });
});
