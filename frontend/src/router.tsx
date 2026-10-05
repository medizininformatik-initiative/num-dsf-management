/**
 * router.tsx – React Router v6 configuration
 * Public routes: /login, /otp, /totp-setup, /totp
 * Protected routes: /app (canvas), /app/audit
 */
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { OtpPage } from './pages/OtpPage';
import { TotpSetupPage } from './pages/TotpSetupPage';
import { TotpPage } from './pages/TotpPage';
import { AppPage } from './pages/AppPage';
import { AuditPage } from './pages/AuditPage';
import { AdminPage } from './pages/AdminPage';
import { AdminHelpPage } from './pages/AdminHelpPage';
import { HelpPage } from './pages/HelpPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminPromotionsPage } from './pages/AdminPromotionsPage';
import { AdminCaBlacklistPage } from './pages/AdminCaBlacklistPage';
import { AdminBundleVersionsPage } from './pages/AdminBundleVersionsPage';
import { AdminOnboardingPage } from './pages/AdminOnboardingPage';
import { MapPage } from './pages/MapPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { MarketplaceDetailPage } from './pages/MarketplaceDetailPage';
import { DsfResourcesPage } from './pages/DsfResourcesPage';
import { LegalPage } from './pages/LegalPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useAuthStore } from './stores/auth.store';
import { isCertMode } from './lib/authMode';
import { CrossUserGuardProvider } from './components/layout/CrossUserGuardProvider';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return <Navigate to={isAuthenticated ? '/app' : '/login'} replace />;
}

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  // In the cert deployment variant there is no login screen — AuthBootstrap
  // owns the unauthenticated UX, so the OTP routes just bounce to root.
  { path: '/login', element: isCertMode() ? <Navigate to="/" replace /> : <LoginPage /> },
  { path: '/otp', element: isCertMode() ? <Navigate to="/" replace /> : <OtpPage /> },
  {
    path: '/totp-setup',
    element: isCertMode() ? <Navigate to="/" replace /> : <TotpSetupPage />,
  },
  { path: '/totp', element: isCertMode() ? <Navigate to="/" replace /> : <TotpPage /> },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <CrossUserGuardProvider>
          <AppPage />
        </CrossUserGuardProvider>
      </RequireAuth>
    ),
    children: [
      { index: true, element: null },
      { path: 'audit', element: <AuditPage /> },
      { path: 'admin', element: <AdminPage /> },
      { path: 'admin/help', element: <AdminHelpPage /> },
      { path: 'admin/users', element: <AdminUsersPage /> },
      { path: 'admin/promotions', element: <AdminPromotionsPage /> },
      { path: 'admin/ca-blacklist', element: <AdminCaBlacklistPage /> },
      { path: 'admin/bundle-versions', element: <AdminBundleVersionsPage /> },
      { path: 'admin/onboarding', element: <AdminOnboardingPage /> },
      // The instance status page was folded into the overview and the approval flow.
      { path: 'status', element: <Navigate to="/app" replace /> },
      { path: 'map', element: <MapPage /> },
      { path: 'marketplace', element: <MarketplacePage /> },
      { path: 'marketplace/:slug', element: <MarketplaceDetailPage /> },
      { path: 'resources', element: <DsfResourcesPage /> },
      { path: 'help', element: <HelpPage /> },
      { path: 'legal', element: <LegalPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
