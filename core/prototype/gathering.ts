import { z } from 'zod';
import { D, dec, exactAdd, text } from '../numbers';
import { countSchema, nonnegativeSchema, type StatSource } from './types';
import { positiveValue } from './effects';

export const MINING = {
  name: '采矿', cost: '10', scaling: '1.6', max: 60,
  tags: ['mining'] as const,
  prerequisite: 'pine-ravine', location: 'stoneforge-hamlet',
} as const;
export const LOGGING = {
  name: '采木', cost: '10', scaling: '1.6', max: 60, tags: ['logging'] as const,
  prerequisite: 'green-vine-hill', location: 'forest-edge-camp',
} as const;

interface MiningSite {
  name: string; itemId: string; seconds: readonly [number, number]; levels: readonly [number, number]; xp: string;
  prerequisite: string; location: string; depletion?: number; guaranteed?: boolean;
  skill?: 'logging'; maxQuantity?: number;
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
  'north-willow-grove': {
    name: '北麓柳林', itemId: 'century-willow', seconds: [30, 6], levels: [8, 30], xp: '20',
    prerequisite: LOGGING.prerequisite, location: LOGGING.location, guaranteed: true, skill: 'logging', maxQuantity: 3,
  },
  'qixia-array-fragments': {
    name: '破取阵片', itemId: 'petal-array-fragment', seconds: [30, 10], levels: [0, 10], xp: '50',
    prerequisite: 'hanging-radiance-platform', location: 'qixia-overlook', depletion: 2, guaranteed: true,
  },
  'brokenplain-marrow-seam': {
    name: '断原髓脉', itemId: 'radiant-marrow', seconds: [12, 2], levels: [10, 20], xp: '100',
    prerequisite: 'resting-armor-plain', location: 'jiyuan-brokenplain', depletion: 1.33, guaranteed: true,
  },
} satisfies Record<string, MiningSite>;
export type MiningSiteId = keyof typeof MINING_SITES;
export const MINING_SITE_IDS = Object.keys(MINING_SITES) as MiningSiteId[];
export const miningSiteIdSchema = z.enum(['azure-vein', 'ember-seam', 'jade-seam', 'north-willow-grove', 'qixia-array-fragments', 'brokenplain-marrow-seam']);
export function exactMiningPeriod(siteId: MiningSiteId) {
  return siteId === 'qixia-array-fragments' || siteId === 'brokenplain-marrow-seam';
}
export function marrowSeamChance(level: number) {
  return text(dec('.01').mul(dec(25).pow(dec(Math.min(20, Math.max(10, level)) - 10).div(10))));
}
export function gatheringSkill(siteId: MiningSiteId): 'mining' | 'logging' {
  return (MINING_SITES[siteId] as MiningSite).skill ?? 'mining';
}
export const miningCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const gatheringSchema = z.object({
  siteId: miningSiteIdSchema,
  elapsed: nonnegativeSchema,
  cycleSeconds: z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    countSchema.refine(value => BigInt(value) > 0n)]),
}).strict().superRefine((activity, ctx) => {
  if (BigInt(activity.elapsed.split('.')[0]) >= BigInt(activity.cycleSeconds)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid gathering checkpoint' });
  }
  if (exactMiningPeriod(activity.siteId) !== (typeof activity.cycleSeconds === 'string')) {
    ctx.addIssue({ code: 'custom', message: 'Invalid gathering period format' });
  }
});

export function miningSpeed(sources: readonly StatSource[], skill: 'mining' | 'logging' = 'mining'): string {
  const speed = positiveValue('1', 'activity.speed', sources, { tags: [skill] });
  if (dec(speed).lte(0) || dec(speed).gt(100)) throw new Error('Unsupported activity speed');
  return speed;
}

export function advanceWork(progress: string, seconds: string, speed: string): string {
  for (const value of [progress, seconds, speed]) nonnegativeSchema.parse(value);
  return exactAdd(progress, text(dec(seconds).mul(speed)));
}

export function miningEfficiency(siteId: 'qixia-array-fragments' | 'brokenplain-marrow-seam', level: number, completed?: number):
  { cycleSeconds: string; chance: string; maxQuantity: number };
export function miningEfficiency(siteId: Exclude<MiningSiteId, 'qixia-array-fragments' | 'brokenplain-marrow-seam'>, level: number, completed?: number):
  { cycleSeconds: number; chance: string; maxQuantity: number };
export function miningEfficiency(siteId: MiningSiteId, level: number, completed?: number):
  { cycleSeconds: string | number; chance: string; maxQuantity: number };
export function miningEfficiency(siteId: MiningSiteId, level: number, completed = 0) {
  if (!Number.isInteger(level) || level < 0 || level > MINING.max) throw new Error('Invalid mining level');
  miningCountSchema.parse(completed);
  const site: MiningSite = MINING_SITES[siteId];
  const progress = dec(Math.min(site.levels[1], Math.max(site.levels[0], level)) - site.levels[0])
    .div(site.levels[1] - site.levels[0]);
  if (exactMiningPeriod(siteId)) {
    const factor = site.depletion!;
    const digits = Math.ceil(completed * Math.log10(factor)) + 3;
    if (digits > 1000) throw new Error('采集周期超出存档字段长度，未截短周期或重置进度');
    const precise = D.clone({ precision: Math.max(120, digits + 64) });
    const base = level <= site.levels[0] ? new precise(site.seconds[0])
      : level >= site.levels[1] ? new precise(site.seconds[1])
        : new precise(site.seconds[0]).mul(new precise(site.seconds[1]).div(site.seconds[0])
          .pow(new precise(level - site.levels[0]).div(site.levels[1] - site.levels[0])));
    const period = base.mul(new precise(String(factor)).pow(completed)).floor().toFixed();
    return { cycleSeconds: period, chance: '1', maxQuantity: 1 };
  }
  const seconds = dec(site.seconds[0]).mul(dec(site.seconds[1]).div(site.seconds[0]).pow(progress))
    // Beyond this exponent even the shortest period exceeds safe integer seconds.
    .mul(site.depletion ? dec(site.depletion).pow(Math.min(completed, 100)) : 1).floor();
  return {
    cycleSeconds: seconds.gt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : seconds.toNumber(),
    chance: site.guaranteed ? '1' : text(dec('.4').mul(dec('2.5').pow(progress))),
    maxQuantity: dec(site.maxQuantity ?? 1).pow(progress).round().toNumber(),
  };
}
