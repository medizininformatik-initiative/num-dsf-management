/**
 * seed-marketplace-fixtures.ts – marketplace entries (real repositories, illustrative metadata) for
 * the dev seed (descriptions, topics, DSF metadata, releases). Pure data, no DB.
 * Dependencies: none
 */
export interface MarketplaceFixture {
  url: string;
  slug: string;
  name: string;
  status: 'APPROVED' | 'EXPERIMENTAL' | 'DEPRECATED';
  description: string;
  topics: string[];
  stars: number;
  forks: number;
  openIssues: number;
  license: string;
  homepage: string;
  verified: boolean;
  processIdentifiers: string[];
  dsfVersionMin: string;
  requiredRoles: string[];
  messageNames: string[];
  artifactUrl: string;
  releases: { tag: string; publishedAt: string }[];
}

const DSF_ORG = 'datasharingframework';
const MII_ORG = 'medizininformatik-initiative';

type FixtureInput = Omit<
  MarketplaceFixture,
  'url' | 'slug' | 'name' | 'homepage' | 'license' | 'artifactUrl'
>;

/** `owner` is the GitHub organization that hosts the repository. */
function fixture(owner: string, repo: string, rest: FixtureInput): MarketplaceFixture {
  return {
    url: `https://github.com/${owner}/${repo}`,
    slug: `${owner}-${repo}`,
    name: repo,
    homepage: `https://github.com/${owner}/${repo}#readme`,
    license: 'Apache-2.0',
    artifactUrl: `https://github.com/${owner}/${repo}/releases/latest`,
    ...rest,
  };
}

export function buildMarketplaceFixtures(): MarketplaceFixture[] {
  return [
    fixture(DSF_ORG, 'dsf-process-allow-list', {
      status: 'APPROVED',
      description:
        'Distributes the central allow list of organizations, endpoints and certificates to all DSF instances of a network.',
      topics: ['dsf', 'allow-list', 'bpmn', 'fhir', 'medical-informatics'],
      stars: 14,
      forks: 6,
      openIssues: 3,
      verified: true,
      processIdentifiers: ['medizininformatik-initiativede_downloadAllowList'],
      dsfVersionMin: '1.5.0',
      requiredRoles: ['DIC', 'TTP'],
      messageNames: ['downloadAllowList', 'downloadAllowListResponse'],
      releases: [
        { tag: 'v1.0.2', publishedAt: '2026-03-18T09:30:00Z' },
        { tag: 'v1.0.1', publishedAt: '2025-11-04T14:05:00Z' },
        { tag: 'v1.0.0', publishedAt: '2025-06-12T08:00:00Z' },
      ],
    }),
    fixture(MII_ORG, 'mii-process-feasibility', {
      status: 'APPROVED',
      description:
        'Feasibility queries across the network: a coordinating site distributes a structured query and aggregates the cohort counts of the data integration centers.',
      topics: ['dsf', 'feasibility', 'cohort-count', 'fhir', 'bpmn'],
      stars: 22,
      forks: 9,
      openIssues: 5,
      verified: true,
      processIdentifiers: [
        'medizininformatik-initiativede_feasibilityRequest',
        'medizininformatik-initiativede_feasibilityExecute',
      ],
      dsfVersionMin: '1.4.0',
      requiredRoles: ['DIC', 'HRP'],
      messageNames: ['feasibilityRequest', 'feasibilityResult'],
      releases: [
        { tag: 'v0.9.1', publishedAt: '2026-01-27T10:15:00Z' },
        { tag: 'v0.9.0', publishedAt: '2025-09-30T12:40:00Z' },
        { tag: 'v0.8.0', publishedAt: '2025-04-08T07:55:00Z' },
      ],
    }),
    fixture(DSF_ORG, 'dsf-process-tutorial', {
      status: 'APPROVED',
      description:
        'Step-by-step tutorial process that shows how to build, package and deploy a first own DSF process plugin.',
      topics: ['dsf', 'tutorial', 'bpmn', 'plugin'],
      stars: 31,
      forks: 17,
      openIssues: 2,
      verified: false,
      processIdentifiers: ['highmedorg_helloDic', 'highmedorg_helloCos'],
      dsfVersionMin: '1.3.0',
      requiredRoles: ['DIC', 'COS'],
      messageNames: ['helloCos', 'helloHrp'],
      releases: [
        { tag: 'v1.2.0', publishedAt: '2025-12-02T11:20:00Z' },
        { tag: 'v1.1.0', publishedAt: '2025-05-21T09:10:00Z' },
      ],
    }),
    fixture(DSF_ORG, 'dsf-process-hello-world', {
      status: 'EXPERIMENTAL',
      description:
        'Minimal hello-world process used to verify that a DSF installation can exchange messages between two organizations.',
      topics: ['dsf', 'example', 'smoke-test'],
      stars: 5,
      forks: 2,
      openIssues: 0,
      verified: false,
      processIdentifiers: ['example_helloWorld'],
      dsfVersionMin: '1.0.0',
      requiredRoles: ['DIC'],
      messageNames: ['helloWorld'],
      releases: [{ tag: 'v0.3.0', publishedAt: '2025-08-14T13:00:00Z' }],
    }),
    fixture(DSF_ORG, 'dsf-process-ping-pong', {
      status: 'EXPERIMENTAL',
      description:
        'Connectivity check between DSF endpoints: sends a ping and expects a pong, reporting round-trip status per partner.',
      topics: ['dsf', 'connectivity', 'monitoring', 'bpmn'],
      stars: 8,
      forks: 3,
      openIssues: 1,
      verified: false,
      processIdentifiers: ['example_ping', 'example_pong'],
      dsfVersionMin: '1.2.0',
      requiredRoles: ['DIC', 'TTP'],
      messageNames: ['ping', 'pong'],
      releases: [
        { tag: 'v0.5.1', publishedAt: '2026-02-09T16:45:00Z' },
        { tag: 'v0.5.0', publishedAt: '2025-10-17T10:30:00Z' },
      ],
    }),
  ];
}
