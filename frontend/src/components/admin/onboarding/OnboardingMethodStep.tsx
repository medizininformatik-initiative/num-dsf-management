/**
 * OnboardingMethodStep.tsx – step 1 of the bulk onboarding flow: pick how to
 * enter the sites (type them into the in-tool editor, or upload a CSV / XLSX /
 * JSON file) and download the CSV or XLSX template.
 * Dependencies: Button, Icon, onboarding.api (template download), sonner, i18n store.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { useI18n } from '../../../stores/i18n.store';
import {
  downloadOnboardingTemplate,
  type OnboardingTemplateKind,
} from '../../../api/onboarding.api';
import type { TranslationKey } from '../../../i18n/en';

export type OnboardingMethod = 'editor' | 'file';

const METHODS: {
  id: OnboardingMethod;
  title: TranslationKey;
  body: TranslationKey;
}[] = [
  { id: 'editor', title: 'onbMethodEditorTitle', body: 'onbMethodEditorBody' },
  { id: 'file', title: 'onbMethodFileTitle', body: 'onbMethodFileBody' },
];

export function OnboardingMethodStep({ onChoose }: { onChoose: (m: OnboardingMethod) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<OnboardingTemplateKind | null>(null);

  async function download(kind: OnboardingTemplateKind) {
    setBusy(kind);
    try {
      await downloadOnboardingTemplate(kind);
    } catch {
      toast.error(t('onbTemplateFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="onboarding-step-method">
      <div className="grid gap-3 sm:grid-cols-2">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChoose(m.id)}
            data-testid={`onboarding-method-${m.id}`}
            className="surface-card hover-lift press-effect flex flex-col items-start gap-1 p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]"
          >
            <span className="text-base font-semibold text-[color:var(--text-primary)]">
              {t(m.title)}
            </span>
            <span className="text-sm text-[color:var(--text-secondary)]">{t(m.body)}</span>
          </button>
        ))}
      </div>

      <section className="surface-card p-5">
        <h2 className="text-base font-semibold text-[color:var(--text-primary)]">
          {t('onbTemplatesTitle')}
        </h2>
        <p className="mt-1 text-xs text-[color:var(--text-secondary)]">{t('onbTemplatesBody')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['xlsx', 'csv'] as const).map((kind) => (
            <Button
              key={kind}
              variant="secondary"
              size="sm"
              onClick={() => download(kind)}
              disabled={busy !== null}
              data-testid={`onboarding-template-${kind}`}
            >
              <Icon name="download" size={16} />
              {t(kind === 'xlsx' ? 'onbTemplateXlsx' : 'onbTemplateCsv')}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
