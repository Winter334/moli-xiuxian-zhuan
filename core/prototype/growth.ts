import { dec, text } from '../numbers';
import { BASE_STATS } from './stats';
import { nonnegativeSchema, type Stats } from './types';

export const FOUNDATION_LEVEL = 13;
export const LEVEL_CAP = FOUNDATION_LEVEL;

// Mortal, twelve cultivation layers, then the first foundation node only.
const realmGrowth = [
  { attack: 1, defense: 0, maxHp: 50, xp: 0 },
  { attack: 3, defense: 1, maxHp: 84, xp: 4 },
  { attack: 5, defense: 2, maxHp: 167, xp: 39 },
  { attack: 9, defense: 4, maxHp: 300, xp: 105 },
  { attack: 17, defense: 8, maxHp: 767, xp: 905 },
  { attack: 31, defense: 15, maxHp: 2000, xp: 2905 },
  { attack: 51, defense: 25, maxHp: 4000, xp: 6105 },
  { attack: 85, defense: 42, maxHp: 8000, xp: 16772 },
  { attack: 135, defense: 67, maxHp: 13334, xp: 34105 },
  { attack: 201, defense: 100, maxHp: 20000, xp: 58105 },
  { attack: 335, defense: 167, maxHp: 33334, xp: 138105 },
  { attack: 568, defense: 284, maxHp: 53334, xp: 978105 },
  { attack: 901, defense: 450, maxHp: 80000, xp: 2578105 },
  { attack: 2001, defense: 1000, maxHp: 200000, xp: 62578105 },
] as const;

export function effectiveRealm(level: number): string {
  if (!Number.isInteger(level) || level < 0 || level > LEVEL_CAP) throw new Error('Invalid prototype realm');
  if (level === FOUNDATION_LEVEL) return '9';
  return text(dec(level).mul(2).div(3));
}

export function realmName(level: number): string {
  effectiveRealm(level);
  return level === 0 ? '凡人' : level === FOUNDATION_LEVEL ? '筑基初期' : `炼气${level}层`;
}

export function realmAt(level: number): {
  level: number; effectiveRealm: string; cumulativeCost: string; entryCost: string;
  skillXpMultiplier: string; stats: Stats;
} {
  const reference = effectiveRealm(level);
  const growth = realmGrowth[level];
  const whole = Math.floor(Number(reference));
  let skillMultiplier = dec(1);
  for (let rank = 1; rank <= whole; rank++) {
    skillMultiplier = skillMultiplier.mul(rank < 3 ? '1.1' : rank < 6 ? '1.15' : rank < 9 ? '1.2' : '1.25');
  }
  const nextFactor = whole + 1 < 3 ? '1.1' : whole + 1 < 6 ? '1.15' : '1.2';
  if (level < FOUNDATION_LEVEL) skillMultiplier = skillMultiplier.mul(dec(nextFactor).pow(dec(level * 2 % 3).div(3)));
  return {
    level, effectiveRealm: reference,
    cumulativeCost: String(growth.xp),
    entryCost: String(growth.xp - (level === 0 ? 0 : realmGrowth[level - 1].xp)),
    skillXpMultiplier: text(skillMultiplier),
    stats: {
      ...BASE_STATS,
      attack: String(growth.attack),
      defense: String(growth.defense),
      agility: String(growth.defense + 1),
      maxHp: String(growth.maxHp),
      attackSpeed: whole >= 6 ? '1.25' : whole >= 3 ? '1.1' : '1',
      attackMultiplier: level >= FOUNDATION_LEVEL ? '1.2' : '1',
    },
  };
}

export function gainCultivation(level: number, cultivation: string, amount: string, allowFoundation = false) {
  effectiveRealm(level);
  nonnegativeSchema.parse(cultivation);
  nonnegativeSchema.parse(amount);
  const beforeReference = Math.floor(Number(effectiveRealm(level)));
  let remaining = dec(cultivation).plus(amount);
  const levels: number[] = [];
  while (level < LEVEL_CAP) {
    const cost = realmAt(level + 1).entryCost;
    if (level + 1 === FOUNDATION_LEVEL && !allowFoundation) {
      if (remaining.gt(cost)) remaining = dec(cost);
      break;
    }
    if (remaining.lt(cost)) break;
    remaining = remaining.minus(cost);
    levels.push(++level);
  }
  return {
    level, cultivation: text(remaining), levels,
    referencePromotions: Math.floor(Number(effectiveRealm(level))) - beforeReference,
  };
}

export function killExperienceRealmFactor(enemyRealm: number, playerLevel: number): string {
  if (!Number.isInteger(enemyRealm) || enemyRealm < 0) throw new Error('Invalid enemy realm');
  const difference = dec(enemyRealm).minus(effectiveRealm(playerLevel));
  return text(dec(difference.gte(0) ? '1.25' : '5').pow(difference));
}

export function killExperience(
  base: string, enemyRealm: number, playerLevel: number, initialGroupSize: number, multiplier = '1',
): string {
  nonnegativeSchema.parse(base);
  nonnegativeSchema.parse(multiplier);
  if (!Number.isInteger(enemyRealm) || enemyRealm < 0 ||
      !Number.isInteger(initialGroupSize) || initialGroupSize < 1 || initialGroupSize > 2) {
    throw new Error('Invalid encounter experience inputs');
  }
  const factor = killExperienceRealmFactor(enemyRealm, playerLevel);
  return text(dec(base).mul(dec(initialGroupSize).pow('0.3334')).mul(factor).mul(multiplier));
}

export function skillThreshold(baseCost: string, scaling: string, level: number): string {
  nonnegativeSchema.parse(baseCost);
  if (dec(baseCost).lte(0) || !dec(scaling).isFinite() || dec(scaling).lte(1) ||
      !Number.isInteger(level) || level < 0 || level > 999) throw new Error('Invalid skill curve');
  return text(dec(baseCost).mul(dec(scaling).pow(level).minus(1)).div(dec(scaling).minus(1)).toDecimalPlaces(2));
}
