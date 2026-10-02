/**
 * InstanceSwitcher.tsx – the sidebar's instance list: each row is a select
 * button (aria-current on the active instance) next to a separate pin toggle
 * (aria-pressed; pinned instances sort first and are remembered in
 * localStorage), plus "New instance". Not shown in the collapsed rail.
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
import { ACTIVE, FOCUS_RING } from './sidebarStyles';

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
