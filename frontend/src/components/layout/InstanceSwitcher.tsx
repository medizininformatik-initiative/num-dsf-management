/**
 * InstanceSwitcher.tsx – the sidebar's instance list: each row is a select
 * button (aria-current on the active instance) next to a separate pin toggle
 * (aria-pressed; pinned instances sort first and are remembered in
 * localStorage; on hover-capable screens the toggle shows on hover, focus or
 * when pinned), plus "New instance". Rows match the navigation rows: 36 px,
 * 13 px type, the accent pill on the active instance. Not shown in the rail.
 * Dependencies: canvas.store, i18n.store, useInstance, react-router-dom,
 * sidebarStyles, ui/Icon, ui/Button, InstanceCreateModal.
 */
import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCanvasStore } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import { useInstances } from '../../hooks/useInstance';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { InstanceCreateModal } from '../modals/InstanceCreateModal';
import { ACTIVE, ROW_FOCUS, SECTION_HEADER, SIDEBAR_TEXT } from './sidebarStyles';

const PINNED_KEY = 'dsf-pinned-instances';

function readPinned(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PINNED_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function InstanceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
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
    <section aria-labelledby={headingId} className="shrink-0 animate-fade-in px-3 pb-3 pt-1">
      <div className="mb-1 flex h-7 items-center justify-between gap-2 pl-[10px]">
        <h2 id={headingId} className={SECTION_HEADER}>
          {t('instances')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCreate(true)}
          className="min-h-0 px-2 py-1 text-xs font-medium text-[color:var(--primary)]"
        >
          <Icon name="add" size={14} />
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
              className={`group flex h-9 items-center rounded-control transition-colors duration-short ease-standard ${
                isActive
                  ? ACTIVE
                  : 'text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              <button
                type="button"
                onClick={() => select(inst.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`h-full min-w-0 flex-1 truncate rounded-control pl-[10px] text-left ${SIDEBAR_TEXT} ${
                  isActive ? 'font-semibold' : 'font-medium'
                } ${ROW_FOCUS}`}
              >
                {inst.label}
              </button>
              <button
                type="button"
                onClick={() => togglePin(inst.id)}
                aria-pressed={isPinned}
                aria-label={t('shellPinInstance', { label: inst.label })}
                title={t(isPinned ? 'shellUnpin' : 'shellPinToTop')}
                className={`press-effect mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-control hover:bg-black/5 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10 ${
                  isPinned
                    ? 'text-warning-fg'
                    : 'text-[color:var(--text-muted)] [@media(hover:hover)]:opacity-0'
                } ${ROW_FOCUS}`}
              >
                <Icon name="push_pin" size={16} filled={isPinned} />
              </button>
            </li>
          );
        })}
      </ul>
      <InstanceCreateModal open={showCreate} onClose={() => setShowCreate(false)} />
    </section>
  );
}
