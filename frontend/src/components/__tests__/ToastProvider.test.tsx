import { describe, it, expect, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { renderWithProviders } from '../../test/renderWithProviders';
import { ToastProvider } from '../ToastProvider';
import { useThemeStore } from '../../stores/theme.store';

describe('ToastProvider', () => {
  afterEach(() => {
    act(() => toast.dismiss());
    useThemeStore.setState({ dark: false });
  });

  it('mounts the sonner Toaster without crashing', () => {
    // ToastProvider takes no children — it only mounts the sonner <Toaster/>.
    // sonner lazily renders its toaster region (into a portal) and may not emit
    // a DOM node until a toast is enqueued, so the meaningful assertion here is
    // that mounting the provider does not throw.
    expect(() => renderWithProviders(<ToastProvider />)).not.toThrow();
  });

  it('brands toasts through a class instead of inline colours, so rich colours apply', async () => {
    renderWithProviders(<ToastProvider />);
    act(() => {
      toast.success('Contact saved');
    });

    const item = (await screen.findByText('Contact saved')).closest('[data-sonner-toast]');
    expect(item).toHaveClass('dsf-toast');
    expect(item).toHaveAttribute('data-rich-colors', 'true');
    expect((item as HTMLElement).style.background).toBe('');
    expect((item as HTMLElement).style.color).toBe('');
  });

  it('follows the theme store', async () => {
    useThemeStore.setState({ dark: true });
    renderWithProviders(<ToastProvider />);
    act(() => {
      toast('Bundle downloaded');
    });

    const item = await screen.findByText('Bundle downloaded');
    expect(item.closest('[data-sonner-toaster]')).toHaveAttribute('data-theme', 'dark');
  });
});
