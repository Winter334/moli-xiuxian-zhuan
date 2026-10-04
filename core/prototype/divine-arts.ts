import { z } from 'zod';
import { FOUNDATION_LEVEL } from './growth';
import { dec, text } from '../numbers';
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
  domain: {
    name: '领域',
    description: '从断原强者斗法中领悟的领域神通，承接周天罡气，随自身战斗领悟展开。',
    minLevel: FOUNDATION_LEVEL,
    source: {
      id: 'divine-art:domain', tags: ['divine-art'],
      flat: { attack: '1000', defense: '1000' }, multiplier: { attackMultiplier: '1.2' },
    } satisfies StatSource,
  },
} as const;

export type DivineArtId = keyof typeof DIVINE_ARTS;
export const DIVINE_ART_IDS = Object.keys(DIVINE_ARTS) as DivineArtId[];
export const divineArtIdSchema = z.enum(['circulating-qi', 'domain']);
export const FOUNDATION_DIVINE_ART: DivineArtId = 'circulating-qi';

const DOMAIN_STAGES = [
  { at: 0, name: '领域初悟', base: 0, gain: '1000', attack: '1', hp: '1', strike: '1.2' },
  { at: 10, name: '燃灼术', base: 8, gain: '15000', attack: '1.05', hp: '1.2', strike: '1.3' },
  { at: 20, name: '火灵幻海·领域一重', base: 18, gain: '150000', attack: '1.08', hp: '1.45', strike: '1.5' },
  { at: 30, name: '焰海霜天·领域二重', base: 24, gain: '1215000', attack: '1.12', hp: '1.75', strike: '2' },
  { at: 35, name: '焰海霜天·领域三重', base: 29, gain: '4860000', attack: '1.2', hp: '2', strike: '2.2' },
  { at: 40, name: '出云落月·领域四重', base: 38, gain: '204800000', attack: '1.3', hp: '3', strike: '2.5' },
  { at: 45, name: '出云落月·领域五重', base: 42, gain: '2028000000', attack: '1.35', hp: '3.6', strike: '2.75' },
  { at: 55, name: '出云落月·领域六重', base: 51, gain: '32400000000', attack: '1.4', hp: '4.5', strike: '3' },
] as const;

export function domainStage(level: number) {
  if (!Number.isInteger(level) || level < 0 || level > 59) throw new Error('Invalid domain level');
  const stage = DOMAIN_STAGES.filter(entry => level >= entry.at).at(-1)!;
  return { ...stage, passive: text(dec(stage.gain).mul(level - stage.base)) };
}

export function divineArtSource(id: DivineArtId, level = 0): StatSource {
  if (id !== 'domain') return DIVINE_ARTS[id].source;
  const stage = domainStage(level);
  return {
    id: 'divine-art:domain', tags: ['divine-art'],
    ...(stage.at === 0 ? { flat: { attack: '1000', defense: '1000' } } : {}),
    multiplier: { attack: stage.attack, defense: stage.attack, maxHp: stage.hp, attackMultiplier: stage.strike },
  };
}
