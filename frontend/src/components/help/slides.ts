/**
 * slides.ts – content structure of the help page's intro deck: per slide the
 * title key, the bullet keys and the illustration component. Texts live in i18n.
 * Dependencies: i18n/en (TranslationKey), IntroSlideArt.
 */
import type { ComponentType } from 'react';
import type { TranslationKey } from '../../i18n/en';
import { ApprovalArt, EntitiesArt, FlowArt, IncidentArt, ProjectArt } from './IntroSlideArt';

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
    bulletKeys: ['introS1_b1', 'introS1_b2', 'introS1_b3'],
    Art: FlowArt,
  },
  {
    id: 'site',
    titleKey: 'introS2_title',
    bulletKeys: ['introS2_b1', 'introS2_b2', 'introS2_b3'],
    Art: EntitiesArt,
  },
  {
    id: 'approval',
    titleKey: 'introS3_title',
    bulletKeys: ['introS3_b1', 'introS3_b2', 'introS3_b3'],
    Art: ApprovalArt,
  },
  {
    id: 'incidents',
    titleKey: 'introS4_title',
    bulletKeys: ['introS4_b1', 'introS4_b2', 'introS4_b3'],
    Art: IncidentArt,
  },
  {
    id: 'project',
    titleKey: 'introS5_title',
    bulletKeys: ['introS5_b1', 'introS5_b2', 'introS5_b3'],
    Art: ProjectArt,
  },
];
