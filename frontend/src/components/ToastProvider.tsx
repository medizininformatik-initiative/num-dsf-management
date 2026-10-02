/**
 * ToastProvider.tsx — mounts the sonner Toaster once at the app root:
 * bottom-right, rich colours, and the theme taken from the theme store so
 * toasts follow the app's light/dark mode rather than a fixed palette.
 * Branding goes through classNames (.dsf-toast in src/index.css: glass
 * material for neutral toasts); sonner keeps its own reduced-motion handling.
 * Dependencies: sonner, theme store.
 */
import { Toaster } from 'sonner';
import { useThemeStore } from '../stores/theme.store';

export function ToastProvider() {
  const dark = useThemeStore((s) => s.dark);
  return (
    <Toaster
      position="bottom-right"
      theme={dark ? 'dark' : 'light'}
      richColors
      toastOptions={{ classNames: { toast: 'dsf-toast' } }}
    />
  );
}
