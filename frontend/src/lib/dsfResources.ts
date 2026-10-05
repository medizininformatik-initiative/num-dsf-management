/**
 * dsfResources.ts — static catalog for the DSF Resources page plus the pure
 * helpers the page filters it with. Titles are proper nouns (kept literal);
 * descriptions are i18n keys so a typo in a key is a compile error.
 * Every URL was checked for real on 2026-10-05; re-check on demand with
 * `node scripts/check-resource-links.mjs` (from frontend/).
 * Dependencies: ../i18n/en (TranslationKey)
 */
import type { TranslationKey } from '../i18n/en';

export type ResourceCategory =
  | 'gettingStarted'
  | 'documentation'
  | 'processPlugins'
  | 'specifications'
  | 'community'
  | 'networks';

export interface DsfResource {
  /** Stable kebab-case id (React key, test hook). */
  id: string;
  category: ResourceCategory;
  title: string;
  url: string;
  descKey: TranslationKey;
  /** Material Symbols ligature name. */
  icon: string;
  /** Shown in the "Start here" row while no filter is active. */
  featured?: boolean;
}

/** Display order of the category filter. */
export const RESOURCE_CATEGORIES: readonly ResourceCategory[] = [
  'gettingStarted',
  'documentation',
  'processPlugins',
  'specifications',
  'community',
  'networks',
];

export const CATEGORY_LABEL_KEY: Record<ResourceCategory, TranslationKey> = {
  gettingStarted: 'dsfResourcesCatGettingStarted',
  documentation: 'dsfResourcesCatDocumentation',
  processPlugins: 'dsfResourcesCatProcessPlugins',
  specifications: 'dsfResourcesCatSpecifications',
  community: 'dsfResourcesCatCommunity',
  networks: 'dsfResourcesCatNetworks',
};

