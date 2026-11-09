/**
 * HelpPage.tsx – User help for a site: getting started, the entities, certificate
 * thumbprint, approval and four-eyes review, what happens afterwards, the DSF import,
 * renewal, withdrawal, FAQ and contact. A sticky glass header carries the search field
 * and the table of contents (the section in view is highlighted); a search narrows
 * sections and FAQ entries live. TOC links and #anchors scroll with scrollIntoViewSafe
 * (instant under Reduce Motion), a FAQ deep link (#faq-2) also opens its answer, and the
 * sections reveal with a short stagger. Content structure: lib/helpContent, texts: i18n.
 * Dependencies: react-router-dom, i18n store, useMe, lib (helpContent, motion),
 * AdminPageHeader, Button, Icon, sonner.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useI18n } from '../stores/i18n.store';
import { useMe } from '../hooks/useMe';
import { scrollIntoViewSafe } from '../lib/motion';
import { HELP_FAQ, HELP_SECTIONS, type HelpBlock } from '../lib/helpContent';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

const CHIP =
  'press-effect inline-block rounded-full px-2.5 py-1 text-xs font-medium text-primary dark:text-brand-400 hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)]';
const CHIP_ACTIVE = 'bg-[color:var(--accent-surface)] !text-[color:var(--accent-on-surface)]';
const BODY =
  'max-w-prose space-y-2 text-sm leading-relaxed text-[color:var(--text-secondary)] [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5';

function stagger(i: number): CSSProperties {
  return { '--stagger-index': Math.min(i, 8) } as CSSProperties;
}

/** A command or link the reader copies as is. */
function CodeLine({ text }: { text: string }) {
  const { t } = useI18n();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('dlCopied'));
    } catch {
      toast.error(t('downloadCopyFailed'));
    }
  }
  return (
    <div className="flex items-start gap-2">
      <code className="mono-id min-w-0 flex-1 select-all break-all rounded-control border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2.5 py-2 text-[11px] leading-5 text-[color:var(--text-primary)]">
        {text}
      </code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('downloadCopyValue', { label: text })}
        onClick={() => void copy()}
        className="h-8 w-8 shrink-0 !px-0"
      >
        <Icon name="content_copy" size={16} />
      </Button>
    </div>
  );
}

function Blocks({ blocks }: { blocks: HelpBlock[] }) {
  const { t } = useI18n();
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'p') return <p key={i}>{t(b.key)}</p>;
        if (b.kind === 'code') {
          const text = b.text.startsWith('/') ? `${window.location.origin}${b.text}` : b.text;
          return <CodeLine key={i} text={text} />;
        }
        const List = b.kind;
        return (
          <List key={i}>
            {b.keys.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </List>
        );
      })}
    </>
  );
}

function Section({
  id,
  title,
  index,
  children,
}: {
  id: string;
  title: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-help-section
      className="mb-8 animate-list-item-in scroll-mt-44"
      style={stagger(index)}
    >
      <h2 id={`${id}-title`} className="mb-2 text-lg font-bold text-[color:var(--text-primary)]">
        {title}
      </h2>
      <div className={BODY}>{children}</div>
    </section>
  );
}

