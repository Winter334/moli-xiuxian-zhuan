import { z } from 'zod';
import { FOUNDATION_LEVEL } from './growth';
import type { StatSource } from './types';

export const DIVINE_ARTS = {
  'circulating-qi': {
    name: '周天罡气',
    description: '筑基后领悟的运罡之法。真元流转周身，内护筋骨，外贯拳剑，攻守之间皆可运用。',
    minLevel: FOUNDATION_LEVEL,
    source: {
      id: 'divine-art:circulating-qi',
      tags: ['divine-art'],
      statPolarity: { flat: { attack: 'benefit', defense: 'benefit' }, multiplier: { attackMultiplier: 'benefit' } },
      flat: { attack: '1000', defense: '1000' },
      multiplier: { attackMultiplier: '1.2' },
    } satisfies StatSource,
  },
} as const;

export type DivineArtId = keyof typeof DIVINE_ARTS;
export const DIVINE_ART_IDS = Object.keys(DIVINE_ARTS) as DivineArtId[];
export const divineArtIdSchema = z.enum(['circulating-qi']);
export const FOUNDATION_DIVINE_ART: DivineArtId = 'circulating-qi';
