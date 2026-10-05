/**
 * Sidebar.tsx – Left navigation of the app shell in the calm iPadOS sidebar
 * style on the glass chrome material: the BrandMark with a quiet environment
 * badge (the app's only environment indicator), the instance switcher with
 * pinning, the main links, the collapsible Administration and Resources
 * sections, and the signed-in identity with sign-out and the collapse toggle.
 * Rows share one height and type scale; the current item sits on a rounded
 * accent pill (aria-current="page"); icons stay quiet.
 * Variants (AppPage picks one): 'full' – the 220 px column; 'rail' – the
 * collapsed 64 px column: the mark (with an environment dot) and icons only,
 * labels slide and fade out, the instance switcher and section lists are
 * hidden and a section button expands the sidebar with that section open;
 * 'drawer' – the full layout inside the narrow-screen Drawer, its blocks
 * staggering in, with the close button in the header.
 * The root fills its box; AppPage owns width, position and motion.
 * Dependencies: auth.store, canvas.store, i18n.store, useMe, authApi,
 * react-router-dom, lib/environment, ui/Icon, ui/Button, BrandMark, Collapse,
 * InstanceSwitcher, sidebarStyles.
 */
import { useId, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { useI18n } from '../../stores/i18n.store';
import { useMe } from '../../hooks/useMe';
import { authApi } from '../../api/auth.api';
import { DSF_ENVIRONMENT, ENV_ACCENT, IS_PRODUCTION } from '../../lib/environment';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { BrandMark } from './BrandMark';
import { Collapse } from './Collapse';
import { InstanceSwitcher } from './InstanceSwitcher';
import { ACTIVE, IDLE, ROW, SECTION_HEADER, fade, iconTone } from './sidebarStyles';

export type SidebarVariant = 'full' | 'rail' | 'drawer';
export type SidebarGroup = 'admin' | 'resources';

interface SidebarProps {
  variant?: SidebarVariant;
  /**
   * The toggle button: collapse ('full'), expand ('rail'; a rail section
   * button passes its group) or close ('drawer'). Without it there is none.
   */
  onToggle?: (group?: SidebarGroup) => void;
  /** id of the element the toggle shows or hides (aria-controls). */
  controls?: string;
  /** Ref of the toggle button, e.g. the drawer's initial focus target. */
  toggleRef?: Ref<HTMLButtonElement>;
  /** Group shown open on mount (a rail section button opened the drawer). */
  initialGroup?: SidebarGroup;
  /** Called after a link or an instance was chosen, e.g. to close the drawer. */
  onNavigate?: () => void;
}

interface LinkItem {
  to: string;
  icon: string;
  label: string;
  end?: boolean;
}

const stagger = (index: number) => ({ '--stagger-index': index }) as CSSProperties;

function NavItem({
  item,
  rail,
  onNavigate,
}: {
  item: LinkItem;
  rail: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={rail ? item.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) => `${ROW} ${isActive ? ACTIVE : IDLE}`}
    >
      {({ isActive }) => (
        <>
          <Icon
            name={item.icon}
            size={20}
            className={`shrink-0 transition-colors duration-short ease-standard ${iconTone(isActive)}`}
          />
          <span className={`min-w-0 flex-1 truncate ${fade(rail)}`}>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function NavSection({
  id,
  icon,
  label,
  links,
  open,
  active,
  rail,
  onToggle,
  onNavigate,
}: {
  id: string;
  icon: string;
  label: string;
  links: LinkItem[];
  open: boolean;
  /** The current route belongs to the section. */
  active: boolean;
  rail: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  // Mark the section itself when its current item is out of sight.
  const highlighted = active && (rail || !open);
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        title={rail ? label : undefined}
        aria-expanded={rail ? undefined : open}
        aria-controls={rail ? undefined : id}
        className={`${ROW} ${highlighted ? ACTIVE : `${IDLE} ${rail ? '' : SECTION_HEADER}`}`}
      >
        <Icon name={icon} size={20} className={`shrink-0 ${iconTone(highlighted)}`} />
        <span className={`min-w-0 flex-1 truncate ${fade(rail)}`}>{label}</span>
        <Icon
          name="chevron_right"
          size={18}
          className={`shrink-0 text-[color:var(--text-muted)] transition-[transform,opacity] duration-medium ease-spring ${
            open && !rail ? 'rotate-90' : ''
          } ${rail ? 'opacity-0' : ''}`}
        />
      </button>
      <Collapse id={id} open={open && !rail}>
        <ul className="flex flex-col gap-0.5 pb-1 pt-0.5">
          {links.map((item, i) => (
            <li key={item.to} className="animate-list-item-in" style={stagger(i)}>
              <NavItem item={item} rail={false} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </Collapse>
    </>
  );
}

/** Quiet environment badge under the product name: a coloured dot and the label. */
function EnvBadge() {
  const { t } = useI18n();
  return (
    <span
      data-env={DSF_ENVIRONMENT}
      className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-medium leading-tight text-[color:var(--text-muted)]"
    >
      <span
        aria-hidden="true"
        data-testid="env-dot"
        className="h-1.5 w-1.5 shrink-0 rounded-full dark:brightness-[1.8]"
        style={{ background: ENV_ACCENT }}
      />
      {t(IS_PRODUCTION ? 'shellEnvProduction' : 'shellEnvTest')}
    </span>
  );
}

/** A block of the sidebar; in the drawer the blocks stagger in after the sheet. */
function Block({
  drawer,
  index,
  className = '',
  children,
}: {
  drawer: boolean;
  index: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${drawer ? 'animate-list-item-in' : ''} ${className}`}
      style={drawer ? stagger(index + 2) : undefined}
    >
      {children}
    </div>
  );
}

export function Sidebar({
  variant = 'full',
  onToggle,
  controls,
  toggleRef,
  initialGroup,
  onNavigate,
}: SidebarProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const [adminOpen, setAdminOpen] = useState(initialGroup === 'admin');
  const [resourcesOpen, setResourcesOpen] = useState(initialGroup === 'resources');
  const adminListId = useId();
  const resourcesListId = useId();
  const rail = variant === 'rail';
  const drawer = variant === 'drawer';
  const envLabel = t(IS_PRODUCTION ? 'shellEnvProduction' : 'shellEnvTest');

  // A section header is highlighted while one of its routes is active and its
  // list is out of sight, so the user can see where they are.
  const isAdminRoute = pathname.startsWith('/app/admin') || pathname === '/app/audit';
  const isResourcesRoute = pathname.startsWith('/app/marketplace') || pathname === '/app/resources';

  const initials = (user?.email || '??').slice(0, 2).toUpperCase();

  const toggle = {
    full: { icon: 'left_panel_close', label: t('shellCollapseNav') },
    rail: { icon: 'left_panel_open', label: t('shellExpandNav') },
    drawer: { icon: 'close', label: t('shellCloseNav') },
  }[variant];

  const adminLinks: LinkItem[] = [
    { to: '/app/admin', icon: 'task_alt', label: t('approvalReview'), end: true },
    { to: '/app/admin/users', icon: 'group', label: t('sidebarUserManagement') },
    { to: '/app/admin/promotions', icon: 'verified_user', label: t('sidebarPromotions') },
    { to: '/app/admin/ca-blacklist', icon: 'block', label: t('caBlacklistNavLabel') },
    { to: '/app/admin/bundle-versions', icon: 'history', label: t('bundleVersionsNavLabel') },
    { to: '/app/admin/onboarding', icon: 'upload', label: t('adminOnboardingNavLabel') },
    { to: '/app/audit', icon: 'fact_check', label: t('auditLog') },
  ];
  const resourceLinks: LinkItem[] = [
    { to: '/app/marketplace', icon: 'extension', label: t('sidebarMarketplace') },
    { to: '/app/resources', icon: 'menu_book', label: t('dsfResourcesNavLabel') },
  ];

  function toggleGroup(group: SidebarGroup) {
    const setOpen = group === 'admin' ? setAdminOpen : setResourcesOpen;
    if (rail) {
      // The rail has no room for the list: expand the sidebar with it open.
      setOpen(true);
      onToggle?.(group);
    } else {
      setOpen((open) => !open);
    }
  }

  async function handleLogout() {
    try {
      if (user?.email) {
        await authApi.logout(user.email);
      }
    } catch {
      // Logout API failure should not block client-side cleanup
    } finally {
      clearAuth();
      queryClient.clear();
      navigate('/login', { replace: true });
    }
  }

  const toggleButton = onToggle && (
    <Button
      ref={toggleRef}
      variant="ghost"
      onClick={() => onToggle()}
      aria-label={toggle.label}
      title={toggle.label}
      aria-expanded={drawer ? undefined : !rail}
      aria-controls={controls}
      className={
        drawer
          ? 'h-9 w-9 shrink-0 p-0'
          : `${ROW} ${IDLE} min-h-0 justify-start border-0 py-0 font-medium`
      }
    >
      <Icon name={toggle.icon} size={20} className={`shrink-0 ${iconTone(false)}`} />
      {!drawer && <span className={`min-w-0 truncate ${fade(rail)}`}>{toggle.label}</span>}
    </Button>
  );

  return (
    <aside
      className={`flex h-full w-full flex-col overflow-hidden ${
        drawer ? '' : 'glass-chrome border-b-0 border-r'
      }`}
    >
      <div
        className={`flex h-14 shrink-0 items-center gap-2 pl-[18px] pr-3 ${drawer ? 'animate-list-item-in' : ''}`}
        style={drawer ? stagger(1) : undefined}
      >
        <div className="relative min-w-0 flex-1" title={rail ? envLabel : undefined}>
          <BrandMark nameClassName={fade(rail)}>
            <EnvBadge />
          </BrandMark>
          {/* The rail keeps the environment as a dot on the mark. */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute left-[22px] top-[22px] h-2 w-2 rounded-full ring-2 ring-[color:var(--bg-card)] transition-opacity duration-short ease-standard dark:brightness-[1.8] ${
              rail ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ background: ENV_ACCENT }}
          />
        </div>
        {drawer && toggleButton}
      </div>

      {!rail && (
        <Block drawer={drawer} index={0}>
          <InstanceSwitcher onNavigate={onNavigate} />
        </Block>
      )}

      <nav
        aria-label={t('shellMainNav')}
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2 pt-1 ${
          drawer ? 'animate-list-item-in' : ''
        }`}
        style={drawer ? stagger(3) : undefined}
      >
        <ul className="flex flex-col gap-0.5">
          <li>
            <NavItem
              item={{ to: '/app', icon: 'grid_view', label: t('dashboard'), end: true }}
              rail={rail}
              onNavigate={onNavigate}
            />
          </li>
          <li>
            <NavItem
              item={{ to: '/app/map', icon: 'hub', label: t('networkMap') }}
              rail={rail}
              onNavigate={onNavigate}
            />
          </li>
          {me?.isAdmin && (
            <li className="mt-3">
              <NavSection
                id={adminListId}
                icon="admin_panel_settings"
                label={t('sidebarAdminGroup')}
                links={adminLinks}
                open={adminOpen}
                active={isAdminRoute}
                rail={rail}
                onToggle={() => toggleGroup('admin')}
                onNavigate={onNavigate}
              />
            </li>
          )}
          <li className="mt-3">
            <NavSection
              id={resourcesListId}
              icon="widgets"
              label={t('sidebarResourcesGroup')}
              links={resourceLinks}
              open={resourcesOpen}
              active={isResourcesRoute}
              rail={rail}
              onToggle={() => toggleGroup('resources')}
              onNavigate={onNavigate}
            />
          </li>
          <li>
            <NavItem
              item={{ to: '/app/help', icon: 'help', label: t('helpNavLabel') }}
              rail={rail}
              onNavigate={onNavigate}
            />
          </li>
        </ul>
      </nav>

      <Block drawer={drawer} index={2} className="shrink-0 px-3 pb-3 pt-2">
        <div
          className="mb-1 flex h-11 items-center gap-3 overflow-hidden px-1"
          title={rail ? user?.email : undefined}
        >
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent-surface)] text-xs font-semibold text-[color:var(--accent-on-surface)]"
          >
            {initials}
          </div>
          <p
            className={`min-w-0 truncate text-[13px] font-medium text-[color:var(--text-primary)] ${fade(rail)}`}
          >
            {user?.email}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={handleLogout}
          title={rail ? t('signOut') : undefined}
          className={`${ROW} ${IDLE} min-h-0 justify-start border-0 py-0`}
        >
          <Icon name="logout" size={20} className={`shrink-0 ${iconTone(false)}`} />
          <span className={fade(rail)}>{t('signOut')}</span>
        </Button>
        {!drawer && toggleButton}
      </Block>
    </aside>
  );
}
