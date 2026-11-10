import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import { installAuthInterceptor } from './api/authInterceptor';
import { useAuthStore } from './stores/auth.store';
import { ToastProvider } from './components/ToastProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthBootstrap } from './components/AuthBootstrap';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { getErrorMessage } from './lib/getErrorMessage';
import './index.css';
import './stores/theme.store';

// Demo mode — intercept all API calls with static mock data and pre-authenticate
if (import.meta.env.VITE_DEMO === 'true') {
  // Set auth state synchronously so RequireAuth guards don't redirect to /login
  useAuthStore.setState({
    accessToken: 'demo-token',
    user: { id: '00000000-0000-4000-8000-000000000001', email: 'demo@imi-test.example.de' },
    isAuthenticated: true,
  });
}

installAuthInterceptor();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // 429: retrying immediately only deepens the throttle.
        if ([401, 403, 404, 429].includes(error?.response?.status)) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (error: any) => {
        const msg = getErrorMessage(error, '');
        if (msg && !msg.includes('ALREADY_')) {
          console.error('[Mutation]', msg);
        }
      },
    },
  },
});

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ConfirmProvider>
            <AuthBootstrap>
              <RouterProvider router={router} />
            </AuthBootstrap>
          </ConfirmProvider>
          <ToastProvider />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// Demo mode: the mock adapter must be registered before the first request,
// otherwise early requests race it and the app can hang on a loading state.
if (import.meta.env.VITE_DEMO === 'true') {
  import('./api/mock-adapter').then((m) => {
    m.setupMockAdapter();
    renderApp();
  });
} else {
  renderApp();
}
