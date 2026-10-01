import { dec, maximum, minimum, text } from '../numbers';
import { sourceSchema, statsSchema, type Stats, type StatSource } from './types';
import { modifyValue, scaledSource } from './effects';

export const BASE_STATS: Readonly<Stats> = Object.freeze({
  maxHp: '50', attack: '1', defense: '0', agility: '1', attackSpeed: '1',
  critChance: '0.01', critMultiplier: '1.5', attackMultiplier: '1',
  hpRegen: '0', hpRegenPercent: '0',
});

export function resolveStats(base: Stats, sources: readonly StatSource[] = []): Stats {
  statsSchema.parse(base);
  const ids = new Set<string>();
  for (const source of sources) {
    sourceSchema.parse(source);
    if (ids.has(source.id)) throw new Error(`Duplicate stat source: ${source.id}`);
    ids.add(source.id);
    for (const value of Object.values(source.multiplier ?? {})) {
      if (dec(value).lt(0)) throw new Error('Stat multipliers cannot be negative');
    }
  }
  const result = {} as Stats;
  const scaled = sources.map(source => scaledSource(source, sources));
  for (const key of Object.keys(BASE_STATS) as (keyof Stats)[]) {
    let flat = dec(base[key]);
    let multiplier = dec(1);
    for (const source of scaled) {
      flat = flat.plus(source.flat?.[key] ?? 0);
      multiplier = multiplier.mul(source.multiplier?.[key] ?? 1);
    }
    let value = dec(modifyValue(text(flat.mul(multiplier)), `stat.${key}`, sources));
    if (key !== 'hpRegen' && key !== 'hpRegenPercent') value = dec(maximum(value, 0));
    if (key === 'critChance') value = dec(minimum(value, 1));
    result[key] = text(value);
  }
  if (dec(result.maxHp).lte(0) || dec(result.attackSpeed).lte(0)) {
    throw new Error('Maximum health and attack speed must be positive');
  }
  return result;
}

export function attackIntervalMs(speed: string): number {
  const value = dec(speed);
  if (!value.isFinite() || value.lte(0)) throw new Error('Invalid attack speed');
  const interval = dec(1000).div(value).ceil().toNumber();
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 3_600_000) {
    throw new Error('Attack interval is outside the supported millisecond range');
  }
  return interval;
}

export function rescaleDeadline(now: number, deadline: number, oldSpeed: string, newSpeed: string): number {
  const remaining = Math.max(0, deadline - now);
  return now + dec(remaining).mul(attackIntervalMs(newSpeed)).div(attackIntervalMs(oldSpeed)).ceil().toNumber();
}

export function rebaseHealth(hp: string, oldMax: string, newMax: string): string {
  if (dec(hp).lte(0)) return '0';
  const missing = dec(maximum(dec(oldMax).minus(hp), 0));
  return maximum(minimum(dec(newMax).minus(missing), newMax), 0);
}
