import { z } from 'zod';
import { dec, text } from '../numbers';
import { FOUNDATION_LEVEL, realmAt } from './growth';
import type { Stats } from './types';

export const foundationRootSchema = z.enum(['human', 'earth', 'heaven']);
export type FoundationRoot = z.infer<typeof foundationRootSchema>;
export const FOUNDATION_ROOTS = {
  human: { name: '人道筑基', bonusRate: '0' },
  earth: { name: '地道筑基', bonusRate: '0.1' },
  heaven: { name: '天道筑基', bonusRate: '0.15' },
} as const;

const rootStats = ['maxHp', 'attack', 'defense', 'agility'] as const;
export function foundationBonus(root: FoundationRoot): Pick<Stats, typeof rootStats[number]> {
  const basis = realmAt(FOUNDATION_LEVEL).stats;
  const rate = FOUNDATION_ROOTS[root].bonusRate;
  return Object.fromEntries(rootStats.map(key =>
    [key, text(dec(basis[key]).mul(dec(1).plus(rate)).ceil().minus(basis[key]))],
  )) as Pick<Stats, typeof rootStats[number]>;
}

export function foundationBase(level: number, root: FoundationRoot | null): Stats {
  if ((level >= FOUNDATION_LEVEL) !== (root !== null)) throw new Error('Foundation root does not match realm');
  const base = { ...realmAt(level).stats };
  if (root !== null) {
    // Keep the first foundation's fixed delta, never recalculate it from later realm panels.
    const bonus = foundationBonus(root);
    for (const key of rootStats) base[key] = text(dec(base[key]).plus(bonus[key]));
  }
  return base;
}
