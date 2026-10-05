/**
 * CommandPalette.tsx – Ctrl+K / Cmd+K command palette for navigation, entity
 * actions and instance switching. A modal dialog on DialogShell: glass panel,
 * spring entrance and faster exit, stacking with other dialogs (Escape and
 * scrim close only the top-most), focus trap and focus restore. The search
 * field is a combobox over a listbox of commands: arrow keys move the active
 * option (kept in view with scrollIntoViewSafe), Enter runs it.
 * Dependencies: react-router-dom, useInstances, canvas.store, useModals,
 * useMe, i18n.store, DialogShell, Icon, lib/motion.
 */
import { useState, useEffect, useRef, useMemo, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInstances } from '../../hooks/useInstance';
import { useCanvasStore } from '../../stores/canvas.store';
import { useModals } from '../../hooks/useModals';
import { useMe } from '../../hooks/useMe';
import { useI18n } from '../../stores/i18n.store';
import { scrollIntoViewSafe } from '../../lib/motion';
import { DialogShell } from '../ui/DialogShell';
import { Icon } from '../ui/Icon';

interface Command {
  id: string;
  label: string;
  icon: string;
  color: string;
  category: string;
  action: () => void;
}

const ADMIN_COMMAND_IDS = ['nav-admin', 'nav-audit', 'nav-users', 'nav-promotions'];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const navigate = useNavigate();
  const { data: instances = [] } = useInstances();
  const setActiveInstance = useCanvasStore((s) => s.setActiveInstance);
  const { data: me } = useMe();
  const { t } = useI18n();

  // Toggle on Ctrl+K / Cmd+K. Escape is left to the dialog layer, so it only
  // closes the palette while the palette is the top-most dialog.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setSelectedIndex(0);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const commands: Command[] = useMemo(() => {
    const close = () => setOpen(false);
    return [
      // Navigation
      {
        id: 'nav-canvas',
        label: t('cmdGoToCanvas'),
        icon: 'dashboard',
        color: 'var(--primary)',
        category: t('cmdCategoryNavigation'),
        action: () => {
          navigate('/app');
          close();
        },
      },
      {
        id: 'nav-admin',
        label: t('cmdApprovalReview'),
        icon: 'admin_panel_settings',
        color: 'var(--primary)',
        category: t('cmdCategoryNavigation'),
        action: () => {
          navigate('/app/admin');
          close();
        },
      },
      {
        id: 'nav-audit',
        label: t('cmdAuditLog'),
        icon: 'history',
        color: 'var(--primary)',
        category: t('cmdCategoryNavigation'),
        action: () => {
          navigate('/app/audit');
          close();
        },
      },
      {
        id: 'nav-map',
        label: t('cmdNetworkMap'),
        icon: 'hub',
        color: 'var(--primary)',
        category: t('cmdCategoryNavigation'),
        action: () => {
          navigate('/app/map');
          close();
        },
      },
      {
        id: 'nav-help',
        label: t('helpNavLabel'),
        icon: 'help',
        color: 'var(--primary)',
        category: t('cmdCategoryNavigation'),
        action: () => {
          navigate('/app/help');
          close();
        },
      },
      // Actions
      {
        id: 'act-org',
        label: t('cmdEditOrganization'),
        icon: 'corporate_fare',
        color: 'var(--primary)',
        category: t('cmdCategoryActions'),
        action: () => {
          useModals.getState().openModal('org-edit');
          close();
        },
      },
      {
        id: 'act-contact',
        label: t('cmdAddContact'),
        icon: 'contact_phone',
        color: '#9b59b6',
        category: t('cmdCategoryActions'),
        action: () => {
          useModals.getState().openModal('contact-add');
          close();
        },
      },
      {
        id: 'act-endpoint',
        label: t('cmdAddEndpoint'),
        icon: 'hub',
        color: '#3ecfb2',
        category: t('cmdCategoryActions'),
        action: () => {
          useModals.getState().openModal('endpoint-add');
          close();
        },
      },
      {
        id: 'act-cert',
        label: t('cmdAddCertificate'),
        icon: 'verified_user',
        color: '#f5a623',
        category: t('cmdCategoryActions'),
        action: () => {
          useModals.getState().openModal('certificate-add');
          close();
        },
      },
      {
        id: 'act-membership',
        label: t('cmdAddMembership'),
        icon: 'groups',
        color: '#4a90d9',
        category: t('cmdCategoryActions'),
        action: () => {
          useModals.getState().openModal('membership-add');
          close();
        },
      },
      {
        id: 'act-approval',
        label: t('cmdSendForApproval'),
        icon: 'rule',
        color: '#e05c5c',
        category: t('cmdCategoryActions'),
        action: () => {
          useModals.getState().openModal('approval');
          close();
        },
      },
      {
        id: 'act-download',
        label: t('cmdDownloadAllowList'),
        icon: 'download',
        color: 'var(--text-secondary)',
        category: t('cmdCategoryActions'),
        action: () => {
          useModals.getState().openModal('download');
          close();
        },
      },
      // Instances
      ...instances.map((inst) => ({
        id: `inst-${inst.id}`,
        label: t('cmdSwitchToInstance', { label: inst.label }),
        icon: 'swap_horiz',
        color: '#3ecfb2',
        category: t('cmdCategoryInstances'),
        action: () => {
          setActiveInstance(inst.id);
          navigate('/app');
          close();
        },
      })),
    ];
  }, [instances, navigate, setActiveInstance, t]);

  const visibleCommands = useMemo(() => {
    return commands.filter((c) => {
      const adminOnly = ADMIN_COMMAND_IDS.includes(c.id);
      return !adminOnly || !!me?.isAdmin;
    });
  }, [me?.isAdmin, commands]);

  const q = query.toLowerCase().trim();
  const filtered = q
    ? visibleCommands.filter((c) => c.label.toLowerCase().includes(q))
    : visibleCommands;

  // Re-clamp the selection whenever the filtered list shrinks so selectedIndex
  // never points past the end (which would run the wrong/undefined command).
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const optionId = (cmd: Command) => `${listId}-${cmd.id}`;
  const active = filtered[selectedIndex];
  const activeId = active ? optionId(active) : undefined;

  // Keep the active option visible while the arrow keys move through a long list.
  useEffect(() => {
    if (open && activeId) {
      scrollIntoViewSafe(document.getElementById(activeId), { block: 'nearest' });
    }
  }, [open, activeId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.action();
    }
  }

  // Group by category
  const groups: Record<string, Command[]> = {};
  filtered.forEach((c) => {
    (groups[c.category] ??= []).push(c);
  });

  let flatIndex = 0;

  return (
    <DialogShell
      open={open}
      onDismiss={() => setOpen(false)}
      labelledBy={titleId}
      initialFocusRef={inputRef}
      className="mt-[12vh] max-w-[480px] self-start overflow-hidden"
    >
      <h2 id={titleId} className="sr-only">
        {t('shellCommandPalette')}
      </h2>
      <div className="flex items-center gap-2.5 border-b border-[color:var(--border)] px-4 py-3.5">
        <Icon name="search" size={20} className="shrink-0 text-[color:var(--text-muted)]" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-labelledby={titleId}
          aria-expanded={filtered.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('cmdPlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
        />
        <kbd className="shrink-0 rounded border border-[color:var(--border)] px-1.5 py-0.5 font-sans text-[11px] text-[color:var(--text-muted)]">
          ESC
        </kbd>
      </div>

      {filtered.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={titleId}
          className="max-h-[320px] overflow-y-auto py-1.5"
        >
          {Object.entries(groups).map(([category, cmds], groupIndex) => {
            const groupLabelId = `${listId}-group-${groupIndex}`;
            return (
              <div key={category} role="group" aria-labelledby={groupLabelId}>
                <p
                  id={groupLabelId}
                  className="px-5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]"
                >
                  {category}
                </p>
                {cmds.map((cmd) => {
                  const idx = flatIndex++;
                  const selected = idx === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      id={optionId(cmd)}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      onClick={cmd.action}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex w-full items-center gap-2.5 px-5 py-2 text-left text-[13px] text-[color:var(--text-primary)] transition-colors duration-micro ease-standard ${
                        selected ? 'bg-slate-900/[0.06] dark:bg-white/10' : ''
                      }`}
                    >
                      <Icon
                        name={cmd.icon}
                        size={18}
                        className="shrink-0"
                        style={{ color: cmd.color }}
                      />
                      <span>{cmd.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-5 py-5 text-center text-xs text-[color:var(--text-muted)]">
          {t('cmdNoResults')}
        </p>
      )}
    </DialogShell>
  );
}
