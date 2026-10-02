/**
 * Sidebar.tsx – Left navigation of the app shell on the glass chrome
 * material: environment badge, instance switcher with pinning, the main links
 * with an active state (aria-current="page"), the Administration and
 * Resources groups and the signed-in identity.
 * Variants (AppPage picks one): 'full' – the 220 px column; 'rail' – the
 * collapsed 64 px column: icons only, labels fade out, the instance switcher
 * and group lists are hidden and a group button expands the sidebar with that
 * group open; 'drawer' – the full layout inside the narrow-screen Drawer.
 * The root fills its box; AppPage owns width, position and motion.
 * Dependencies: auth.store, canvas.store, i18n.store, useInstance, useMe,
 * usePresence, authApi, react-router-dom, lib/environment, lib/motion,
 * ui/Icon, ui/Button, InstanceCreateModal.
 */
import { useId, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import { useInstances } from '../../hooks/useInstance';
import { useMe } from '../../hooks/useMe';
import { usePresence } from '../../hooks/usePresence';
import { authApi } from '../../api/auth.api';
import { ENV_ACCENT, IS_PRODUCTION } from '../../lib/environment';
import { exitMs } from '../../lib/motion';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { InstanceCreateModal } from '../modals/InstanceCreateModal';

export type SidebarVariant = 'full' | 'rail' | 'drawer';
export type SidebarGroup = 'admin' | 'resources';

interface SidebarProps {
  variant?: SidebarVariant;
  /**
   * The header button: collapse ('full'), expand ('rail'; a rail group button
   * passes its group) or close ('drawer'). Without it there is no button.
   */
  onToggle?: (group?: SidebarGroup) => void;
  /** id of the element the header button shows or hides (aria-controls). */
  controls?: string;
  /** Ref of the header button, e.g. the drawer's initial focus target. */
  toggleRef?: Ref<HTMLButtonElement>;
  /** Group shown open on mount (a rail group button opened the drawer). */
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

const PINNED_KEY = 'dsf-pinned-instances';

function readPinned(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PINNED_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';
// Icons sit 22 px from the column edge in every variant, so they stay put
// while the column narrows to the rail.
const ROW = `press-effect flex w-full items-center gap-3 overflow-hidden whitespace-nowrap rounded-lg px-[10px] text-left text-xs ${FOCUS_RING}`;
const IDLE =
  'text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]';
const ACTIVE = 'bg-brand-50 font-bold text-brand-700 dark:bg-brand-400/15 dark:text-brand-100';

/** Labels fade out in the rail, where the narrowing column also clips them. */
function fade(rail: boolean): string {
  return `transition-opacity duration-short ease-standard ${rail ? 'opacity-0' : ''}`;
}

const stagger = (index: number) => ({ '--stagger-index': index }) as CSSProperties;

function NavItem({
  item,
  rail,
  sub = false,
  onNavigate,
}: {
  item: LinkItem;
  rail: boolean;
  sub?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={rail ? item.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) =>
        `${ROW} ${sub ? 'h-8 font-medium' : 'h-9 font-semibold'} ${isActive ? ACTIVE : IDLE}`
      }
    >
      <Icon name={item.icon} size={sub ? 18 : 20} className="shrink-0" />
      <span className={`min-w-0 flex-1 truncate ${fade(rail)}`}>{item.label}</span>
    </NavLink>
  );
}

function GroupList({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  const { mounted, state } = usePresence(open, exitMs('short'));
  if (!mounted) return null;
  return (
    <ul
      id={id}
      data-state={state}
      aria-hidden={state === 'closed' ? true : undefined}
      className="mb-1 ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-[color:var(--border)] pl-2 data-[state=closed]:pointer-events-none data-[state=closed]:animate-fade-out"
    >
      {children}
    </ul>
  );
}

function NavGroup({
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
  /** The current route belongs to the group. */
  active: boolean;
  rail: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  // Mark the group itself when its active child is out of sight.
  const highlighted = active && (rail || !open);
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        title={rail ? label : undefined}
        aria-expanded={rail ? undefined : open}
        aria-controls={rail ? undefined : id}
        className={`${ROW} h-9 font-semibold ${highlighted ? ACTIVE : IDLE}`}
      >
        <Icon name={icon} size={20} className="shrink-0" />
        <span className={`min-w-0 flex-1 truncate ${fade(rail)}`}>{label}</span>
        <Icon
          name="chevron_right"
          size={18}
          className={`shrink-0 transition-[transform,opacity] duration-short ease-standard ${
            open && !rail ? 'rotate-90' : ''
          } ${rail ? 'opacity-0' : ''}`}
        />
      </button>
      <GroupList id={id} open={open && !rail}>
        {links.map((item, i) => (
          <li key={item.to} className="animate-list-item-in" style={stagger(i)}>
            <NavItem item={item} rail={false} sub onNavigate={onNavigate} />
          </li>
        ))}
      </GroupList>
    </>
  );
}

function EnvBadge({ rail }: { rail: boolean }) {
  const { t } = useI18n();
  const label = t(IS_PRODUCTION ? 'shellEnvProduction' : 'shellEnvTest');
  const icon = IS_PRODUCTION ? 'verified_user' : 'science';
  const style: CSSProperties = { background: ENV_ACCENT };
  if (rail) {
    return (
      <div
        className="mx-3 mb-2 flex w-10 shrink-0 flex-col items-center gap-0.5 rounded-lg py-1.5 text-white"
        style={style}
        title={label}
      >
        <Icon name={icon} size={16} />
        <span aria-hidden="true" className="text-[11px] font-bold leading-none tracking-wide">
          {t(IS_PRODUCTION ? 'shellEnvShortProduction' : 'shellEnvShortTest')}
        </span>
        <span className="sr-only">{label}</span>
      </div>
    );
  }
  return (
    <div
      className="mx-3 mb-2 flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg px-2.5 py-1.5 text-white"
      style={style}
    >
      <Icon name={icon} size={16} className="shrink-0" />
      <span className="truncate text-xs font-semibold">{label}</span>
    </div>
  );
}

function InstanceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: instances = [] } = useInstances();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const setActiveInstance = useCanvasStore((s) => s.setActiveInstance);
  const [showCreate, setShowCreate] = useState(false);
  const [pinnedIds, setPinnedIds] = useState(readPinned);
  const headingId = useId();

  function togglePin(id: string) {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      return next;
    });
  }

  function select(id: string) {
    setActiveInstance(id);
    navigate('/app');
    onNavigate?.();
  }

  // Pinned instances first; the sort is stable, so the API order is kept otherwise.
  const sorted = [...instances].sort(
    (a, b) => Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)),
  );

  return (
    <section aria-labelledby={headingId} className="shrink-0 animate-fade-in px-3 pb-2">
      <div className="mb-1 flex items-center justify-between gap-2 pl-1">
        <h2
          id={headingId}
          className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]"
        >
          {t('instances')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCreate(true)}
          className="min-h-0 px-1.5 py-0.5 text-[11px] text-brand-700 dark:text-brand-400"
        >
          {t('newInstance')}
        </Button>
      </div>
      <ul className="flex max-h-[200px] flex-col gap-0.5 overflow-y-auto">
        {sorted.map((inst) => {
          const isPinned = pinnedIds.includes(inst.id);
          const isActive = inst.id === activeInstanceId;
          return (
            <li
              key={inst.id}
              className={`flex items-center rounded-lg ${
                isActive
                  ? ACTIVE
                  : 'text-[color:var(--text-primary)] hover:bg-[color:var(--bg-hover)]'
              }`}
            >
              <button
                type="button"
                onClick={() => select(inst.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`min-w-0 flex-1 truncate rounded-lg py-1.5 pl-2 text-left text-xs ${
                  isActive ? 'font-bold' : 'font-medium'
                } ${FOCUS_RING}`}
              >
                {inst.label}
              </button>
              <button
                type="button"
                onClick={() => togglePin(inst.id)}
                aria-pressed={isPinned}
                aria-label={t('shellPinInstance', { label: inst.label })}
                title={t(isPinned ? 'shellUnpin' : 'shellPinToTop')}
                className={`press-effect mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 ${
                  isPinned ? 'text-warning-fg' : 'text-[color:var(--text-muted)]'
                } ${FOCUS_RING}`}
              >
                <Icon name="push_pin" size={14} filled={isPinned} />
              </button>
            </li>
          );
        })}
      </ul>
      <InstanceCreateModal open={showCreate} onClose={() => setShowCreate(false)} />
    </section>
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
  const { data: instances = [] } = useInstances();
  const activeInstanceId = useCanvasStore((s) => s.activeInstanceId);
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const [adminOpen, setAdminOpen] = useState(initialGroup === 'admin');
  const [resourcesOpen, setResourcesOpen] = useState(initialGroup === 'resources');
  const adminListId = useId();
  const resourcesListId = useId();
  const rail = variant === 'rail';

  // A group's header is highlighted while one of its routes is active and its
  // list is out of sight, so the user can see where they are.
  const isAdminRoute = pathname.startsWith('/app/admin') || pathname === '/app/audit';
  const isResourcesRoute = pathname.startsWith('/app/marketplace') || pathname === '/app/resources';

  const initials = (user?.email || '??').slice(0, 2).toUpperCase();
  const activeLabel =
    instances.find((i) => i.id === activeInstanceId)?.label || t('noInstanceSelected');

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
      navigate('/login', { replace: true });
    }
  }

  return (
    <aside
      className={`flex h-full w-full flex-col overflow-hidden ${
        variant === 'drawer' ? '' : 'glass-chrome border-b-0 border-r'
      }`}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-3.5">
        {onToggle && (
          <Button
            ref={toggleRef}
            variant="ghost"
            size="sm"
            onClick={() => onToggle()}
            aria-label={toggle.label}
            title={toggle.label}
            aria-expanded={variant === 'drawer' ? undefined : !rail}
            aria-controls={controls}
            className="h-9 w-9 shrink-0 p-0"
          >
            <Icon name={toggle.icon} size={20} />
          </Button>
        )}
        <div
          className={`flex min-w-0 items-center gap-2 ${fade(rail)}`}
          aria-hidden={rail ? true : undefined}
        >
          <Icon name="shield" size={22} className="shrink-0 text-brand-700 dark:text-brand-400" />
          <div className="min-w-0 whitespace-nowrap">
            <p className="text-xs font-bold leading-tight text-brand-700 dark:text-brand-400">
              {t('shellProductName')}
            </p>
            <p className="text-[11px] leading-tight text-[color:var(--text-muted)]">
              {t('shellProductSubtitle')}
            </p>
          </div>
        </div>
      </div>

      <EnvBadge rail={rail} />

      {!rail && <InstanceSwitcher onNavigate={onNavigate} />}

      <nav
        aria-label={t('shellMainNav')}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
      >
        <ul className="flex flex-col gap-0.5">
          <li>
            <NavItem
              item={{ to: '/app', icon: 'grid_view', label: t('dashboard'), end: true }}
              rail={rail}
              onNavigate={onNavigate}
            />
          </li>
          {me?.isAdmin && (
            <li>
              <NavGroup
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
          <li>
            <NavItem
              item={{ to: '/app/map', icon: 'hub', label: t('networkMap') }}
              rail={rail}
              onNavigate={onNavigate}
            />
          </li>
          <li>
            <NavItem
              item={{ to: '/app/status', icon: 'dashboard', label: t('status') }}
              rail={rail}
              onNavigate={onNavigate}
            />
          </li>
          <li>
            <NavGroup
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
        </ul>
      </nav>

      <div className="shrink-0 px-3 pb-3 pt-2">
        <div
          className={`mb-1.5 flex items-center gap-3 overflow-hidden rounded-xl py-2 pl-1 pr-2 transition-colors duration-short ease-standard ${
            rail ? '' : 'bg-[color:var(--bg-hover)]'
          }`}
          title={rail ? user?.email : undefined}
        >
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
          >
            {initials}
          </div>
          <div className={`min-w-0 ${fade(rail)}`}>
            <p className="truncate text-xs font-bold text-[color:var(--text-primary)]">
              {user?.email}
            </p>
            <p className="mono-id truncate text-[11px] text-[color:var(--text-muted)]">
              {activeLabel}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          onClick={handleLogout}
          title={rail ? t('signOut') : undefined}
          className="w-full justify-start gap-3 overflow-hidden px-[9px]"
        >
          <Icon name="logout" size={20} className="shrink-0" />
          <span className={fade(rail)}>{t('signOut')}</span>
        </Button>
      </div>
    </aside>
  );
}
