/**
 * FkLink.tsx – Clickable FK value that highlights the target card, or the
 * target row when `targetKey` names one (see the row convention in canvas.store).
 */
import { findEntityRow, useCanvasStore, type EntityId } from '../../stores/canvas.store';

interface FkLinkProps {
  label: string;
  targetEntity: EntityId;
  value: string;
  /** Row key in the target card; defaults to highlighting the whole card. */
  targetKey?: string;
}

export function FkLink({ label, targetEntity, value, targetKey }: FkLinkProps) {
  const highlightEntity = useCanvasStore((s) => s.highlightEntity);

  function handleClick() {
    highlightEntity(targetEntity, targetKey);
    const el =
      (targetKey ? findEntityRow(targetEntity, targetKey) : null) ??
      document.getElementById(`card-${targetEntity}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 0',
        borderBottom: '1px solid var(--bg-page)',
        fontSize: '12px',
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span
        onClick={handleClick}
        style={{
          color: 'var(--primary)',
          fontFamily: 'monospace',
          fontSize: '11px',
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        {value}
      </span>
    </div>
  );
}
