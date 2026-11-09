/**
 * AuditFilterBar.tsx – filter controls of the audit log (time range, user, site,
 * resource, operation, free text, "anomalies only") plus reset and CSV/JSON export.
 * Fully controlled: the page owns the form state and applies it to the query.
 * Dependencies: Button, Icon, FormField classes, i18n store, audit.api types
 */
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { inputClass, selectClass, checkboxClass } from '../modals/FormField';
import { useI18n } from '../../stores/i18n.store';
import type { AuditSite } from '../../api/audit.api';
import {
  EMPTY_FILTERS,
  OPERATION_OPTIONS,
  RESOURCE_OPTIONS,
  type AuditFilterForm,
} from './auditConfig';

const LABEL = 'mb-1 block text-[12px] font-semibold text-[color:var(--text-secondary)]';

interface Props {
  value: AuditFilterForm;
  onChange: (next: AuditFilterForm) => void;
  sites: AuditSite[];
  exporting: boolean;
  onExport: (format: 'csv' | 'json') => void;
}

export function AuditFilterBar({ value, onChange, sites, exporting, onExport }: Props) {
  const { t } = useI18n();
  const set = <K extends keyof AuditFilterForm>(key: K, v: AuditFilterForm[K]) =>
    onChange({ ...value, [key]: v });
  const dirty = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <form
      role="search"
      aria-label={t('auditFilters')}
      onSubmit={(e) => e.preventDefault()}
      className="glass-thin mb-4 rounded-card p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="audit-from" className={LABEL}>
            {t('auditFilterFrom')}
          </label>
          <input
            id="audit-from"
            type="date"
            className={inputClass}
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => set('from', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="audit-to" className={LABEL}>
            {t('auditFilterTo')}
          </label>
          <input
            id="audit-to"
            type="date"
            className={inputClass}
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="audit-actor" className={LABEL}>
            {t('auditFilterActor')}
          </label>
          <input
            id="audit-actor"
            type="text"
            className={inputClass}
            value={value.actor}
            placeholder={t('auditFilterActorPlaceholder')}
            onChange={(e) => set('actor', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="audit-site" className={LABEL}>
            {t('auditFilterSite')}
          </label>
          <select
            id="audit-site"
            className={selectClass}
            value={value.instanceId}
            onChange={(e) => set('instanceId', e.target.value)}
          >
            <option value="">{t('auditFilterAllSites')}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.org_name ?? s.label ?? s.id.slice(0, 8)}
                {s.org_identifier ? ` (${s.org_identifier})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-resource" className={LABEL}>
            {t('auditColResource')}
          </label>
          <select
            id="audit-resource"
            className={selectClass}
            value={value.resource}
            onChange={(e) => set('resource', e.target.value)}
          >
            <option value="">{t('auditAllResources')}</option>
            {RESOURCE_OPTIONS.map(([v, key]) => (
              <option key={v} value={v}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-operation" className={LABEL}>
            {t('auditColOperation')}
          </label>
          <select
            id="audit-operation"
            className={selectClass}
            value={value.operation}
            onChange={(e) => set('operation', e.target.value)}
          >
            <option value="">{t('auditAllOperations')}</option>
            {OPERATION_OPTIONS.map(([v, key]) => (
              <option key={v} value={v}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="audit-q" className={LABEL}>
            {t('auditFilterSearch')}
          </label>
          <input
            id="audit-q"
            type="search"
            className={inputClass}
            value={value.q}
            placeholder={t('auditFilterSearchPlaceholder')}
            onChange={(e) => set('q', e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[color:var(--text-primary)]">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={value.flaggedOnly}
            onChange={(e) => set('flaggedOnly', e.target.checked)}
          />
          {t('auditFilterFlaggedOnly')}
        </label>
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)} disabled={!dirty}>
          {t('auditFilterReset')}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[color:var(--text-muted)]">{t('auditExportHint')}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={exporting}
            onClick={() => onExport('csv')}
          >
            <Icon name="download" size={16} />
            {t('auditExportCsv')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exporting}
            onClick={() => onExport('json')}
          >
            <Icon name="download" size={16} />
            {t('auditExportJson')}
          </Button>
        </div>
      </div>
    </form>
  );
}
