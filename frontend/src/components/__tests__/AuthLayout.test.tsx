/**
 * AuthLayout.test.tsx — shared auth-page shell. Covers branding (IMI logo,
 * the BrandMark "DSF Management Tool", "Allow List Management"), the
 * title/subtitle, children rendering inside the glass card, the translated
 * footer, both environment-badge branches (white text on lib/environment's
 * accent), and the motion contract: the first card springs in, later steps
 * slide in reading direction, `success` swaps in the check, and the ambient
 * background pauses while the tab is hidden.
 *
 * lib/environment reads `import.meta.env.VITE_DSF_ENVIRONMENT` at module load
 * into module-level constants, so the PRODUCTION branch is exercised by
 * stubbing the env, resetting the module registry, and re-importing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadAuthLayout() {
  vi.resetModules();
  return (await import('../AuthLayout')).AuthLayout;
}

describe('AuthLayout', () => {
  it('renders branding, the IMI logo, title/subtitle and children', async () => {
    const AuthLayout = await loadAuthLayout();
    render(
      <AuthLayout title="Sign in" subtitle="Enter your email to continue">
        <button type="button">Request code</button>
      </AuthLayout>,
    );

    // BrandMark (decorative glyph + product name) + product line.
    expect(screen.getByText('DSF Management Tool')).toBeInTheDocument();
    expect(screen.getByTestId('brand-mark-glyph')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Allow List Management')).toBeInTheDocument();

    // IMI logo (linked to the institute).
    const logo = screen.getByAltText('Institute of Medical Informatics');
    expect(logo).toHaveAttribute('src', '/logos/IMI-Logo-grad-eng.png');

    // Title + subtitle passed via props.
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Enter your email to continue')).toBeInTheDocument();

    // Children render inside the card.
    expect(screen.getByRole('button', { name: 'Request code' })).toBeInTheDocument();

    // Impressum footer link.
    expect(screen.getByRole('link', { name: 'Impressum' })).toHaveAttribute(
      'href',
      'https://medic.uni-muenster.de/impressum/',
    );
  });

  it('omits the subtitle paragraph when none is provided', async () => {
    const AuthLayout = await loadAuthLayout();
    render(
      <AuthLayout title="One-time code">
        <span>inner</span>
      </AuthLayout>,
    );

    expect(screen.getByRole('heading', { name: 'One-time code' })).toBeInTheDocument();
    expect(screen.getByText('inner')).toBeInTheDocument();
    // No subtitle text leaked when the prop is absent.
    expect(screen.queryByText('Enter your email to continue')).not.toBeInTheDocument();
  });

  it('shows the TEST badge in the shared teal environment accent by default', async () => {
    const AuthLayout = await loadAuthLayout();
    render(
      <AuthLayout title="Sign in">
        <span>child</span>
      </AuthLayout>,
    );

    const badge = screen.getByText('TEST');
    expect(badge).toBeInTheDocument();
    // White text on ENV_ACCENT (lib/environment), the AA pairing the app chrome uses.
    expect(badge).toHaveStyle({ backgroundColor: '#115e59' });
    expect(badge).toHaveClass('text-white');
    expect(screen.queryByText('PRODUCTION')).not.toBeInTheDocument();
  });

  it('shows the PRODUCTION badge in the shared blue accent when configured', async () => {
    vi.stubEnv('VITE_DSF_ENVIRONMENT', 'PRODUCTION');
    const AuthLayout = await loadAuthLayout();
    render(
      <AuthLayout title="Sign in">
        <span>child</span>
      </AuthLayout>,
    );

    const badge = screen.getByText('PRODUCTION');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({ backgroundColor: '#1d4ed8' });
    expect(screen.queryByText('TEST')).not.toBeInTheDocument();
  });

  it('puts the content on a glass card that springs in, with translated footer text', async () => {
    const AuthLayout = await loadAuthLayout();
    render(
      <AuthLayout title="Sign in">
        <span>child</span>
      </AuthLayout>,
    );

    const card = screen.getByRole('main');
    expect(card).toHaveClass('glass-thick', 'animate-auth-card-in');
    expect(card).toContainElement(screen.getByRole('heading', { name: 'Sign in' }));
    expect(screen.getByText('In cooperation with')).toBeInTheDocument();
    expect(
      screen.getByText('Institute of Medical Informatics, University of Münster'),
    ).toBeInTheDocument();
  });

  it('keeps the card on later steps and slides the content in reading direction', async () => {
    const AuthLayout = await loadAuthLayout();
    const first = render(
      <AuthLayout title="Email" step={0}>
        <span>email</span>
      </AuthLayout>,
    );
    first.unmount();

    const forward = render(
      <AuthLayout title="Code" step={1}>
        <span>code</span>
      </AuthLayout>,
    );
    expect(screen.getByRole('main')).not.toHaveClass('animate-auth-card-in');
    expect(screen.getByRole('heading', { name: 'Code' }).parentElement).toHaveClass(
      'animate-auth-step-forward',
    );
    forward.unmount();

    render(
      <AuthLayout title="Email again" step={0}>
        <span>email</span>
      </AuthLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Email again' }).parentElement).toHaveClass(
      'animate-auth-step-back',
    );
  });

  it('slides between steps of the same instance', async () => {
    const AuthLayout = await loadAuthLayout();
    const { rerender } = render(
      <AuthLayout title="Scan" step={2}>
        <span>qr</span>
      </AuthLayout>,
    );
    rerender(
      <AuthLayout title="Confirm" step={3}>
        <span>confirm</span>
      </AuthLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Confirm' }).parentElement).toHaveClass(
      'animate-auth-step-forward',
    );
    rerender(
      <AuthLayout title="Scan" step={2}>
        <span>qr</span>
      </AuthLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Scan' }).parentElement).toHaveClass(
      'animate-auth-step-back',
    );
  });

  it('replaces the content with the success check and a status', async () => {
    const AuthLayout = await loadAuthLayout();
    render(
      <AuthLayout title="Two-factor" success="Signed in.">
        <button type="button">Sign in</button>
      </AuthLayout>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Signed in.');
    expect(screen.getByTestId('auth-check')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('pauses the ambient background while the tab is hidden', async () => {
    const AuthLayout = await loadAuthLayout();
    render(
      <AuthLayout title="Sign in">
        <span>child</span>
      </AuthLayout>,
    );
    const ambient = screen.getByTestId('auth-ambient');
    expect(ambient).toHaveAttribute('aria-hidden', 'true');
    expect(ambient).not.toHaveAttribute('data-paused');

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(ambient).toHaveAttribute('data-paused');

    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(ambient).not.toHaveAttribute('data-paused');
    hidden.mockRestore();
  });
});
