/**
 * slides.ts – content structure of the help page's intro deck: per slide the
 * title key, the bullet keys and the illustration component. Texts live in i18n.
 * Dependencies: i18n/en (TranslationKey), IntroSlideArt.
 */
import type { ComponentType } from 'react';
import type { TranslationKey } from '../../i18n/en';
import {
  AccessArt,
  ApprovalArt,
  DecentralArt,
  EntitiesArt,
  EvidenceArt,
  FlowArt,
  IncidentArt,
  MarketplaceArt,
  ProjectArt,
  ToolsArt,
} from './IntroSlideArt';

export interface IntroSlide {
  id: string;
  titleKey: TranslationKey;
  bulletKeys: TranslationKey[];
  Art: ComponentType;
}

export const INTRO_SLIDES: IntroSlide[] = [
  {
    id: 'flow',
    titleKey: 'introS1_title',
    bulletKeys: ['introS1_b1', 'introS1_b2', 'introS1_b3', 'introS1_b4'],
    Art: FlowArt,
  },
  {
    id: 'site',
    titleKey: 'introS2_title',
    bulletKeys: ['introS2_b1', 'introS2_b2', 'introS2_b3', 'introS2_b4'],
    Art: EntitiesArt,
  },
  {
    id: 'approval',
    titleKey: 'introS3_title',
    bulletKeys: ['introS3_b1', 'introS3_b2', 'introS3_b3', 'introS3_b4', 'introS3_b5'],
    Art: ApprovalArt,
  },
  {
    id: 'decentral',
    titleKey: 'introS4_title',
    bulletKeys: ['introS4_b1', 'introS4_b2', 'introS4_b3', 'introS4_b4', 'introS4_b5'],
    Art: DecentralArt,
  },
  {
    id: 'access',
    titleKey: 'introS5_title',
    bulletKeys: ['introS5_b1', 'introS5_b2', 'introS5_b3', 'introS5_b4'],
    Art: AccessArt,
  },
  {
    id: 'evidence',
    titleKey: 'introS6_title',
    bulletKeys: ['introS6_b1', 'introS6_b2', 'introS6_b3', 'introS6_b4', 'introS6_b5'],
    Art: EvidenceArt,
  },
  {
    id: 'incidents',
    titleKey: 'introS7_title',
    bulletKeys: [
      'introS7_b1',
      'introS7_b2',
      'introS7_b3',
      'introS7_b4',
      'introS7_b5',
      'introS7_b6',
    ],
    Art: IncidentArt,
  },
  {
    id: 'marketplace',
    titleKey: 'introS8_title',
    bulletKeys: [
      'introS8_b1',
      'introS8_b2',
      'introS8_b3',
      'introS8_b4',
      'introS8_b5',
      'introS8_b6',
    ],
    Art: MarketplaceArt,
  },
  {
    id: 'tools',
    titleKey: 'introS9_title',
    bulletKeys: ['introS9_b1', 'introS9_b2', 'introS9_b3', 'introS9_b4', 'introS9_b5'],
    Art: ToolsArt,
  },
  {
    id: 'project',
    titleKey: 'introS10_title',
    bulletKeys: ['introS10_b1', 'introS10_b2', 'introS10_b3', 'introS10_b4'],
    Art: ProjectArt,
  },
];
