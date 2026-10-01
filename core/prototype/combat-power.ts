import { dec, maximum, text } from '../numbers';
import { characterStats, type CharacterState } from './character-state';
import { resolveStats } from './stats';
import { positiveValue, regeneration } from './effects';

export const COMBAT_POWER_VERSION = 'normal-power-2';

export function combatPower(state: CharacterState): string {
  const { base, sources } = characterStats(state, true);
  const stats = resolveStats(base, sources);
  const critical = dec(1).plus(dec(stats.critChance).mul(dec(stats.critMultiplier).minus(1)));
  const attack = dec(stats.attack).mul(stats.attackMultiplier).mul(critical);
  const offense = dec(positiveValue(text(attack), 'damage.dealt', sources,
    { tags: ['direct', 'basic-attack'], normalPower: true })).mul(stats.attackSpeed);
  const recovery = dec(regeneration(base, sources, stats));
  const mitigation = positiveValue('1', 'damage.taken', sources, { tags: ['direct'], normalPower: true });
  const health = dec(maximum(dec(stats.maxHp).plus(recovery.mul(10)), 0)).div(maximum(mitigation, '0.01'));
  return text(offense.plus(stats.defense).plus(stats.agility).plus(dec(health).div(50)).floor());
}
