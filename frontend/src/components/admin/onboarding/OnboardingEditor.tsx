/**
 * OnboardingEditor.tsx – the spreadsheet-like entry grid for bulk onboarding:
 * one row per site, inline cells with per-column validation, add / remove
 * rows (animated) and paste of tab-separated rows straight from Excel or
 * Sheets. Controlled: the page owns the rows so they survive step changes.
 * Server dry-run results come in as `serverStatus` keyed by 0-based row index
 * and are shown in the status column when the row has no client-side problem.
 * Rows that came from an uploaded file show that file in an extra column.
 * Dependencies: onboardingColumns, Button, Icon, StatusPill, i18n store.
 */
import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties } from 'react';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { StatusPill } from '../../ui/StatusPill';
import type { StatusTone } from '../../../lib/statusColors';
import { useI18n } from '../../../stores/i18n.store';
import {
  MAX_ONBOARDING_ROWS,
  ONBOARDING_COLUMNS,
  ONBOARDING_COLUMN_KEYS,
  applyGrid,
  isBlankCells,
  newEditorRow,
  parseClipboardGrid,
  validateCell,
  type EditorRow,
  type OnboardingColumnKey,
} from './onboardingColumns';

export interface EditorRowStatus {
  tone: StatusTone;
  text: string;
}

export interface OnboardingEditorProps {
  rows: EditorRow[];
  onChange: (rows: EditorRow[]) => void;
  /** Show every problem, e.g. after the admin pressed Validate. */
  showAllErrors?: boolean;
  /** Dry-run outcome per 0-based row index. */
  serverStatus?: Record<number, EditorRowStatus>;
  disabled?: boolean;
}

const EXIT_MS = 180;

const CELL_CLASS =
  'w-full rounded-input border bg-[color:var(--bg-input)] px-2 py-1.5 text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] transition-colors duration-short ease-standard hover:border-[color:var(--border-strong)] focus-visible:border-[color:var(--focus-ring)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-50';

