import { dec, maximum, minimum, text } from '../numbers';
import type { EffectTag, ModifierTarget, SimulationState, StatSource, Stats } from './types';

export interface EffectContext {
  tags?: readonly EffectTag[];
  hp?: string;
  maxHp?: string;
  basicAttackOrdinal?: string;
  normalPower?: boolean;
}

export function activeSources(state: SimulationState): StatSource[] {
  return [
    ...state.player.sources,
    ...state.effects.map(effect => ({ ...effect.source, id: `effect:${effect.id}` })),
  ];
}

export function combatRules(sources: readonly StatSource[]): NonNullable<StatSource['combat']> {
  return Object.assign({}, ...sources.flatMap(source => source.combat ? [source.combat] : []));
}

// Same-group increases add; named groups and explicit multipliers multiply.
export function modifyValue(
  base: string, target: ModifierTarget, sources: readonly StatSource[], context: EffectContext = {},
): string {
  if (context.normalPower) {
    const periods = sources.flatMap(source => (source.modifiers ?? []).flatMap(modifier =>
      modifier.target === target && modifier.when?.everyBasicAttacks &&
      modifier.when.hpAtMost === undefined && !modifier.tags?.some(tag => !context.tags?.includes(tag))
        ? [modifier.when.everyBasicAttacks] : []));
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const period = periods.reduce((length, next) => {
      const value = length / gcd(length, next) * next;
      if (value > 10000) throw new Error('Combined effect period exceeds the normal-power budget');
      return value;
    }, 1);
    let total = dec(0);
    for (let ordinal = 1; ordinal <= period; ordinal++) {
      total = total.plus(modifyValue(base, target, sources, {
        tags: context.tags, basicAttackOrdinal: String(ordinal),
      }));
    }
    return text(total.div(period));
  }
  let flat = dec(base);
  let independent = dec(1);
  const groups = new Map<string, ReturnType<typeof dec>>();
  for (const source of sources) {
    for (const modifier of source.modifiers ?? []) {
      if (modifier.target !== target || modifier.tags?.some(tag => !context.tags?.includes(tag))) continue;
      const condition = modifier.when;
      if (condition?.hpAtMost !== undefined && (context.normalPower || context.hp === undefined ||
          context.maxHp === undefined || dec(context.maxHp).lte(0) ||
          dec(context.hp).gt(dec(context.maxHp).mul(condition.hpAtMost)))) continue;
      if (condition?.everyBasicAttacks !== undefined) {
        if (!context.basicAttackOrdinal || BigInt(context.basicAttackOrdinal) < 1n ||
            BigInt(context.basicAttackOrdinal) % BigInt(condition.everyBasicAttacks) !== 0n) continue;
      }
      const value = dec(modifier.value);
      if (modifier.operation === 'flat') flat = flat.plus(value);
      else if (modifier.operation === 'multiply') independent = independent.mul(value);
      else {
        const group = modifier.group ?? 'increased';
        groups.set(group, (groups.get(group) ?? dec(0)).plus(value));
      }
    }
  }
  for (const increase of groups.values()) independent = independent.mul(maximum(dec(1).plus(increase), 0));
  return text(flat.mul(independent));
}

export function positiveValue(
  base: string, target: ModifierTarget, sources: readonly StatSource[], context: EffectContext = {},
): string {
  return maximum(modifyValue(base, target, sources, context), 0);
}

export function probability(
  base: string, target: 'craft.success' | 'craft.extra-batch', sources: readonly StatSource[], tags: readonly EffectTag[],
): string {
  return minimum(positiveValue(base, target, sources, { tags }), 1);
}

export function scaledSource(source: StatSource, sources: readonly StatSource[]): StatSource {
  const result = structuredClone(source);
  for (const kind of ['flat', 'multiplier'] as const) {
    for (const key of Object.keys(source.statPolarity?.[kind] ?? {}) as (keyof Stats)[]) {
      const polarity = source.statPolarity![kind]![key];
      if (!polarity || result[kind]?.[key] === undefined) continue;
      const factor = positiveValue('1', `source.${polarity}`, sources, { tags: source.tags });
      const neutral = kind === 'flat' ? 0 : 1;
      const value = dec(result[kind]![key]!).minus(neutral).mul(factor).plus(neutral);
      result[kind]![key] = kind === 'flat' ? text(value) : maximum(value, 0);
    }
  }
  return result;
}

export function effectDuration(durationMs: number, sources: readonly StatSource[], tags: readonly EffectTag[]): number {
  const duration = dec(positiveValue(String(durationMs), 'duration', sources, { tags })).ceil().toNumber();
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > Number.MAX_SAFE_INTEGER - 3_600_000) {
    throw new Error('Effect duration is outside the supported range');
  }
  return duration;
}

export function damageValue(
  amount: string, target: 'damage.dealt' | 'damage.taken', sources: readonly StatSource[], context: EffectContext,
): string {
  return dec(amount).lte(0) ? '0' : positiveValue(amount, target, sources, context);
}

export function healingValue(amount: string, sources: readonly StatSource[], tags: readonly EffectTag[]): string {
  return dec(amount).lte(0) ? amount : positiveValue(amount, 'healing.received', sources, { tags });
}

// Preserve signed contributions until after recovery scaling; costs are never amplified as healing.
export function regeneration(
  base: Stats, sources: readonly StatSource[], resolved: Stats,
): string {
  const scaled = sources.map(source => scaledSource(source, sources));
  let total = dec(0);
  for (const key of ['hpRegen', 'hpRegenPercent'] as const) {
    const factor = scaled.reduce((value, source) => value.mul(source.multiplier?.[key] ?? 1), dec(1));
    const offset = dec(modifyValue('0', `stat.${key}`, sources));
    const statFactor = dec(modifyValue('1', `stat.${key}`, sources)).minus(offset);
    const scale = key === 'hpRegenPercent' ? resolved.maxHp : '1';
    const contributions = [
      { amount: text(dec(base[key]).mul(factor).mul(statFactor)), tags: [] as EffectTag[] },
      ...scaled.map(source => ({
        amount: text(dec(source.flat?.[key] ?? 0).mul(factor).mul(statFactor)), tags: source.tags ?? [],
      })),
      { amount: text(offset), tags: [] as EffectTag[] },
    ];
    for (const contribution of contributions) {
      total = total.plus(healingValue(text(dec(contribution.amount).mul(scale)), sources,
        ['regeneration', ...contribution.tags]));
    }
  }
  return text(total);
}
