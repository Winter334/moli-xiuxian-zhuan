import { dec, maximum, minimum, random, text } from '../numbers';
import type { ResolvedEnemy, Stats, Strike, StatSource } from './types';

export function hitChance(attackerAgility: string, defenderAgility: string): number {
  const attacker = dec(attackerAgility);
  const defender = dec(defenderAgility);
  if (attacker.lte(0)) return 0;
  if (defender.lte(0)) return 1;
  return Math.min(1, Math.max(0,
    0.63661977 * Math.atan(attacker.mul(2).div(defender).pow('1.5').toNumber())));
}

const miss = (): Strike => ({ hit: false, critical: false, damage: '0', incomingPower: '0' });
const ceilTenth = (value: string) => text(dec(value).mul(10).ceil().div(10));

export function playerStrike(
  rng: { rng: number }, player: Stats, enemy: ResolvedEnemy, aliveCount: number, sturdyCap = 1,
  coefficient = '1', rules: NonNullable<StatSource['combat']> = {},
  health?: { player: string; enemy: string },
): Strike {
  const agility = dec(player.agility).mul(dec(aliveCount).cbrt());
  if (random(rng) >= hitChance(text(agility), enemy.stats.agility)) return miss();
  const variation = dec('1.2').minus(dec(random(rng)).mul('0.4'));
  const critical = random(rng) < dec(player.critChance).toNumber();
  if (enemy.abilities.currentHealthSuppression && !health) throw new Error('Current health is required for suppression');
  const suppressionRatio = enemy.abilities.currentHealthSuppression
    ? maximum(dec(1).minus(dec(health!.enemy).div(health!.player)), 0) : '1';
  const attack = dec(enemy.abilities.reversal ? player.defense : player.attack)
    .mul(coefficient)
    .mul(suppressionRatio)
    .mul(dec(1).minus(dec(enemy.abilities.weakening ?? 0).div(100)))
    .mul(enemy.abilities.softBones ? '0.9' : 1);
  let damage = ceilTenth(maximum(attack.minus(enemy.stats.defense), 0));
  if (rules.minimumAttackDamageRatio) damage = maximum(damage, attack.mul(rules.minimumAttackDamageRatio));
  if (enemy.abilities.sturdy) damage = minimum(damage, sturdyCap);
  const restraint = rules.restraint
    ? minimum(dec(player.defense).div(dec(enemy.stats.defense).plus('0.0001')).mul(rules.restraint.coefficient), rules.restraint.cap)
    : '1';
  let suppression = '1';
  if (enemy.abilities.defensiveFlash && dec(player.attack).lte(enemy.stats.attack) && dec(enemy.stats.defense).gt(0)) {
    // A defensive effect may nullify damage, never heal its owner or divide by zero.
    suppression = dec(player.defense).eq(0) ? '0'
      : maximum(dec(1).minus(dec(enemy.stats.defense).div(player.defense).div(2)), 0);
  }
  return {
    hit: true, critical, incomingPower: text(attack),
    damage: text(dec(damage).mul(variation).mul(critical ? player.critMultiplier : 1)
      .mul(player.attackMultiplier).mul(suppression).mul(restraint)),
  };
}

export function enemyStrike(
  rng: { rng: number }, enemy: ResolvedEnemy, player: Stats, aliveCount: number, attackCoefficient = '1',
  context: { money?: string; marrowInsight?: string; damageMultiplier?: string; hp?: string } = {},
): Strike {
  let coefficient = dec(attackCoefficient);
  if (enemy.abilities.currentHpAttackDivisor !== undefined) {
    if (context.hp === undefined) throw new Error('Current health is required for this enemy');
    coefficient = coefficient.plus(dec(context.hp).div(enemy.stats.attack).div(enemy.abilities.currentHpAttackDivisor));
  }
  if (enemy.abilities.agilityDeficit) {
    const { threshold, scale } = enemy.abilities.agilityDeficit;
    coefficient = coefficient.plus(dec(maximum(dec(threshold).minus(player.agility), 0))
      .mul(scale).div(enemy.stats.attack));
  }
  coefficient = coefficient.mul(enemy.abilities.attackCoefficientMultiplier ?? '1');
  const variation = dec('1.2').minus(dec(random(rng)).mul('0.4'));
  const restraint = enemy.abilities.restraint
    ? dec(player.defense).eq(0) ? dec('9999.99') : dec(enemy.stats.defense).div(player.defense)
    : dec(1);
  let special = restraint.mul(enemy.abilities.rending ? '1.5' : 1);
  if (enemy.abilities.walletSuppressionUnit !== undefined) {
    if (context.money === undefined) throw new Error('Wallet balance is required for this enemy');
    special = special.mul(maximum(
      dec(1).minus(dec(context.money).div(dec(enemy.abilities.walletSuppressionUnit).mul(100))), 0,
    ));
  }
  if (enemy.abilities.marrowSuppressionUnit !== undefined) {
    if (context.marrowInsight === undefined) throw new Error('Marrow insight is required for this enemy');
    special = special.mul(maximum(
      dec(1).minus(dec(context.marrowInsight).div(dec(enemy.abilities.marrowSuppressionUnit).mul(100))), 0,
    ));
  }
  const agility = dec(player.agility).div(dec(aliveCount).cbrt());
  const missed = random(rng) > hitChance(enemy.stats.agility, text(agility));
  if (missed && special.mul(coefficient).lt(25)) return miss();
  const critical = random(rng) < dec(enemy.stats.critChance).toNumber();
  // Round growth scales damage after the hit check, including the defense subtraction.
  const multiplier = special.mul(variation).mul(critical ? enemy.stats.critMultiplier : 1)
    .mul(context.damageMultiplier ?? '1');
  const incomingPower = dec(enemy.stats.attack).mul(multiplier).mul(coefficient);
  const playerDefense = enemy.abilities.bullying
    ? dec(player.defense).minus(maximum(dec(enemy.stats.defense).minus(player.defense), 0))
    : dec(enemy.abilities.reversal ? player.attack : player.defense);
  const defense = enemy.abilities.ignoreDefense ? dec(0)
    : playerDefense
      .plus(enemy.abilities.softBones ? dec(player.attack).mul('0.1') : 0).mul(multiplier)
      .mul(dec(1).minus(dec(enemy.abilities.weakening ?? 0).div(100)));
  return {
    hit: true, critical, incomingPower: text(incomingPower),
    damage: ceilTenth(maximum(incomingPower.minus(defense), 0)),
  };
}