export const DSF_RESOURCES: readonly DsfResource[] = [
  // Getting started
  {
    id: 'introduction',
    category: 'gettingStarted',
    title: 'Introduction to the DSF',
    url: 'https://dsf.dev/explore/concepts/introduction.html',
    descKey: 'dsfResourcesDescIntroduction',
    icon: 'school',
    featured: true,
  },
  {
    id: 'allow-list-concept',
    category: 'gettingStarted',
    title: 'Allow List Concept',
    url: 'https://dsf.dev/explore/concepts/allow-list.html',
    descKey: 'dsfResourcesDescAllowList',
    icon: 'verified_user',
    featured: true,
  },
  {
    id: 'operations-get-started',
    category: 'gettingStarted',
    title: 'Get Started with Operations',
    url: 'https://dsf.dev/operations/get-started.html',
    descKey: 'dsfResourcesDescOperations',
    icon: 'rocket_launch',
    featured: true,
  },
  {
    id: 'use-cases',
    category: 'gettingStarted',
    title: 'Use Cases',
    url: 'https://dsf.dev/explore/use-cases/',
    descKey: 'dsfResourcesDescUseCases',
    icon: 'lightbulb',
  },
  // Documentation
  {
    id: 'operations-latest',
    category: 'documentation',
    title: 'Operations Documentation',
    url: 'https://dsf.dev/operations/latest/',
    descKey: 'dsfResourcesDescOperationsLatest',
    icon: 'dns',
  },
  {
    id: 'architecture',
    category: 'documentation',
    title: 'Architecture',
    url: 'https://dsf.dev/explore/concepts/architecture.html',
    descKey: 'dsfResourcesDescArchitecture',
    icon: 'account_tree',
  },
  {
    id: 'security-concept',
    category: 'documentation',
    title: 'Security Concept',
    url: 'https://dsf.dev/explore/concepts/security.html',
    descKey: 'dsfResourcesDescSecurityConcept',
    icon: 'shield_lock',
  },
  {
    id: 'security-policy',
    category: 'documentation',
    title: 'Security Disclosure Policy',
    url: 'https://dsf.dev/security/',
    descKey: 'dsfResourcesDescSecurity',
    icon: 'policy',
  },
  {
    id: 'publications',
    category: 'documentation',
    title: 'Publications',
    url: 'https://dsf.dev/explore/publications.html',
    descKey: 'dsfResourcesDescPublications',
    icon: 'article',
  },
  // Process plugins
  {
    id: 'process-plugins',
    category: 'processPlugins',
    title: 'Process Plugins Explained',
    url: 'https://dsf.dev/explore/concepts/process-plugins.html',
    descKey: 'dsfResourcesDescProcessPlugins',
    icon: 'extension',
  },
  {
    id: 'api-v2',
    category: 'processPlugins',
    title: 'Process API v2',
    url: 'https://dsf.dev/process-development/api-v2/',
    descKey: 'dsfResourcesDescApiV2',
    icon: 'code',
  },
  {
    id: 'api-v1',
    category: 'processPlugins',
    title: 'Process API v1',
    url: 'https://dsf.dev/process-development/api-v1/',
    descKey: 'dsfResourcesDescApiV1',
    icon: 'code_blocks',
  },
  {
    id: 'linter',
    category: 'processPlugins',
    title: 'DSF Linter',
    url: 'https://dsf.dev/process-development/linter-tool/linter-tool.html',
    descKey: 'dsfResourcesDescLinter',
    icon: 'rule',
  },
  {
    id: 'hub',
    category: 'processPlugins',
    title: 'DSF Process Hub',
    url: 'https://hub.dsf.dev/',
    descKey: 'dsfResourcesDescHub',
    icon: 'storefront',
  },
  // Specifications
  {
    id: 'fhir-ig',
    category: 'specifications',
    title: 'DSF FHIR Implementation Guide',
    url: 'https://dsf.dev/dsf-development/v2/fhir-ig.html',
    descKey: 'dsfResourcesDescFhirIg',
    icon: 'local_fire_department',
  },
  {
    id: 'fhir-r4',
    category: 'specifications',
    title: 'HL7 FHIR R4',
    url: 'https://hl7.org/fhir/R4/',
    descKey: 'dsfResourcesDescFhirR4',
    icon: 'menu_book',
  },
  {
    id: 'bpmn',
    category: 'specifications',
    title: 'BPMN 2.0',
    url: 'https://www.omg.org/spec/BPMN/2.0/',
    descKey: 'dsfResourcesDescBpmn',
    icon: 'schema',
  },
  // Community
  {
    id: 'community',
    category: 'community',
    title: 'DSF Community',
    url: 'https://dsf.dev/community/',
    descKey: 'dsfResourcesDescCommunity',
    icon: 'groups',
  },
  {
    id: 'communication',
    category: 'community',
    title: 'Communication Channels',
    url: 'https://dsf.dev/community/communication.html',
    descKey: 'dsfResourcesDescCommunication',
    icon: 'forum',
  },
  {
    id: 'consultation-hours',
    category: 'community',
    title: 'Consultation Hours',
    url: 'https://dsf.dev/community/consultation-hours.html',
    descKey: 'dsfResourcesDescConsultation',
    icon: 'support_agent',
  },
  {
    id: 'news',
    category: 'community',
    title: 'News & Releases',
    url: 'https://dsf.dev/news/',
    descKey: 'dsfResourcesDescNews',
    icon: 'campaign',
  },
  {
    id: 'github',
    category: 'community',
    title: 'Source Code (GitHub)',
    url: 'https://github.com/datasharingframework/dsf',
    descKey: 'dsfResourcesDescGithub',
    icon: 'terminal',
  },
  // Networks & consortia
  {
    id: 'mii',
    category: 'networks',
    title: 'Medical Informatics Initiative (MII)',
    url: 'https://www.medizininformatik-initiative.de/',
    descKey: 'dsfResourcesDescMii',
    icon: 'hub',
  },
  {
    id: 'num',
    category: 'networks',
    title: 'Network University Medicine (NUM)',
    url: 'https://www.netzwerk-universitaetsmedizin.de/',
    descKey: 'dsfResourcesDescNum',
    icon: 'local_hospital',
  },
  {
    id: 'ecosystem',
    category: 'networks',
    title: 'DSF Ecosystem',
    url: 'https://dsf.dev/community/ecosystem.html',
    descKey: 'dsfResourcesDescEcosystem',
    icon: 'diversity_3',
  },
];

/** Host shown on a card, without a leading "www.". */
export function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

export type CategoryFilter = ResourceCategory | 'all';

/**
 * Resources matching a category and a free-text query. The query matches the
 * title, the (already translated) description and the host, case-insensitively;
 * every whitespace-separated word has to match somewhere.
 */
export function filterResources(
  resources: readonly DsfResource[],
  category: CategoryFilter,
  query: string,
  describe: (r: DsfResource) => string,
): DsfResource[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return resources.filter((r) => {
    if (category !== 'all' && r.category !== category) return false;
    if (words.length === 0) return true;
    const hay = `${r.title} ${describe(r)} ${hostOf(r.url)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
