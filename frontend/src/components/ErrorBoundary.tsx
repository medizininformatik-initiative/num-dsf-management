/**
 * ErrorBoundary.tsx — React class boundary that catches render errors in its subtree.
 * Logs to console and shows a reload fallback (with error message in dev builds) on
 * the same solid card as the not-found page, in theme tokens so it follows dark mode.
 * Dependencies: i18n store, Icon, the .surface-card and .btn classes (src/index.css).
 */
import { Component, ErrorInfo, ReactNode } from 'react';
import { useI18n } from '../stores/i18n.store';
import { Icon } from './ui/Icon';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const t = useI18n.getState().t;
      return (
        <div className="flex min-h-screen items-center justify-center bg-[color:var(--bg-page)] p-6">
          <div className="surface-card flex w-full max-w-md flex-col items-center px-8 py-10 text-center">
            <Icon name="error" size={40} className="mb-4 text-danger-fg" />
            <h1 className="mb-2 text-2xl font-semibold text-[color:var(--text-primary)]">
              {t('errorBoundaryTitle')}
            </h1>
            <p className="mb-6 text-sm text-[color:var(--text-secondary)]">
              {t('errorBoundaryBody')}
            </p>
            {import.meta.env.DEV && this.state.error && (
              <pre className="mb-6 max-h-32 w-full overflow-auto rounded-control bg-[color:var(--bg-hover)] p-3 text-left font-mono text-2xs text-danger-fg">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="btn btn-primary btn-md press-effect"
            >
              {t('errorBoundaryReload')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
