/**
 * AppPage.tsx — Authenticated app shell: the Sidebar, the TopBar over the
 * routed content (banners, Breadcrumbs, canvas or Outlet, AppFooter) and, on
 * the canvas route, the instance status panel (RightPanel) in a column that
 * starts below the TopBar, so it never covers the TopBar's actions.
 *
 * Wide layout (>= 1200 px): both panels are persistent columns the user can
 * collapse to a rail and expand again (smooth width/opacity transition).
 * Narrow layout: the TopBar spans the full width, both panels show as rails
 * below it, and their buttons open the full panel as a modal Drawer. The
 * column choices survive resizing; crossing the breakpoint (useWideLayout, a
 * matchMedia listener) or navigating only closes an open drawer.
 *
 * The Outlet wrapper is a flex column so route components with `flex: 1`
 * roots (Map, Admin lists) fill the viewport while block-rooted routes
 * (Legal) take natural height and the footer stays pinned.
 *
 * Dependencies: stores/canvas, stores/i18n, hooks/useInstance, useModals,
 * useOrganization, usePresence, lib/motion, layout/* (Sidebar, TopBar,
 * RightPanel, Drawer, useWideLayout, …), canvas/*, modals/*, ui/*.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router-dom';
import { useCanvasStore } from '../stores/canvas.store';
import { useI18n } from '../stores/i18n.store';
import { useInstances } from '../hooks/useInstance';
import { useModals } from '../hooks/useModals';
import { useOrganization } from '../hooks/useOrganization';
import { usePresence } from '../hooks/usePresence';
import { MOTION_MS } from '../lib/motion';
import { Sidebar, type SidebarGroup } from '../components/layout/Sidebar';
import { TopBar } from '../components/layout/TopBar';
import { RightPanel } from '../components/layout/RightPanel';
import { Drawer } from '../components/layout/Drawer';
import { useWideLayout } from '../components/layout/useWideLayout';
import { EntityCanvas } from '../components/canvas/EntityCanvas';
import { OrganizationModal } from '../components/modals/OrganizationModal';
import { ContactModal } from '../components/modals/ContactModal';
import { EndpointModal } from '../components/modals/EndpointModal';
import { CertificateModal } from '../components/modals/CertificateModal';
import { MembershipModal } from '../components/modals/MembershipModal';
import { ApprovalModal } from '../components/modals/ApprovalModal';
import { DownloadModal } from '../components/modals/DownloadModal';
import { CertRenewalModal } from '../components/modals/CertRenewalModal';
import { ExpiryWarningBanner } from '../components/layout/ExpiryWarningBanner';
import { CrossUserInstanceBanner } from '../components/layout/CrossUserInstanceBanner';
import { Breadcrumbs } from '../components/layout/Breadcrumbs';
import { AppFooter } from '../components/layout/AppFooter';
import { MapHeader } from '../components/map/MapHeader';
import { ActivityFeed } from '../components/canvas/ActivityFeed';
import { CommandPalette } from '../components/layout/CommandPalette';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { CardSkeleton } from '../components/ui/Skeleton';

const NAV_COLUMN_ID = 'app-sidebar';
const NAV_DRAWER_ID = 'app-nav-drawer';
const PANEL_COLUMN_ID = 'app-status-panel';
const PANEL_DRAWER_ID = 'app-status-drawer';

// Width changes run on the medium duration; the panel content stays mounted
// that long while its column collapses.
const COLUMN_MOTION = 'transition-[width] duration-medium ease-standard';

type DrawerState = { kind: 'nav'; group?: SidebarGroup } | { kind: 'panel' } | null;

/** Header row above the status panel: its label and the collapse/close button. */
function PanelHeader({
  titleId,
  className = '',
  children,
}: {
  titleId: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`flex h-12 shrink-0 items-center justify-between gap-2 pl-4 pr-1.5 ${className}`}
    >
      <p
        id={titleId}
        className="truncate text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]"
      >
        {t('shellStatusPanel')}
      </p>
      {children}
    </div>
  );
}

