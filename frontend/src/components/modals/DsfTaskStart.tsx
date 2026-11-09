/**
 * DsfTaskStart.tsx — "Variant 1: DSF web UI (recommended)" of the download
 * dialog, in the structure of the previous allow-list tool: (1) intro,
 * (2) install the DSF allow list plugin (releases link), (3) open the draft
 * Task of the downloadAllowList process on the site's own DSF FHIR server (the
 * endpoint's FHIR base address; button plus the readable URL), (4) enter the
 * download URL of the selected endpoint into the Task. The shared
 * /fhir/Bundle/mine link follows as a secondary hint. Only http(s) bases give
 * a Task link.
 * Dependencies: Button, Icon, SharedAllowListLink, lib/dsfTaskLink, i18n store.
 */
import { useId, type ReactNode } from 'react';
import { PLUGIN_RELEASES_URL, dsfTaskDisplayUrl, dsfTaskSearchUrl } from '../../lib/dsfTaskLink';
import { useI18n } from '../../stores/i18n.store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { SharedAllowListLink } from './SharedAllowListLink';

interface Props {
  /** FHIR base address of the selected endpoint; undefined while none is selected. */
  fhirBase: string | undefined;
  /** Download URL of the selected endpoint (https://<portal>/fhir/Bundle/<id>); '' without one. */
  endpointUrl: string;
  /** Shared https://<portal>/fhir/Bundle/mine link. */
  sharedUrl: string;
  onCopy: (text: string) => void;
}

const codeBox =
  'min-w-0 flex-1 break-all rounded-control border border-[color:var(--border)] bg-[color:var(--bg-card)] px-3 py-2 font-mono text-2xs text-[color:var(--text-primary)]';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]';

function StepRow({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="-mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--border-strong)] text-xs font-semibold text-[color:var(--text-secondary)]"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </li>
  );
}

function CopyButton({
  label,
  value,
  onCopy,
  testId,
}: {
  label: string;
  value: string;
  onCopy: (text: string) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value)}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={`press-effect inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-primary)] ${focusRing}`}
    >
      <Icon name="content_copy" size={18} />
    </button>
  );
}

export function DsfTaskStart({ fhirBase, endpointUrl, sharedUrl, onCopy }: Props) {
  const { t } = useI18n();
  const uid = useId();
  const taskHref = dsfTaskSearchUrl(fhirBase);
  const taskText = dsfTaskDisplayUrl(fhirBase);
  const title = 'text-xs font-semibold text-[color:var(--text-primary)]';

  return (
    <section
      className="rounded-control border border-[color:var(--border)] p-3"
      aria-labelledby={`${uid}-task`}
    >
      <h3 id={`${uid}-task`} className="text-sm font-semibold text-[color:var(--text-primary)]">
        {t('dsfTaskTitle')}
      </h3>

      {fhirBase === undefined ? (
        <p className="mt-3 text-xs text-[color:var(--text-muted)]">{t('dsfTaskPick')}</p>
      ) : !taskHref || !taskText ? (
        <p role="alert" className="mt-3 text-xs font-medium text-warning-fg">
          {t('dsfTaskInvalidBase')}
        </p>
      ) : (
        <>
          <ol className="mt-3 space-y-4" data-testid="dsf-task-steps">
            <StepRow n={1}>
              <p className="text-xs leading-relaxed text-[color:var(--text-secondary)]">
                {t('dsfTaskHelp')}
              </p>
            </StepRow>
            <StepRow n={2}>
              <p className={title}>{t('dsfTaskStep1')}</p>
              <a
                href={PLUGIN_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="dsf-plugin-link"
                className={`inline-flex items-center gap-1 break-all rounded-small text-xs font-semibold text-[color:var(--accent)] underline underline-offset-2 ${focusRing}`}
              >
                {PLUGIN_RELEASES_URL}
                <Icon name="open_in_new" size={14} />
              </a>
            </StepRow>
            <StepRow n={3}>
              <p className={title}>{t('dsfTaskStep2')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={taskHref}
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
                  onClick={() => onCopy(taskHref)}
                  data-testid="dsf-task-copy"
                >
                  <Icon name="content_copy" size={16} />
                  {t('dsfTaskCopy')}
                </Button>
              </div>
              <code className={`${codeBox} block`} data-testid="dsf-task-url">
                {taskText}
              </code>
            </StepRow>
            <StepRow n={4}>
              <p className={title}>{t('dsfTaskStep3')}</p>
              <div className="flex items-start gap-2">
                <code className={codeBox} data-testid="dsf-link">
                  {endpointUrl}
                </code>
                <CopyButton
                  label={t('dsfTaskCopyAllowList')}
                  value={endpointUrl}
                  onCopy={onCopy}
                  testId="copy-dsf-link"
                />
              </div>
            </StepRow>
          </ol>
          <SharedAllowListLink url={sharedUrl} onCopy={onCopy} />
        </>
      )}
    </section>
  );
}
