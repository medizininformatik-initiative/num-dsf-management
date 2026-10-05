/**
 * AuditEntryRow.tsx – one audit entry as a table row plus an expandable detail row.
 * Flagged entries get a coloured left accent AND a StatusPill with icon and rule
 * title (never colour alone); the detail row explains each rule and lists the
 * recorded fields as a before/after table. FHIR field names stay as recorded.
 * Dependencies: StatusPill, Icon, i18n store, lib/auditDescribe, lib/dateUtils
 */
import { Fragment } from 'react';
import { Icon } from '../ui/Icon';
import { StatusPill } from '../ui/StatusPill';
import { useI18n } from '../../stores/i18n.store';
import type { AuditEntry, AuditFlagSeverity } from '../../api/audit.api';
import { formatDateTime, relTime } from '../../lib/dateUtils';
import { OPERATION, RESOURCE } from './auditConfig';
import {
  FLAG_META,
  SEVERITY_ICON,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  describeEvent,
  diffTable,
  topFlag,
} from '../../lib/auditDescribe';

// Complete literal class names so Tailwind keeps them.
const ACCENT: Record<AuditFlagSeverity, string> = {
  info: 'border-l-[color:var(--tone-info-fg)]',
  warning: 'border-l-[color:var(--tone-warning-fg)]',
  critical: 'border-l-[color:var(--tone-danger-fg)]',
};

const ICON_TEXT: Record<AuditFlagSeverity, string> = {
  info: 'text-info-fg',
  warning: 'text-warning-fg',
  critical: 'text-danger-fg',
};

const TH = 'px-2 py-1.5 text-left text-[12px] font-bold text-[color:var(--text-secondary)]';
const TD = 'px-3 py-2.5 align-top text-[color:var(--text-primary)]';

interface Props {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
  colSpan: number;
}

export function AuditEntryRow({ entry, expanded, onToggle, colSpan }: Props) {
  const { t, lang } = useI18n();
  const op = OPERATION[entry.operation];
  const resourceKey = RESOURCE[entry.resource_type];
  const resourceLabel = resourceKey ? t(resourceKey) : entry.resource_type;
  const opLabel = op ? t(op.label) : entry.operation;
  const description = describeEvent(entry);
  const eventText = description
    ? t(description.key, description.vars)
    : t('auditEvGeneric', { resource: resourceLabel, operation: opLabel });
  const flags = entry.flags ?? [];
  const top = topFlag(flags);
  const table = diffTable(entry.diff_json);
  const detailId = `audit-detail-${entry.id}`;
  const site =
    entry.organization_name ??
    entry.instance_label ??
    (entry.instance_id ? entry.instance_id.slice(0, 8) : '—');

  return (
    <Fragment>
      <tr
        data-flag={top?.severity}
        className="border-t border-[color:var(--border)] transition-colors hover:bg-[color:var(--bg-hover)]"
      >
        <td
          className={`${TD} border-l-4 ${top ? ACCENT[top.severity] : 'border-l-transparent'} whitespace-nowrap`}
        >
          <div className="flex items-start gap-1.5">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={detailId}
              aria-label={expanded ? t('auditRowHideDetails') : t('auditRowShowDetails')}
              className="press-effect -ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-hover)]"
            >
              <Icon name={expanded ? 'expand_more' : 'chevron_right'} size={18} />
            </button>
            <div>
              <div>{formatDateTime(entry.timestamp, lang)}</div>
              <div className="text-[11px] text-[color:var(--text-muted)]">
                {relTime(entry.timestamp, t)}
              </div>
            </div>
          </div>
        </td>
        <td className={TD}>
          <div>{eventText}</div>
          {flags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {flags.map((f) => {
                const meta = FLAG_META[f.code];
                return (
                  <StatusPill
                    key={f.code}
                    tone={SEVERITY_TONE[f.severity]}
                    icon={SEVERITY_ICON[f.severity]}
                    title={meta ? t(meta.explain) : undefined}
                  >
                    {meta ? t(meta.title) : f.code}
                  </StatusPill>
                );
              })}
            </div>
          )}
        </td>
        <td className={`${TD} font-mono`}>{entry.user_email ?? '—'}</td>
        <td className={TD}>
          {site}
          {entry.organization_identifier && (
            <div className="font-mono text-[11px] text-[color:var(--text-muted)]">
              {entry.organization_identifier}
            </div>
          )}
        </td>
        <td className={TD}>{resourceLabel}</td>
        <td className={TD}>
          <StatusPill tone={op?.tone ?? 'neutral'} className="capitalize">
            {opLabel}
          </StatusPill>
        </td>
        <td className={`${TD} font-mono text-[color:var(--text-muted)]`}>
          {entry.ip_address ?? '—'}
        </td>
      </tr>
      {expanded && (
        <tr id={detailId} className="bg-[color:var(--bg-hover)]">
          <td colSpan={colSpan} className="px-4 py-3">
            {flags.length > 0 && (
              <div className="mb-3">
                <h3 className="m-0 mb-1 text-[12px] font-bold text-[color:var(--text-secondary)]">
                  {t('auditDetailRules')}
                </h3>
                <ul className="m-0 list-none space-y-1 p-0">
                  {flags.map((f) => {
                    const meta = FLAG_META[f.code];
                    return (
                      <li key={f.code} className="flex items-start gap-2 text-[13px]">
                        <Icon
                          name={SEVERITY_ICON[f.severity]}
                          size={16}
                          className={`mt-0.5 ${ICON_TEXT[f.severity]}`}
                        />
                        <span>
                          <strong>{meta ? t(meta.title) : f.code}</strong>
                          {' · '}
                          <span className="text-[color:var(--text-secondary)]">
                            {t(SEVERITY_LABEL[f.severity])}
                          </span>
                          {meta && (
                            <span className="block text-[color:var(--text-secondary)]">
                              {t(meta.explain)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <h3 className="m-0 mb-1 text-[12px] font-bold text-[color:var(--text-secondary)]">
              {t('auditDetailsTitle')}
            </h3>
            {entry.resource_id && (
              <p className="m-0 mb-2 text-[12px] text-[color:var(--text-secondary)]">
                {t('auditColResourceId')}:{' '}
                <span className="font-mono text-[color:var(--text-primary)]">
                  {entry.resource_id}
                </span>
              </p>
            )}
            {table && table.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr>
                      <th className={TH}>{t('auditDetailField')}</th>
                      {table.kind === 'change' ? (
                        <>
                          <th className={TH}>{t('auditDetailBefore')}</th>
                          <th className={TH}>{t('auditDetailAfter')}</th>
                        </>
                      ) : (
                        <th className={TH}>{t('auditDetailValue')}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r) => (
                      <tr key={r.field} className="border-t border-[color:var(--border)]">
                        <td className="px-2 py-1.5 align-top font-mono">{r.field}</td>
                        {table.kind === 'change' ? (
                          <>
                            <td className="px-2 py-1.5 align-top font-mono break-all">
                              {r.before}
                            </td>
                            <td className="px-2 py-1.5 align-top font-mono break-all">{r.after}</td>
                          </>
                        ) : (
                          <td className="px-2 py-1.5 align-top font-mono break-all">{r.value}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="m-0 text-[12px] text-[color:var(--text-muted)]">
                {t('auditDetailNone')}
              </p>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}
