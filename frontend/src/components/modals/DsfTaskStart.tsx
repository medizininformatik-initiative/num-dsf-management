/**
 * DsfTaskStart.tsx — "Start it in your DSF" section of the download dialog.
 * For the selected endpoint it builds the link to the draft Task of the
 * downloadAllowList process on the site's own DSF FHIR server (the endpoint's
 * FHIR base address), opened in a new tab, and puts the allow-list link to
 * paste next to it, with a three-step guide: open the Task, paste the link into
 * the "allow_list" input, start the process. Only http(s) bases give a link.
 * Dependencies: Button, Icon, lib/dsfTaskLink, i18n store.
 */
import { useId, type ReactNode } from 'react';
import { dsfTaskSearchUrl } from '../../lib/dsfTaskLink';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface Props {
  /** FHIR base address of the selected endpoint; undefined while none is selected. */
  fhirBase: string | undefined;
  /** Allow-list link to paste (the current bundle of the endpoint); '' without one. */
  allowListUrl: string;
  onCopy: (text: string) => void;
}

const codeBox =
  'min-w-0 flex-1 break-all rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-3 font-mono text-[11px] text-[color:var(--text-primary)]';

function StepRow({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </li>
  );
}

export function DsfTaskStart({ fhirBase, allowListUrl, onCopy }: Props) {
  const { t } = useI18n();
  const uid = useId();
  const taskUrl = dsfTaskSearchUrl(fhirBase);
  const title = 'text-xs font-bold text-[color:var(--text-primary)]';

  return (
    <section className="glass-thin rounded-2xl p-4" aria-labelledby={`${uid}-task`}>
      <h3 id={`${uid}-task`} className="text-sm font-bold text-[color:var(--text-primary)]">
        {t('dsfTaskTitle')}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
        {t('dsfTaskHelp')}
      </p>

      {fhirBase === undefined ? (
        <p className="mt-3 text-xs italic text-[color:var(--text-muted)]">{t('dsfTaskPick')}</p>
      ) : !taskUrl ? (
        <p role="alert" className="mt-3 text-xs font-medium text-warning-fg">
          {t('dsfTaskInvalidBase')}
        </p>
      ) : (
        <ol className="mt-3 space-y-4" data-testid="dsf-task-steps">
          <StepRow n={1}>
            <p className={title}>{t('dsfTaskStep1')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={taskUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="dsf-task-open"
                className="btn press-effect btn-md btn-primary"
              >
                <Icon name="open_in_new" size={16} />
                {t('dsfTaskOpen')}
              </a>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onCopy(taskUrl)}
                data-testid="dsf-task-copy"
              >
                <Icon name="content_copy" size={16} />
                {t('dsfTaskCopy')}
              </Button>
            </div>
          </StepRow>
          <StepRow n={2}>
            <p className={title}>{t('dsfTaskStep2')}</p>
            <div className="flex items-start gap-2">
              <code className={codeBox} data-testid="dsf-task-allowlist-url">
                {allowListUrl}
              </code>
              <button
                type="button"
                onClick={() => onCopy(allowListUrl)}
                aria-label={t('dsfTaskCopyAllowList')}
                className="press-effect inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
              >
                <Icon name="content_copy" size={18} />
              </button>
            </div>
          </StepRow>
          <StepRow n={3}>
            <p className={title}>{t('dsfTaskStep3')}</p>
          </StepRow>
        </ol>
      )}
    </section>
  );
}
