/**
 * TanListPanel.tsx – the TAN list (the single-use backup codes) right after it
 * was generated: the codes, copy, download as .txt and print, a warning that
 * the list is shown only now, and a required "I have stored the TAN list"
 * confirmation before Continue is enabled. Used by the forced enrolment, the
 * re-setup and the "new TAN list" action on the security page.
 * Print opens a plain window built with DOM text nodes (nothing is injected as
 * HTML) and prints it.
 * Dependencies: Button, Icon, i18n store, lib/environment, lib/dateUtils, sonner.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useI18n } from '../../stores/i18n.store';
import { DSF_ENVIRONMENT } from '../../lib/environment';
import { formatDateTime } from '../../lib/dateUtils';

export const TAN_LIST_FILENAME = 'dsf-tan-list.txt';

interface TanListPanelProps {
  codes: string[];
  email?: string;
  continueLabel: string;
  onContinue: () => void;
}

export function TanListPanel({ codes, email, continueLabel, onContinue }: TanListPanelProps) {
  const { t, lang } = useI18n();
  const [stored, setStored] = useState(false);

  const heading = t('tanPrintHeading', { env: DSF_ENVIRONMENT });
  const created = t('totpBackupFileCreated', {
    date: formatDateTime(new Date().toISOString(), lang),
  });
  const account = email ? t('totpBackupFileAccount', { email }) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success(t('totpBackupCopied'));
    } catch {
      toast.error(t('totpBackupCopyFailed'));
    }
  }

  function download() {
    const lines = [
      heading,
      ...(account ? [account] : []),
      created,
      '',
      ...codes,
      '',
      t('tanFileNote'),
    ];
    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = TAN_LIST_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function print() {
    const win = window.open('', '_blank', 'width=640,height=800');
    if (!win) {
      toast.error(t('totpBackupCopyFailed'));
      return;
    }
    const doc = win.document;
    doc.title = heading;
    const style = doc.createElement('style');
    style.textContent =
      'body{font-family:sans-serif;margin:2rem}h1{font-size:1.2rem}li{font-family:monospace;font-size:1.3rem;letter-spacing:.15em;margin:.4rem 0}p{font-size:.85rem}';
    doc.head.appendChild(style);
    const h1 = doc.createElement('h1');
    h1.textContent = heading;
    doc.body.appendChild(h1);
    for (const text of [account, created]) {
      if (!text) continue;
      const p = doc.createElement('p');
      p.textContent = text;
      doc.body.appendChild(p);
    }
    const ol = doc.createElement('ol');
    for (const c of codes) {
      const li = doc.createElement('li');
      li.textContent = c;
      ol.appendChild(li);
    }
    doc.body.appendChild(ol);
    const note = doc.createElement('p');
    note.textContent = t('tanFileNote');
    doc.body.appendChild(note);
    win.focus();
    win.print();
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[color:var(--text-secondary)]">{t('tanListIntro')}</p>
      <ol
        aria-label={t('tanListTitle')}
        className="grid list-none grid-cols-2 gap-2 rounded-control bg-[color:var(--bg-hover)] p-3"
      >
        {codes.map((c, i) => (
          <li key={i}>
            <code className="block rounded-small border border-[color:var(--border)] bg-[color:var(--bg-card)] px-2 py-1 text-center font-mono text-sm tracking-widest text-[color:var(--text-primary)]">
              {c}
            </code>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="flex-1" onClick={copy}>
          <Icon name="content_copy" size={14} />
          {t('totpBackupCopyAll')}
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={download}>
          <Icon name="download" size={14} />
          {t('totpBackupDownload')}
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={print}>
          <Icon name="print" size={14} />
          {t('tanPrint')}
        </Button>
      </div>

      <div className="flex gap-2 rounded-control border border-warning-border bg-warning-surface p-3 text-xs text-warning-fg">
        <Icon name="warning" size={14} className="mt-px shrink-0" />
        <p>{t('totpBackupWarning')}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[color:var(--text-primary)]">
        <input
          type="checkbox"
          checked={stored}
          onChange={(e) => setStored(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
        />
        {t('tanStoredConfirm')}
      </label>

      <Button className="w-full" disabled={!stored} onClick={onContinue}>
        {continueLabel}
      </Button>
    </div>
  );
}
