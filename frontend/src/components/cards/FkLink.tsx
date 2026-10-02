/**
 * FkLink.tsx – a foreign-key value as a Button: label and value, named for
 * screen readers as "label: value. Jump to the <target> card". Pointer hover
 * or keyboard focus publishes the active relation, which RelationOverlay draws
 * as a line to the target row (or card). Activating it highlights the target
 * row when `targetKey` names one (see the row convention in canvas.store),
 * otherwise the card, moves focus to the target card like an in-page link and
 * scrolls the target into view, instantly under Reduce Motion.
 * Dependencies: Button, canvas store, i18n store, lib/motion.
 */
import { useEffect, useId, type PointerEvent } from 'react';
import { findEntityRow, useCanvasStore, type EntityId } from '../../stores/canvas.store';
import { useI18n } from '../../stores/i18n.store';
import { scrollIntoViewSafe } from '../../lib/motion';
import { Button } from '../ui/Button';

interface FkLinkProps {
  label: string;
  targetEntity: EntityId;
  value: string;
  /** Row key in the target card; defaults to highlighting the whole card. */
  targetKey?: string;
}

export function FkLink({ label, targetEntity, value, targetKey }: FkLinkProps) {
  const { t } = useI18n();
  const highlightEntity = useCanvasStore((s) => s.highlightEntity);
  const setActiveRelation = useCanvasStore((s) => s.setActiveRelation);
  const clearActiveRelation = useCanvasStore((s) => s.clearActiveRelation);
  const sourceId = `fk-${useId()}`;

  // Never leave a relation line pointing at an FK link that is gone.
  useEffect(() => () => clearActiveRelation(sourceId), [clearActiveRelation, sourceId]);

  function showRelation() {
    setActiveRelation({ sourceId, target: targetEntity, targetKey });
  }

  function handlePointerEnter(e: PointerEvent<HTMLButtonElement>) {
    // A tap is not a hover: touch gets the highlight from the click instead.
    if (e.pointerType !== 'touch') showRelation();
  }

  function handlePointerLeave(e: PointerEvent<HTMLButtonElement>) {
    // While the link keeps focus, its line stays.
    if (document.activeElement !== e.currentTarget) clearActiveRelation(sourceId);
  }

  function handleClick() {
    highlightEntity(targetEntity, targetKey);
    const card = document.getElementById(`card-${targetEntity}`);
    const row = targetKey ? findEntityRow(targetEntity, targetKey) : null;
    card?.focus({ preventScroll: true });
    scrollIntoViewSafe(row ?? card, { block: 'nearest', inline: 'nearest' });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      id={sourceId}
      aria-label={t('fkLinkAria', { label, value, target: t(targetEntity) })}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={showRelation}
      onBlur={() => clearActiveRelation(sourceId)}
      className="fk-link w-full min-w-0 justify-between gap-3 px-1.5 text-left font-normal hover:ring-[1.5px] hover:ring-primary/40 dark:hover:ring-brand-400/50"
    >
      <span className="shrink-0 text-[color:var(--text-muted)]">{label}</span>
      <span className="min-w-0 truncate font-mono text-primary underline underline-offset-2 dark:text-brand-400">
        {value}
      </span>
    </Button>
  );
}
