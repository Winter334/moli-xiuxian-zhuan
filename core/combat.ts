import type { Action, Effect } from './content';
import type { Combatant, Stats } from './types';
import { dec, maximum, minimum, sub, text } from './numbers';

export function hitChance(attackerAgility: string, defenderAgility: string): number {
  const a = dec(attackerAgility);
  const d = dec(defenderAgility);
  return dec('0.1').plus(a.mul(4).div(a.mul(4).plus(d)).mul('0.85')).toNumber();
}

export function strikeDamage(
  attack: string, defense: string, coefficient: string,
  critical: boolean, critMultiplier: string,
): string {
  const power = dec(attack).mul(coefficient);
  const afterDefense = dec(maximum(power.minus(defense), 0));
  return text(afterDefense.mul(critical ? critMultiplier : 1));
}

export function defenseFor(stats: Stats, damageType: Action['damageType']): string {
  return damageType === 'physical' ? stats.defense : stats.magicDefense;
}

export function directDamage(attacker: Stats, defender: Stats, action: Action, critical: boolean): string {
  const attack = action.damageType === 'physical' ? attacker.attack : attacker.magicAttack;
  return strikeDamage(attack, defenseFor(defender, action.damageType), action.coefficient, critical, attacker.critMultiplier);
}

export function applyDamage(target: Combatant, amount: string) {
  const absorbed = minimum(target.shield, amount);
  const hpLost = minimum(target.hp, dec(amount).minus(absorbed));
  target.shield = sub(target.shield, absorbed);
  target.hp = sub(target.hp, hpLost);
  return { absorbed, hpLost };
}

export function restore(target: Combatant, stats: Stats, resource: 'hp' | 'mp', amount: string) {
  const before = target[resource];
  target[resource] = minimum(dec(before).plus(amount), resource === 'hp' ? stats.maxHp : stats.maxMp);
  return sub(target[resource], before);
}

// Triggered damage deliberately never dispatches another trigger or crit roll.
export function triggerEffects(
  when: Effect['trigger'], effects: Effect[], owner: Combatant, ownerStats: Stats,
  opponent: Combatant, opponentStats: Stats,
): { hpLost: string } {
  let hpLost = dec(0);
  for (const effect of effects) {
    if (dec(owner.hp).lte(0)) break;
    if (effect.trigger !== when) continue;
    if (effect.kind === 'restore') restore(owner, ownerStats, effect.resource, effect.amount);
    if (effect.kind === 'restore-percent') restore(owner, ownerStats, effect.resource,
      text(dec(effect.resource === 'hp' ? ownerStats.maxHp : ownerStats.maxMp).mul(effect.amount)));
    if (effect.kind === 'shield') owner.shield = minimum(dec(owner.shield).plus(effect.amount), ownerStats.maxHp);
    if (effect.kind === 'damage' && dec(opponent.hp).gt(0)) {
      const damage = strikeDamage(effect.amount, defenseFor(opponentStats, effect.damageType), '1', false, '1');
      hpLost = hpLost.plus(applyDamage(opponent, damage).hpLost);
    }
  }
  return { hpLost: text(hpLost) };
}
