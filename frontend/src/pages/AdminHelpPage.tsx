/**
 * AdminHelpPage.tsx – Admin reference manual: approval workflow, audit,
 * bundle downloads, cert renewals, mTLS sign-in, support contacts.
 * i18n via t() keys; built-in EN and DE. The table of contents rides in the
 * sticky glass header; its links scroll with scrollIntoViewSafe (instant under
 * Reduce Motion) and sections keep clear of the sticky header (scroll-margin).
 * Dependencies: i18n store, lib/motion, AdminPageHeader.
 */
import type { MouseEvent, ReactNode } from 'react';
import { useI18n } from '../stores/i18n.store';
import { scrollIntoViewSafe } from '../lib/motion';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';

const SECTION_IDS = [
  'approval',
  'crossUser',
  'audit',
  'download',
  'certs',
  'mtls',
  'support',
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-8 scroll-mt-40">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-[color:var(--text-primary)]">
        <span aria-hidden="true" className="h-5 w-1 rounded-sm bg-primary" />
        {title}
      </h2>
      <div className="max-w-3xl space-y-2 text-[13px] leading-relaxed text-[color:var(--text-secondary)] [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function AdminHelpPage() {
  const { t } = useI18n();

  const TOC_LABEL: Record<(typeof SECTION_IDS)[number], string> = {
    approval: t('adminHelpToc_approval'),
    crossUser: t('adminHelpToc_crossUser'),
    audit: t('adminHelpToc_audit'),
    download: t('adminHelpToc_download'),
    certs: t('adminHelpToc_certs'),
    mtls: t('adminHelpToc_mtls'),
    support: t('adminHelpToc_support'),
  };

  function jumpTo(e: MouseEvent<HTMLAnchorElement>, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    scrollIntoViewSafe(target, { block: 'start' });
    window.history.replaceState(null, '', `#${id}`);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <AdminPageHeader
        icon="help"
        title={t('adminHelpTitle')}
        subtitle={t('adminHelpSubtitle')}
        toolbar={
          <nav
            aria-labelledby="admin-help-toc"
            className="flex flex-wrap items-center gap-x-1 gap-y-1"
          >
            <p
              id="admin-help-toc"
              className="mr-2 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-secondary)]"
            >
              {t('adminHelpToc')}
            </p>
            <ul className="flex flex-wrap gap-1">
              {SECTION_IDS.map((id) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={(e) => jumpTo(e, id)}
                    className="press-effect inline-block rounded-full px-2.5 py-1 text-xs font-medium text-primary dark:text-brand-400 hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] dark:text-brand-400"
                  >
                    {TOC_LABEL[id]}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        }
      />

      <div className="animate-fade-in px-6 py-6 sm:px-8">
        <Section id="approval" title={t('adminHelpApprovalTitle')}>
          <p>{t('adminHelpApprovalP1')}</p>
          <p>{t('adminHelpApprovalP2')}</p>
          <ul>
            <li>{t('adminHelpApprovalLi1')}</li>
            <li>{t('adminHelpApprovalLi2')}</li>
            <li>{t('adminHelpApprovalLi3')}</li>
          </ul>
        </Section>

        <Section id="crossUser" title={t('adminHelpCrossUserTitle')}>
          <p>{t('adminHelpCrossUserP1')}</p>
          <p>{t('adminHelpCrossUserP2')}</p>
        </Section>

        <Section id="audit" title={t('adminHelpAuditTitle')}>
          <p>{t('adminHelpAuditP1')}</p>
        </Section>

        <Section id="download" title={t('adminHelpDownloadTitle')}>
          <p>{t('adminHelpDownloadP1')}</p>
        </Section>

        <Section id="certs" title={t('adminHelpCertsTitle')}>
          <p>{t('adminHelpCertsP1')}</p>
        </Section>

        <Section id="mtls" title={t('adminHelpMtlsTitle')}>
          <p>{t('adminHelpMtlsP1')}</p>
        </Section>

        <Section id="support" title={t('adminHelpSupportTitle')}>
          <p>{t('adminHelpSupportP1')}</p>
          <p className="mt-3 text-xs text-[color:var(--text-muted)]">{t('footerAffiliation')}</p>
        </Section>
      </div>
    </div>
  );
}
