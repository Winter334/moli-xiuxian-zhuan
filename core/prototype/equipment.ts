import { z } from 'zod';
import { dec, random, text } from '../numbers';
import { ITEMS, lookup } from './content';
import type { StatSource } from './types';

export const instanceSchema = z.object({
  itemId: z.string().min(1), quality: z.number().int().min(10).max(999),
}).strict();
export type ItemInstance = z.infer<typeof instanceSchema>;

export function rarityMultiplier(quality: number): string {
  for (const [limit, factor] of [
    [100, '1'], [130, '1.1'], [160, '1.25'], [200, '1.45'], [240, '1.7'],
    [300, '2'], [400, '2.4'], [500, '3'], [700, '3.6'], [1000, '4.5'],
  ] as const) if (quality < limit) return factor;
  throw new Error('Invalid equipment quality');
}

export function qualityMultiplier(quality: number): string {
  const factor = quality <= 200 ? dec(quality).div(100) : dec(quality).div(200).minus(1).exp().mul(2);
  return text(factor.mul(rarityMultiplier(quality)));
}

export const roundPrice = (value: string) => text(dec(value).minus('.01').ceil());
export function itemValue(itemId: string, quality?: number): string {
  const item = lookup(ITEMS, itemId);
  if (item.kind !== 'part' && item.kind !== 'equipment') return item.value;
  instanceSchema.parse({ itemId, quality });
  return roundPrice(text(dec(item.value).mul(item.kind === 'part' ? dec(quality!).div(100) : qualityMultiplier(quality!))));
}

export function equipmentSource(uid: string, instance: ItemInstance): StatSource {
  const item = lookup(ITEMS, instance.itemId);
  if (item.kind !== 'equipment') throw new Error('Components cannot be equipped');
  if (item.fixedStats) return { id: `equipment:${uid}`, tags: ['equipment'], ...structuredClone(item.fixedStats) };
  const factor = qualityMultiplier(instance.quality);
  const bonusItems = item.blade ? [item.blade, item.hilt!] : item.interior ? [item.interior, item.exterior!] : [instance.itemId];
  const combined: Record<string, string> = {};
  for (const id of bonusItems) {
    for (const [key, value] of Object.entries(lookup(ITEMS, id).bonusFlat ?? {})) {
      combined[key] = text(dec(combined[key] ?? 0).plus(value));
    }
  }
  const bonus = Object.fromEntries(Object.entries(combined).map(([key, value]) =>
    [key, text(dec(value).mul(dec(value).gt(0) ? rarityMultiplier(instance.quality) : 1).toDecimalPlaces(2))]));
  if (item.slot !== 'weapon') {
    const defense = item.interior
      ? dec(lookup(ITEMS, item.interior).defense!).plus(lookup(ITEMS, item.exterior!).defense!)
      : dec(item.defense!);
    return { id: `equipment:${uid}`, tags: ['equipment'], flat: { defense: text(defense.mul(factor).ceil()), ...bonus } };
  }
  const blade = lookup(ITEMS, item.blade!);
  const wooden = item.hilt === 'old-wood-hilt';
  const rawSpeed = dec(blade.attackSpeed!).mul(wooden ? '.95' : 1);
  const speed = wooden || rawSpeed.lt(1) ? rawSpeed.toDecimalPlaces(2)
    : dec(1).plus(rawSpeed.minus(1).mul(rarityMultiplier(instance.quality))).toDecimalPlaces(2);
  return {
    id: `equipment:${uid}`,
    tags: ['equipment'],
    flat: {
      attack: text(dec(blade.attack!).mul(wooden ? '.8' : 1).mul(factor).ceil()),
      critChance: text(dec(blade.critChance!).mul(rarityMultiplier(instance.quality)).toDecimalPlaces(2)),
      ...bonus,
    },
    multiplier: {
      attack: wooden ? '0.8' : '1', attackSpeed: text(speed),
      ...(blade.attackMultiplier ? { attackMultiplier: blade.attackMultiplier } : {}),
    },
  };
}

export function componentQuality(rng: { rng: number }, level: number, tier: number, workshopTier = 0): number {
  const center = 80 + 2 * level + 10 * (workshopTier - tier);
  const low = Math.max(10, Math.round((center - 15) / 4) * 4);
  const high = Math.max(10, Math.round((center + 15) / 4) * 4);
  return Math.min(Math.round((low + random(rng) * (high - low)) / 4) * 4, 100 + 5 * level, 999);
}

export function assemblyQuality(rng: { rng: number }, level: number, blade: ItemInstance, hilt: ItemInstance): number {
  const weightA = lookup(ITEMS, blade.itemId).tier! + 1;
  const weightB = lookup(ITEMS, hilt.itemId).tier! + 1;
  const center = dec(blade.quality).mul(weightA).plus(dec(hilt.quality).mul(weightB)).div(weightA + weightB);
  const low = Math.max(10, center.minus(15).round().toNumber());
  const high = Math.max(10, center.plus(15).round().toNumber());
  return Math.round(Math.min(low + random(rng) * (high - low), 100 + 5 * level, 999));
}
