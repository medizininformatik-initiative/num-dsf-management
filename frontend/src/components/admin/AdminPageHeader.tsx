/**
 * AdminPageHeader.tsx – the title bar of the admin pages: page title,
 * subtitle and optional actions on a sticky chrome-glass bar, so the
 * title (and an optional toolbar row such as tabs or a search field) stays in
 * view while long lists scroll underneath and blur through it. Render it as
 * the first child of the page's scroll container. The breadcrumb trail lives
 * inside this bar, above the title, and the bar spans the full page width.
 * Dependencies: Breadcrumbs, the .glass-chrome material (src/index.css).
 */
import type { ReactNode } from 'react';
import { Breadcrumbs } from '../layout/Breadcrumbs';

export interface AdminPageHeaderProps {
  title: string;
  subtitle?: string;
  /** Right-aligned controls, e.g. a help link. */
  actions?: ReactNode;
  /** Second row inside the sticky bar, e.g. tabs or a filter toolbar. */
  toolbar?: ReactNode;
}

export function AdminPageHeader({ title, subtitle, actions, toolbar }: AdminPageHeaderProps) {
  return (
    <header className="glass-chrome sticky top-0 z-20 px-6 py-4 sm:px-8">
      <Breadcrumbs />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight text-[color:var(--text-primary)]">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 text-sm text-[color:var(--text-muted)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {toolbar && <div className="mt-3">{toolbar}</div>}
    </header>
  );
}
