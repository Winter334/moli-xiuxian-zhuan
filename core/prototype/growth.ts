import { dec, text } from '../numbers';
import { BASE_STATS } from './stats';
import { nonnegativeSchema, type Stats } from './types';

export const FOUNDATION_LEVEL = 13;
export const LEVEL_CAP = 24;

// Saved levels stay independent of the source budget positions.
const realmGrowth = [
  { attack: 1, defense: 0, maxHp: 50, xp: '0' },
  { attack: 3, defense: 1, maxHp: 84, xp: '4' },
  { attack: 5, defense: 2, maxHp: 167, xp: '39' },
  { attack: 9, defense: 4, maxHp: 300, xp: '105' },
  { attack: 17, defense: 8, maxHp: 767, xp: '905' },
  { attack: 31, defense: 15, maxHp: 2000, xp: '2905' },
  { attack: 51, defense: 25, maxHp: 4000, xp: '6105' },
  { attack: 85, defense: 42, maxHp: 8000, xp: '16772' },
  { attack: 135, defense: 67, maxHp: 13334, xp: '34105' },
  { attack: 201, defense: 100, maxHp: 20000, xp: '58105' },
  { attack: 335, defense: 167, maxHp: 33334, xp: '138105' },
  { attack: 568, defense: 284, maxHp: 53334, xp: '978105' },
  { attack: 901, defense: 450, maxHp: 80000, xp: '2578105' },
  { attack: 2001, defense: 1000, maxHp: 200000, xp: '62578105' },
  { attack: 4001, defense: 2000, maxHp: 450000, xp: '142578105' },
  { attack: 8001, defense: 4000, maxHp: 1000000, xp: '302578105' },
  { attack: 9501, defense: 4750, maxHp: 1250000, xp: '422578105' },
  { attack: 14001, defense: 7000, maxHp: 2000000, xp: '782578105' },
  { attack: 24001, defense: 12000, maxHp: 3500000, xp: '1982578105' },
  { attack: 42001, defense: 21000, maxHp: 6000000, xp: '5582578105' },
  { attack: 49501, defense: 24750, maxHp: 7625000, xp: '8282578105' },
  { attack: 72001, defense: 36000, maxHp: 12500000, xp: '16382578105' },
  { attack: 144001, defense: 72000, maxHp: 25000000, xp: '37982578105' },
  { attack: 288001, defense: 144000, maxHp: 47500000, xp: '81182578105' },
  { attack: 540001, defense: 270000, maxHp: 80000000, xp: '189182578105' },
] as const;
const earthPositions = [9, 10, 11, 11.25, 12, 13, 14, 14.25, 15, 16, 17, 18] as const;

function budgetPosition(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > LEVEL_CAP) throw new Error('Invalid prototype realm');
  return level >= FOUNDATION_LEVEL ? earthPositions[level - FOUNDATION_LEVEL] : level * 2 / 3;
}

export function effectiveRealm(level: number): string {
  const position = budgetPosition(level);
  if (level >= FOUNDATION_LEVEL) return String(Math.min(position, 17));
  return text(dec(level).mul(2).div(3));
}

export function realmName(level: number): string {
  effectiveRealm(level);
  if (level < FOUNDATION_LEVEL) return level === 0 ? '凡人' : `炼气${level}层`;
  const offset = level - FOUNDATION_LEVEL;
  return `${['筑基', '结丹', '元婴'][Math.floor(offset / 4)]}${['初期', '中期', '后期', '圆满'][offset % 4]}`;
}

export function realmAt(level: number): {
  level: number; effectiveRealm: string; cumulativeCost: string; entryCost: string;
  skillXpMultiplier: string; stats: Stats;
} {
  const reference = effectiveRealm(level);
  const growth = realmGrowth[level];
  const position = budgetPosition(level);
  const whole = Math.floor(position);
  let skillMultiplier = dec(1);
  for (let rank = 1; rank <= whole; rank++) {
    skillMultiplier = skillMultiplier.mul(rank < 3 ? '1.1' : rank < 6 ? '1.15' : rank < 9 ? '1.2' : '1.25');
  }
  const nextFactor = whole + 1 < 3 ? '1.1' : whole + 1 < 6 ? '1.15' : '1.2';
  if (level < FOUNDATION_LEVEL) skillMultiplier = skillMultiplier.mul(dec(nextFactor).pow(dec(level * 2 % 3).div(3)));
  else skillMultiplier = skillMultiplier.mul(dec('1.25').pow(dec(position).minus(whole)));
  return {
    level, effectiveRealm: reference,
    cumulativeCost: growth.xp,
    entryCost: String(BigInt(growth.xp) - (level === 0 ? 0n : BigInt(realmGrowth[level - 1].xp))),
    skillXpMultiplier: text(skillMultiplier),
    stats: {
      ...BASE_STATS,
      attack: String(growth.attack),
      defense: String(growth.defense),
      agility: String(growth.defense + 1),
      maxHp: String(growth.maxHp),
      attackSpeed: whole >= 6 ? '1.25' : whole >= 3 ? '1.1' : '1',
      attackMultiplier: level >= FOUNDATION_LEVEL ? text(dec(Math.min(position, 17)).minus(9).mul('.1').plus('1.2')) : '1',
    },
  };
}

export function gainCultivation(level: number, cultivation: string, amount: string, allowFoundation = false) {
  effectiveRealm(level);
  nonnegativeSchema.parse(cultivation);
  nonnegativeSchema.parse(amount);
  const beforeReference = Math.floor(budgetPosition(level));
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
    referencePromotions: Math.floor(budgetPosition(level)) - beforeReference,
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
      !Number.isInteger(initialGroupSize) || initialGroupSize < 1 || initialGroupSize > 8) {
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
