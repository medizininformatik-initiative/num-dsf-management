/**
 * helpContent.ts – Structure of the user help page: the ordered sections (id, icon,
 * title/toc keys and their paragraph, list and code blocks) and the FAQ entries.
 * The texts themselves live in the i18n tables (keys helpS_*, helpFaq_*); the page
 * resolves them, filters by the search term and renders the blocks.
 * Dependencies: i18n/en (TranslationKey).
 */
import type { TranslationKey } from '../i18n/en';

export type HelpBlock =
  | { kind: 'p'; key: TranslationKey }
  | { kind: 'ul' | 'ol'; keys: TranslationKey[] }
  | { kind: 'code'; text: string }
  /** The incident process diagram. */
  | { kind: 'incidentFlow' };

export interface HelpSection {
  id: string;
  icon: string;
  titleKey: TranslationKey;
  tocKey: TranslationKey;
  blocks: HelpBlock[];
}

export interface HelpFaq {
  id: string;
  qKey: TranslationKey;
  aKey: TranslationKey;
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'start',
    icon: 'rocket_launch',
    titleKey: 'helpS_start_title',
    tocKey: 'helpS_start_toc',
    blocks: [
      { kind: 'p', key: 'helpS_start_0' },
      {
        kind: 'ol',
        keys: [
          'helpS_start_1_0',
          'helpS_start_1_1',
          'helpS_start_1_2',
          'helpS_start_1_3',
          'helpS_start_1_4',
          'helpS_start_1_5',
          'helpS_start_1_6',
        ],
      },
    ],
  },
  {
    id: 'organization',
    icon: 'corporate_fare',
    titleKey: 'helpS_organization_title',
    tocKey: 'helpS_organization_toc',
    blocks: [
      { kind: 'p', key: 'helpS_organization_0' },
      { kind: 'ul', keys: ['helpS_organization_1_0', 'helpS_organization_1_1'] },
    ],
  },
  {
    id: 'contacts',
    icon: 'contact_phone',
    titleKey: 'helpS_contacts_title',
    tocKey: 'helpS_contacts_toc',
    blocks: [
      { kind: 'p', key: 'helpS_contacts_0' },
      { kind: 'ul', keys: ['helpS_contacts_1_0', 'helpS_contacts_1_1', 'helpS_contacts_1_2'] },
    ],
  },
  {
    id: 'endpoints',
    icon: 'dns',
    titleKey: 'helpS_endpoints_title',
    tocKey: 'helpS_endpoints_toc',
    blocks: [
      { kind: 'p', key: 'helpS_endpoints_0' },
      { kind: 'ul', keys: ['helpS_endpoints_1_0', 'helpS_endpoints_1_1'] },
    ],
  },
  {
    id: 'certificates',
    icon: 'verified_user',
    titleKey: 'helpS_certificates_title',
    tocKey: 'helpS_certificates_toc',
    blocks: [
      { kind: 'p', key: 'helpS_certificates_0' },
      { kind: 'p', key: 'helpS_certificates_1' },
      {
        kind: 'code',
        text: 'certtool --fingerprint --hash=sha512 --infile=client_certificate.pem',
      },
      { kind: 'ul', keys: ['helpS_certificates_3_0', 'helpS_certificates_3_1'] },
      { kind: 'p', key: 'helpS_certificates_login' },
    ],
  },
  {
    id: 'memberships',
    icon: 'groups',
    titleKey: 'helpS_memberships_title',
    tocKey: 'helpS_memberships_toc',
    blocks: [
      { kind: 'p', key: 'helpS_memberships_0' },
      { kind: 'p', key: 'helpS_memberships_1' },
    ],
  },
  {
    id: 'approval',
    icon: 'task_alt',
    titleKey: 'helpS_approval_title',
    tocKey: 'helpS_approval_toc',
    blocks: [
      { kind: 'p', key: 'helpS_approval_0' },
      { kind: 'ul', keys: ['helpS_approval_1_0', 'helpS_approval_1_1', 'helpS_approval_1_2'] },
    ],
  },
  {
    id: 'afterApproval',
    icon: 'history',
    titleKey: 'helpS_afterApproval_title',
    tocKey: 'helpS_afterApproval_toc',
    blocks: [
      { kind: 'p', key: 'helpS_afterApproval_0' },
      { kind: 'p', key: 'helpS_afterApproval_1' },
      { kind: 'code', text: '/fhir/Bundle/mine' },
      { kind: 'ul', keys: ['helpS_afterApproval_3_0', 'helpS_afterApproval_3_1'] },
    ],
  },
  {
    id: 'dsfImport',
    icon: 'download',
    titleKey: 'helpS_dsfImport_title',
    tocKey: 'helpS_dsfImport_toc',
    blocks: [
      { kind: 'p', key: 'helpS_dsfImport_0' },
      { kind: 'ol', keys: ['helpS_dsfImport_1_0', 'helpS_dsfImport_1_1', 'helpS_dsfImport_1_2'] },
      { kind: 'p', key: 'helpS_dsfImport_2' },
    ],
  },
  {
    id: 'renewal',
    icon: 'autorenew',
    titleKey: 'helpS_renewal_title',
    tocKey: 'helpS_renewal_toc',
    blocks: [
      { kind: 'p', key: 'helpS_renewal_0' },
      { kind: 'ol', keys: ['helpS_renewal_1_0', 'helpS_renewal_1_1', 'helpS_renewal_1_2'] },
    ],
  },
  {
    id: 'withdrawal',
    icon: 'logout',
    titleKey: 'helpS_withdrawal_title',
    tocKey: 'helpS_withdrawal_toc',
    blocks: [
      { kind: 'p', key: 'helpS_withdrawal_0' },
      { kind: 'p', key: 'helpS_withdrawal_1' },
    ],
  },
  {
    id: 'incidents',
    icon: 'gpp_bad',
    titleKey: 'helpS_incidentFlow_title',
    tocKey: 'helpS_incidentFlow_toc',
    blocks: [{ kind: 'p', key: 'helpS_incidentFlow_0' }, { kind: 'incidentFlow' }],
  },
];

export const HELP_FAQ: HelpFaq[] = [
  { id: 'faq-0', qKey: 'helpFaq_0_q', aKey: 'helpFaq_0_a' },
  { id: 'faq-1', qKey: 'helpFaq_1_q', aKey: 'helpFaq_1_a' },
  { id: 'faq-2', qKey: 'helpFaq_2_q', aKey: 'helpFaq_2_a' },
  { id: 'faq-3', qKey: 'helpFaq_3_q', aKey: 'helpFaq_3_a' },
  { id: 'faq-4', qKey: 'helpFaq_4_q', aKey: 'helpFaq_4_a' },
];
