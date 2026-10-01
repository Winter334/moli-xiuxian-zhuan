import { z } from 'zod';
import { dec, text } from '../numbers';
import { nonnegativeSchema, type StatSource } from './types';
import { positiveValue } from './effects';

export const MINING = {
  name: '采矿', cost: '10', scaling: '1.6', max: 60,
  tags: ['mining'] as const,
  prerequisite: 'pine-ravine', location: 'stoneforge-hamlet',
} as const;

interface MiningSite {
  name: string; itemId: string; seconds: readonly [number, number]; levels: readonly [number, number]; xp: string;
  prerequisite: string; location: string; depletion?: number; guaranteed?: boolean;
}
export const MINING_SITES = {
  'azure-vein': {
    prerequisite: MINING.prerequisite, location: MINING.location,
    name: '西坡青纹矿脉', itemId: 'azure-ore', seconds: [20, 8], levels: [0, 10], xp: '1',
  },
  'ember-seam': {
    prerequisite: MINING.prerequisite, location: MINING.location,
    name: '西坡地火煤层', itemId: 'ember-coal', seconds: [24, 10], levels: [3, 13], xp: '2',
  },
  'jade-seam': {
    name: '外台玉髓脉', itemId: 'jade-marrow', seconds: [10, 2], levels: [0, 10], xp: '10',
    prerequisite: 'shrine-gate-duel', location: 'sunken-manor-entrance', depletion: 1.5, guaranteed: true,
  },
} satisfies Record<string, MiningSite>;
export type MiningSiteId = keyof typeof MINING_SITES;
export const MINING_SITE_IDS = Object.keys(MINING_SITES) as MiningSiteId[];
export const miningSiteIdSchema = z.enum(['azure-vein', 'ember-seam', 'jade-seam']);
export const miningCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const gatheringSchema = z.object({
  siteId: miningSiteIdSchema,
  elapsed: nonnegativeSchema,
  cycleSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((activity, ctx) => {
  if (dec(activity.elapsed).gte(activity.cycleSeconds)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid gathering checkpoint' });
  }
});

export function miningSpeed(sources: readonly StatSource[]): string {
  const speed = positiveValue('1', 'activity.speed', sources, { tags: ['mining'] });
  if (dec(speed).lte(0) || dec(speed).gt(100)) throw new Error('Unsupported activity speed');
  return speed;
}

export function advanceWork(progress: string, seconds: string, speed: string): string {
  for (const value of [progress, seconds, speed]) nonnegativeSchema.parse(value);
  return text(dec(progress).plus(dec(seconds).mul(speed)));
}

export function miningEfficiency(siteId: MiningSiteId, level: number, completed = 0) {
  if (!Number.isInteger(level) || level < 0 || level > MINING.max) throw new Error('Invalid mining level');
  miningCountSchema.parse(completed);
  const site: MiningSite = MINING_SITES[siteId];
  const progress = dec(Math.min(site.levels[1], Math.max(site.levels[0], level)) - site.levels[0])
    .div(site.levels[1] - site.levels[0]);
  const seconds = dec(site.seconds[0]).mul(dec(site.seconds[1]).div(site.seconds[0]).pow(progress))
    // Beyond this exponent even the shortest period exceeds safe integer seconds.
    .mul(site.depletion ? dec(site.depletion).pow(Math.min(completed, 100)) : 1).floor();
  return {
    cycleSeconds: seconds.gt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : seconds.toNumber(),
    chance: site.guaranteed ? '1' : text(dec('.4').mul(dec('2.5').pow(progress))),
  };
}