export function HelpPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { hash } = useLocation();
  const searchId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const matches = useCallback(
    (...texts: string[]) => !needle || texts.some((x) => x.toLowerCase().includes(needle)),
    [needle],
  );

  const sections = useMemo(
    () =>
      HELP_SECTIONS.filter((s) =>
        matches(
          t(s.titleKey),
          ...s.blocks.flatMap((b) =>
            b.kind === 'p' ? [t(b.key)] : b.kind === 'code' ? [b.text] : b.keys.map((k) => t(k)),
          ),
        ),
      ),
    [matches, t],
  );
  const faq = useMemo(() => HELP_FAQ.filter((f) => matches(t(f.qKey), t(f.aKey))), [matches, t]);
  const showContact = matches(t('helpContactTitle'), t('helpContactBody'));
  const total = sections.length + (faq.length > 0 ? 1 : 0) + (showContact ? 1 : 0);

  const toc = [
    ...sections.map((s) => ({ id: s.id, label: t(s.tocKey) })),
    ...(faq.length > 0 ? [{ id: 'faq', label: t('helpFaqToc') }] : []),
    ...(showContact ? [{ id: 'contact', label: t('helpContactToc') }] : []),
  ];
  const tocKey = toc.map((x) => x.id).join('|');

  /** Scroll to a section or FAQ entry, opening a FAQ answer on the way. */
  const reveal = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target) return false;
    if (target instanceof HTMLDetailsElement) target.open = true;
    scrollIntoViewSafe(target, { block: 'start' });
    return true;
  }, []);

  // Deep links: open the page on #anchor, and follow later hash changes.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (id) reveal(id);
  }, [hash, reveal]);

  // Highlight the table-of-contents entry of the section in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !rootRef.current) return;
    const root = rootRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActiveId(e.target.id);
      },
      { root, rootMargin: '-25% 0px -65% 0px' },
    );
    root.querySelectorAll('[data-help-section]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tocKey]);

  function jumpTo(e: MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    if (reveal(id)) window.history.replaceState(null, '', `#${id}`);
  }

  return (
    <div ref={rootRef} className="flex-1 overflow-y-auto">
      <AdminPageHeader
        title={t('helpTitle')}
        subtitle={t('helpSubtitle')}
        actions={
          me?.isAdmin ? (
            <Link
              to="/app/admin/help"
              className="press-effect inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-primary hover:bg-[color:var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] dark:text-brand-400"
            >
              <Icon name="admin_panel_settings" size={16} />
              {t('helpAdminLink')}
            </Link>
          ) : undefined
        }
        toolbar={
          <div className="space-y-2">
            <div className="glass flex max-w-md items-center gap-2 rounded-full px-4 py-1">
              <Icon name="search" size={18} className="text-[color:var(--text-muted)]" />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('helpSearchPlaceholder')}
                aria-label={t('helpSearchLabel')}
                className="min-h-[32px] min-w-0 flex-1 border-0 bg-transparent text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
              />
            </div>
            <nav aria-label={t('helpTocLabel')}>
              <ul className="flex flex-wrap gap-1">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={(e) => jumpTo(e, item.id)}
                      aria-current={activeId === item.id ? 'location' : undefined}
                      className={`${CHIP} ${activeId === item.id ? CHIP_ACTIVE : ''}`}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        }
      />

      <div className="px-6 py-6 sm:px-8">
        {total === 0 ? (
          <div role="status" className="glass-thin animate-fade-in rounded-card p-6 text-center">
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">
              {t('helpNoResults', { query: query.trim() })}
            </p>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">{t('helpNoResultsHint')}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setQuery('')}>
              {t('helpClearSearch')}
            </Button>
          </div>
        ) : (
          <>
            {sections.map((s, i) => (
              <Section key={s.id} id={s.id} title={t(s.titleKey)} index={i}>
                <Blocks blocks={s.blocks} />
              </Section>
            ))}

            {faq.length > 0 && (
              <Section id="faq" title={t('helpFaqTitle')} index={sections.length}>
                <div className="space-y-2">
                  {faq.map((f) => (
                    <details
                      key={f.id}
                      id={f.id}
                      className="group/faq glass-thin scroll-mt-44 rounded-card px-4 py-2"
                    >
                      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] [&::-webkit-details-marker]:hidden">
                        <Icon
                          name="chevron_right"
                          size={18}
                          className="shrink-0 transition-transform duration-short ease-spring group-open/faq:rotate-90"
                        />
                        {t(f.qKey)}
                      </summary>
                      <p className="animate-fade-in pb-1 pl-7 pt-1">{t(f.aKey)}</p>
                    </details>
                  ))}
                </div>
              </Section>
            )}

            {showContact && (
              <Section id="contact" title={t('helpContactTitle')} index={sections.length + 1}>
                <p>{t('helpContactBody')}</p>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Link
                    to="/app/legal"
                    className="font-semibold text-[color:var(--accent)] underline"
                  >
                    {t('helpLegalLink')}
                  </Link>
                </p>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