/** Shown on the canvas route while no instance is active. */
function InstancePlaceholder({ loading }: { loading: boolean }) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div role="status" className="min-h-0 flex-1 overflow-hidden p-4">
        <span className="sr-only">{t('shellLoadingInstance')}</span>
        <div
          aria-hidden="true"
          className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 2xl:grid-cols-3"
        >
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <Icon name="dns" size={32} className="text-[color:var(--text-muted)]" />
      <p className="text-sm font-semibold text-[color:var(--text-primary)]">
        {t('noInstanceSelected')}
      </p>
      <p className="max-w-xs text-xs text-[color:var(--text-muted)]">{t('shellNoInstanceHint')}</p>
    </div>
  );
}

export function AppPage() {
  const { t } = useI18n();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const isCanvasRoute = !!useMatch('/app');
  const isMapRoute = !!useMatch('/app/map');
  const { pathname } = useLocation();
  const { data: instances, isLoading: instancesLoading } = useInstances();

  const { open, editId, openModal, closeModal } = useModals();
  const { data: org } = useOrganization(activeInstanceId);

  const orgDefaults = useMemo(
    () =>
      org
        ? {
            identifier: org.identifier,
            name: org.name,
            active: !!org.active,
            email: org.email,
            addressLine: org.address_line || '',
            postalCode: org.postal_code || '',
            city: org.city || '',
            countryCode: org.country_code || '',
            clientCertThumbprint: org.client_cert_thumbprint || '',
          }
        : undefined,
    [org],
  );

  const isWide = useWideLayout();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const navCloseRef = useRef<HTMLButtonElement>(null);
  const panelCloseRef = useRef<HTMLButtonElement>(null);
  const panelTitleId = useId();
  const panelDrawerTitleId = useId();

  // Drawers belong to the narrow layout: crossing the breakpoint or navigating
  // closes them, while the user's column choices stay as they are.
  useEffect(() => setDrawer(null), [isWide, pathname]);

  const navExpanded = isWide && !navCollapsed;
  const navDrawerOpen = !isWide && drawer?.kind === 'nav';
  const panelExpanded = isWide && !panelCollapsed;
  const panelDrawerOpen = !isWide && drawer?.kind === 'panel';
  const panelContent = usePresence(panelExpanded, MOTION_MS.medium);

  function expandNav(group?: SidebarGroup) {
    if (isWide) setNavCollapsed(false);
    else setDrawer({ kind: 'nav', group });
  }

  function expandPanel() {
    if (isWide) setPanelCollapsed(false);
    else setDrawer({ kind: 'panel' });
  }

  const sidebarColumn = (
    <div
      id={NAV_COLUMN_ID}
      className={`h-full shrink-0 overflow-hidden print:hidden ${COLUMN_MOTION} ${
        navExpanded ? 'w-[220px]' : 'w-16'
      }`}
    >
      <Sidebar
        variant={navExpanded ? 'full' : 'rail'}
        onToggle={navExpanded ? () => setNavCollapsed(true) : expandNav}
        controls={isWide ? NAV_COLUMN_ID : NAV_DRAWER_ID}
      />
    </div>
  );

  const statusColumn = (
    <div
      id={PANEL_COLUMN_ID}
      className={`relative h-full shrink-0 overflow-hidden print:hidden ${COLUMN_MOTION} ${
        panelExpanded ? 'w-[280px]' : 'w-12'
      }`}
    >
      {/* Fixed width, so the content is revealed or clipped instead of reflowing. */}
      {panelContent.mounted && (
        <div
          data-state={panelContent.state}
          className="flex h-full w-[280px] flex-col data-[state=closed]:pointer-events-none data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
        >
          <PanelHeader titleId={panelTitleId} className="glass-chrome border-l">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPanelCollapsed(true)}
              aria-label={t('shellHideStatusPanel')}
              title={t('shellHideStatusPanel')}
              aria-expanded="true"
              aria-controls={PANEL_COLUMN_ID}
              className="h-9 w-9 shrink-0 p-0"
            >
              <Icon name="right_panel_close" size={20} />
            </Button>
          </PanelHeader>
          <div className="min-h-0 flex-1">
            <RightPanel instanceId={activeInstanceId} />
          </div>
        </div>
      )}
      {!panelExpanded && (
        <div className="glass-chrome absolute inset-y-0 right-0 flex w-12 animate-fade-in flex-col items-center border-b-0 border-l pt-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={expandPanel}
            aria-label={t('shellShowStatusPanel')}
            title={t('shellShowStatusPanel')}
            aria-expanded="false"
            aria-controls={isWide ? PANEL_COLUMN_ID : PANEL_DRAWER_ID}
            className="h-9 w-9 shrink-0 p-0"
          >
            <Icon name="right_panel_open" size={20} />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[color:var(--bg-page)] font-sans">
      {isWide && sidebarColumn}

      <div className="flex min-w-0 flex-1 flex-col print:ml-0 print:mr-0">
        <TopBar
          onDownload={() => openModal('download')}
          onApproval={() => openModal('approval')}
          showInstanceActions={isCanvasRoute}
        />
        <div className="flex min-h-0 flex-1">
          {!isWide && sidebarColumn}

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {isMapRoute && <MapHeader />}
            {isCanvasRoute && <CrossUserInstanceBanner instanceId={activeInstanceId} />}
            <Breadcrumbs />
            {isCanvasRoute && <ExpiryWarningBanner />}
            {isCanvasRoute ? (
              activeInstanceId ? (
                <EntityCanvas instanceId={activeInstanceId} />
              ) : (
                <InstancePlaceholder loading={instancesLoading || (instances?.length ?? 0) > 0} />
              )
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                <Outlet />
              </div>
            )}
            <AppFooter>{isCanvasRoute && <ActivityFeed />}</AppFooter>
          </div>

          {isCanvasRoute && statusColumn}
        </div>
      </div>

      <Drawer
        id={NAV_DRAWER_ID}
        side="left"
        open={navDrawerOpen}
        onClose={closeDrawer}
        label={t('shellNavDrawer')}
        initialFocusRef={navCloseRef}
        className="w-[280px] max-w-[85vw]"
      >
        <Sidebar
          variant="drawer"
          onToggle={closeDrawer}
          toggleRef={navCloseRef}
          initialGroup={drawer?.kind === 'nav' ? drawer.group : undefined}
          onNavigate={closeDrawer}
        />
      </Drawer>

      {isCanvasRoute && (
        <Drawer
          id={PANEL_DRAWER_ID}
          side="right"
          open={panelDrawerOpen}
          onClose={closeDrawer}
          labelledBy={panelDrawerTitleId}
          initialFocusRef={panelCloseRef}
          className="w-[320px] max-w-[90vw]"
        >
          <PanelHeader
            titleId={panelDrawerTitleId}
            className="border-b border-[color:var(--border)]"
          >
            <Button
              ref={panelCloseRef}
              variant="ghost"
              size="sm"
              onClick={closeDrawer}
              aria-label={t('shellCloseStatusPanel')}
              title={t('shellCloseStatusPanel')}
              className="h-9 w-9 shrink-0 p-0"
            >
              <Icon name="close" size={20} />
            </Button>
          </PanelHeader>
          <div className="min-h-0 flex-1">
            <RightPanel instanceId={activeInstanceId} />
          </div>
        </Drawer>
      )}

      <CommandPalette />

      {activeInstanceId && (
        <>
          <OrganizationModal
            open={open === 'org-edit'}
            onClose={closeModal}
            instanceId={activeInstanceId}
            defaultValues={orgDefaults}
          />
          <ContactModal
            open={open === 'contact-add' || open === 'contact-edit'}
            onClose={closeModal}
            instanceId={activeInstanceId}
            contactId={open === 'contact-edit' ? editId || undefined : undefined}
          />
          <EndpointModal
            open={open === 'endpoint-add' || open === 'endpoint-edit'}
            onClose={closeModal}
            instanceId={activeInstanceId}
            endpointId={open === 'endpoint-edit' ? editId || undefined : undefined}
          />
          <CertificateModal
            open={open === 'certificate-add'}
            onClose={closeModal}
            instanceId={activeInstanceId}
          />
          <MembershipModal
            open={open === 'membership-add' || open === 'membership-edit'}
            onClose={closeModal}
            instanceId={activeInstanceId}
            membershipId={open === 'membership-edit' ? editId || undefined : undefined}
          />
          <ApprovalModal
            open={open === 'approval'}
            onClose={closeModal}
            instanceId={activeInstanceId}
          />
          <DownloadModal
            open={open === 'download'}
            onClose={closeModal}
            instanceId={activeInstanceId}
          />
          <CertRenewalModal
            open={open === 'cert-renew'}
            onClose={closeModal}
            instanceId={activeInstanceId}
          />
        </>
      )}
    </div>
  );
}