export function OnboardingEditor({
  rows,
  onChange,
  showAllErrors = false,
  serverStatus,
  disabled = false,
}: OnboardingEditorProps) {
  const { t } = useI18n();
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const lastAdded = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Rows merged from uploaded files get a column naming their file.
  const hasSources = rows.some((r) => r.source);

  // A freshly added row takes focus, so the keyboard flow continues in the grid.
  useEffect(() => {
    const id = lastAdded.current;
    if (!id) return;
    lastAdded.current = null;
    const index = rows.findIndex((r) => r.id === id);
    root.current
      ?.querySelector<HTMLInputElement>(`[data-testid="cell-${index}-organizationIdentifier"]`)
      ?.focus();
  }, [rows]);

  const touch = (ids: string[]) =>
    setTouched((prev) => {
      const next = new Set(prev);
      ids.forEach((i) => next.add(i));
      return next;
    });

  function setCell(rowId: string, key: OnboardingColumnKey, value: string) {
    onChange(rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [key]: value } } : r)));
  }

  function addRow() {
    if (rows.length >= MAX_ONBOARDING_ROWS) return;
    const row = newEditorRow();
    lastAdded.current = row.id;
    onChange([...rows, row]);
  }

  function removeRow(id: string) {
    setRemoving((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      onChange(rows.filter((r) => r.id !== id));
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, EXIT_MS);
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    const grid = parseClipboardGrid(e.clipboardData.getData('text'));
    if (!grid) return;
    e.preventDefault();
    const filled = applyGrid(
      rows.map((r) => r.cells),
      grid,
      rowIndex,
      colIndex,
    );
    const next = filled.map((cells, i) => (rows[i] ? { ...rows[i], cells } : newEditorRow(cells)));
    touch(
      grid.flatMap((line, i) =>
        line.map((_, j) => `${next[rowIndex + i]?.id}:${ONBOARDING_COLUMN_KEYS[colIndex + j]}`),
      ),
    );
    onChange(next);
  }

  return (
    <div ref={root} data-testid="onboarding-editor">
      <div className="surface-card overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-[color:var(--bg-hover)]">
            <tr className="text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
              <th scope="col" className="w-10 px-2 py-2.5 text-center">
                <span className="sr-only">{t('onbEditorRowNumber')}</span>#
              </th>
              {hasSources && (
                <th scope="col" className="min-w-[8rem] px-2 py-2.5">
                  {t('onbColFile')}
                </th>
              )}
              {ONBOARDING_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className={`px-2 py-2.5 ${c.width}`}>
                  {t(c.labelKey)}
                  {c.required && (
                    <span aria-hidden="true" className="ml-0.5 text-danger-fg">
                      *
                    </span>
                  )}
                </th>
              ))}
              <th scope="col" className="min-w-[10rem] px-2 py-2.5">
                {t('adminOnboardingColStatus')}
              </th>
              <th scope="col" className="w-10 px-2 py-2.5">
                <span className="sr-only">{t('onbEditorRemoveColumn')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              // A blank row is ignored on submit, so it never shows problems.
              const blank = isBlankCells(row.cells);
              const isShown = (key: OnboardingColumnKey) =>
                !blank &&
                !!validateCell(key, row.cells[key]) &&
                (showAllErrors || touched.has(`${row.id}:${key}`));
              const shownColumn = ONBOARDING_COLUMNS.find((c) => isShown(c.key));
              const server = serverStatus?.[rowIndex];
              const rowNo = rowIndex + 1;
              const isRemoving = removing.has(row.id);
              return (
                <tr
                  key={row.id}
                  data-testid="onboarding-row"
                  style={{ '--stagger-index': 0 } as CSSProperties}
                  className={`border-t border-[color:var(--border)] ${
                    isRemoving ? 'animate-fade-out' : 'animate-list-item-in'
                  }`}
                >
                  <td className="px-2 py-1.5 text-center text-2xs text-[color:var(--text-muted)]">
                    {rowNo}
                  </td>
                  {hasSources && (
                    <td className="px-2 py-1.5">
                      {row.source && (
                        <span
                          title={row.source.name}
                          data-testid={`row-source-${rowIndex}`}
                          className="inline-flex max-w-[10rem] items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-hover)] px-2 py-0.5 text-2xs text-[color:var(--text-secondary)]"
                        >
                          <Icon name="description" size={14} />
                          <span className="truncate">{row.source.name}</span>
                        </span>
                      )}
                    </td>
                  )}
                  {ONBOARDING_COLUMNS.map((c, colIndex) => {
                    const show = isShown(c.key);
                    return (
                      <td key={c.key} className="px-1.5 py-1.5">
                        <input
                          value={row.cells[c.key]}
                          onChange={(e) => setCell(row.id, c.key, e.target.value)}
                          onBlur={() => touch([`${row.id}:${c.key}`])}
                          onPaste={(e) => handlePaste(e, rowIndex, colIndex)}
                          placeholder={c.placeholder}
                          disabled={disabled}
                          aria-label={`${t(c.labelKey)}, ${t('onbEditorRowNumber')} ${rowNo}`}
                          aria-invalid={show || undefined}
                          aria-describedby={show ? `${row.id}-status` : undefined}
                          autoComplete="off"
                          spellCheck={false}
                          data-testid={`cell-${rowIndex}-${c.key}`}
                          className={`${CELL_CLASS} ${c.mono ? 'font-mono text-xs' : 'text-sm'} ${
                            show
                              ? 'border-danger-border bg-danger-surface'
                              : 'border-[color:var(--border)]'
                          }`}
                        />
                      </td>
                    );
                  })}
                  <td id={`${row.id}-status`} className="px-2 py-1.5 text-xs">
                    {shownColumn ? (
                      <span className="text-danger-fg" data-testid={`row-error-${rowIndex}`}>
                        <span className="font-semibold">{t(shownColumn.labelKey)}:</span>{' '}
                        {t(validateCell(shownColumn.key, row.cells[shownColumn.key])!)}
                      </span>
                    ) : server ? (
                      <StatusPill tone={server.tone}>{server.text}</StatusPill>
                    ) : null}
                  </td>
                  <td className="px-1.5 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={disabled || isRemoving}
                      aria-label={t('onbEditorRemoveRow', { row: rowNo })}
                      className="press-effect inline-flex h-8 w-8 items-center justify-center rounded-control text-[color:var(--text-muted)] transition-colors duration-short ease-standard hover:bg-[color:var(--bg-hover)] hover:text-danger-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] disabled:opacity-40"
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={addRow}
          disabled={disabled || rows.length >= MAX_ONBOARDING_ROWS}
          data-testid="onboarding-add-row"
        >
          <Icon name="add" size={16} />
          {t('onbEditorAddRow')}
        </Button>
        <span className="text-xs text-[color:var(--text-muted)]">
          {t('onbEditorPasteHint')} · {t('onbEditorRowCount', { count: rows.length })}
        </span>
      </div>
    </div>
  );
}
