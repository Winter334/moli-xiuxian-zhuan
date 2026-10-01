import { describe, expect, it } from 'vitest';
import {
  advanceSimulation, applyTimedEffect, BASE_STATS, createSimulation, gainCultivation,
  getPlayerStats, killExperience, pauseSimulationUntil, readSimulation,
  realmAt, rebaseHealth, resolveStats, setRecoveryMode, startEncounter, updatePlayerStats, withdraw,
  type EnemyDefinition, type SimulationEvent, type SimulationState, type Stats,
} from './index';
import { enemySchema } from './types';
import { enemyStrike, playerStrike } from './combat';
import { dec, text } from '../numbers';
import { FOUNDATION_LEVEL, LEVEL_CAP } from './growth';

const stats = (overrides: Partial<Stats> = {}): Stats => ({ ...BASE_STATS, ...overrides });
const enemy = (id: string, overrides: Partial<Stats> = {}, abilities: EnemyDefinition['abilities'] = {}): EnemyDefinition =>
  ({ id, stats: stats({ maxHp: '10000', attack: '0', defense: '0', ...overrides }), abilities });
const create = (base = stats()) => createSimulation({ clockMs: 0, seed: 417, base });
const fight = (state: SimulationState, enemies = [enemy('target')]) =>
  startEncounter(state, { regionId: 'test-region', enemies });

describe('prototype shared contracts', () => {
  it('caps cultivation at a gated promotion and only carries excess from a permitted breakthrough', () => {
    const before = FOUNDATION_LEVEL - 1;
    const cost = realmAt(FOUNDATION_LEVEL).entryCost;
    const capped = { level: before, cultivation: cost, levels: [], referencePromotions: 0 };
    expect(gainCultivation(before, text(dec(cost).minus('0.5')), '1')).toMatchObject(capped);
    for (const amount of ['0', '1', text(dec(cost).mul(100))]) {
      expect(gainCultivation(before, cost, amount)).toMatchObject(capped);
    }
    expect(gainCultivation(0, '0', text(dec(realmAt(FOUNDATION_LEVEL).cumulativeCost).plus(7)))).toMatchObject({
      level: before, cultivation: cost, levels: Array.from({ length: before }, (_, i) => i + 1),
      referencePromotions: Math.floor(Number(realmAt(before).effectiveRealm)),
    });
    const early = gainCultivation(before, '0', text(dec(cost).minus(1)), true);
    expect(early.level).toBe(before);
    expect(gainCultivation(early.level, early.cultivation, '1')).toMatchObject(capped);
    expect(gainCultivation(before, cost, '0', true)).toMatchObject({
      level: FOUNDATION_LEVEL, cultivation: '0', levels: [FOUNDATION_LEVEL], referencePromotions: 1,
    });
    expect(gainCultivation(before, cost, '7', true)).toMatchObject({
      level: FOUNDATION_LEVEL, cultivation: '7', levels: [FOUNDATION_LEVEL], referencePromotions: 1,
    });
    const stored = text(dec(cost).plus(7));
    expect(gainCultivation(LEVEL_CAP, stored, '1', true)).toMatchObject({
      level: LEVEL_CAP, cultivation: text(dec(stored).plus(1)), levels: [], referencePromotions: 0,
    });
  });

  it('keeps integer realm panels and reconciles costs without duplicating healing milestones', () => {
    let total = 0;
    let heals = 0;
    for (let level = 0; level <= 12; level++) {
      const realm = realmAt(level);
      for (const key of ['attack', 'defense', 'agility', 'maxHp'] as const) {
        expect(realm.stats[key]).toMatch(/^(0|[1-9]\d*)$/);
        if (level > 0) expect(Number(realm.stats[key])).toBeGreaterThanOrEqual(Number(realmAt(level - 1).stats[key]));
      }
      expect(realm.cumulativeCost).toMatch(/^(0|[1-9]\d*)$/);
      expect(realm.entryCost).toMatch(/^(0|[1-9]\d*)$/);
    }
    for (let level = 1; level <= 12; level++) {
      const realm = realmAt(level);
      total += Number(realm.entryCost);
      expect(Number(realm.cumulativeCost)).toBe(total);
      const result = gainCultivation(level - 1, '0', realm.entryCost);
      expect(result.level).toBe(level);
      expect(result.cultivation).toBe('0');
      heals += result.referencePromotions;
    }
    expect(String(total)).toBe(realmAt(12).cumulativeCost);
    expect(heals).toBe(8);
    expect(gainCultivation(0, '0', String(total))).toMatchObject({
      level: 12, cultivation: '0', referencePromotions: heals,
    });
    expect(killExperience('10', 2, 3, 1)).toBe('10');
    expect(Number(killExperience('10', 2, 2, 1))).toBeGreaterThan(10);
  });

  it('multiplies independent sources and preserves signed regeneration without merging attacks', () => {
    const result = resolveStats(stats({ attack: '100' }), [
      { id: 'one', multiplier: { attack: '1.2' } },
      { id: 'two', multiplier: { attack: '1.3', attackSpeed: '0.5' }, flat: { hpRegen: '-3' } },
      { id: 'three', multiplier: { attackMultiplier: '2' } },
    ]);
    expect(result).toMatchObject({ attack: '156', attackMultiplier: '2', attackSpeed: '0.5', hpRegen: '-3' });
    expect(() => resolveStats(stats(), [{ id: 'same' }, { id: 'same' }])).toThrow();
    expect('mp' in result || 'magicAttack' in result).toBe(false);
  });

  it('has identical snapshots and events for single-pass, sliced and bounded advancement', () => {
    let initial = create(stats({ maxHp: '100000', attackSpeed: '3', hpRegen: '1' }));
    initial = applyTimedEffect(initial, {
      id: 'tempo', durationMs: 3200, source: { id: 'tempo', multiplier: { attackSpeed: '1.3' } },
    }).state;
    initial = fight(initial, [
      enemy('one', { attackSpeed: '1.1' }, { reversal: true }),
      enemy('two', { attack: '10' }, { strikes: ['0.8', '1.2'], rampingDamage: true }),
    ]).state;
    const once = advanceSimulation(initial, 8731);
    let state = readSimulation(JSON.parse(JSON.stringify(initial)));
    const events: SimulationEvent[] = [];
    for (const target of [117, 951, 1874, 2999, 3200, 3999, 8731]) {
      while (state.clockMs < target) {
        const part = advanceSimulation(state, target, 2);
        expect(part.state.clockMs).toBeGreaterThan(state.clockMs);
        state = readSimulation(JSON.parse(JSON.stringify(part.state)));
        events.push(...part.events);
      }
    }
    expect(state).toEqual(once.state);
    expect(events).toEqual(once.events);
    expect(once.events.filter((entry) => entry.kind === 'strike' && entry.side === 'player').length).toBeGreaterThan(9);
  });

  it('pauses all remaining timers without changing the encounter and resumes the same event sequence', () => {
    let initial = fight(create(stats({ maxHp: '10000' })), [
      enemy('one', { attackSpeed: '1.1' }), enemy('two', {}, { strikes: 2, rampingDamage: true }),
    ]).state;
    initial = applyTimedEffect(initial, {
      id: 'tempo', durationMs: 3200, source: { id: 'tempo', multiplier: { attackSpeed: '1.3' } },
    }).state;
    const partial = advanceSimulation(initial, 1117).state;
    partial.battle!.enemies[0].hp = '0';
    partial.battle!.enemies[0].nextActionAt = 500;
    const saved = structuredClone(partial);
    const gap = 86_400_000;
    const paused = pauseSimulationUntil(partial, partial.clockMs + gap);
    expect(partial).toEqual(saved);
    expect(paused).toEqual({
      ...partial, clockMs: partial.clockMs + gap, nextPulseAt: partial.nextPulseAt + gap,
      player: { ...partial.player, nextActionAt: partial.player.nextActionAt! + gap },
      battle: { ...partial.battle, enemies: partial.battle!.enemies.map((entry) => ({
        ...entry, nextActionAt: entry.nextActionAt + gap,
      })) },
      effects: partial.effects.map((entry) => ({ ...entry, expiresAt: entry.expiresAt + gap })),
    });
    const online = advanceSimulation(partial, 4731);
    const resumed = advanceSimulation(readSimulation(JSON.parse(JSON.stringify(paused))), gap + 4731);
    expect(resumed.events).toEqual(online.events.map((event) => ({ ...event, at: event.at + gap })));
    expect(resumed.state).toEqual(pauseSimulationUntil(online.state, online.state.clockMs + gap));
    expect(() => pauseSimulationUntil(partial, partial.clockMs - 1)).toThrow();
    expect(() => pauseSimulationUntil(partial, Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it('keeps independent enemy timers, entry attacks and each double-strike segment', () => {
    const entered = fight(create(stats({ maxHp: '10000' })), [
      enemy('entry', { attackSpeed: '2' }, { entryStrikes: 3 }),
      enemy('double', { attackSpeed: '1' }, { strikes: 2 }),
    ]);
    expect(entered.events.filter((entry) => entry.kind === 'strike')).toHaveLength(3);
    const advanced = advanceSimulation(entered.state, 1000);
    const enemyEvents = advanced.events.filter((entry) => entry.kind === 'strike' && entry.side === 'enemy');
    expect(enemyEvents).toHaveLength(4);
    expect(enemyEvents.filter((entry) => entry.at === 500)).toHaveLength(1);
    expect(advanceSimulation(advanced.state, 1000).events).toEqual([]);
  });

  it('settles growth between enemy strike segments instead of after catch-up', () => {
    const base = stats({ maxHp: '10000', agility: '0', defense: '0' });
    const hooks = {
      settle: (_state: SimulationState, event: SimulationEvent | { kind: 'pulse' }) =>
        event.kind === 'strike' && event.side === 'enemy' ? { base: { ...base, defense: '1000' } } : undefined,
    };
    const result = startEncounter(create(base), {
      regionId: 'test-region', enemies: [enemy('entry', { attack: '100', agility: '100' }, { entryStrikes: 3 })],
    }, hooks);
    const strikes = result.events.filter((event) => event.kind === 'strike');
    expect(strikes).toHaveLength(3);
    expect(Number(strikes[0].damage)).toBeGreaterThan(0);
    expect(strikes.slice(1).map((event) => event.damage)).toEqual(['0', '0']);
    expect(result.state.player.base.defense).toBe('1000');
  });

  it('settles one completed player action after its rewards, including misses', () => {
    const initial = fight(create(stats({ attack: '100', agility: '1000' })), [
      enemy('target', { maxHp: '1', agility: '0' }),
    ]).state;
    const order: string[] = [];
    const result = advanceSimulation(initial, 1000, 10, {
      settle: (_state, event) => { if (event.kind !== 'pulse') order.push(event.kind); },
    });
    expect(order).toEqual(['strike', 'enemy-defeated', 'group-cleared', 'player-action-completed']);
    expect(result.events.filter(event => event.kind === 'player-action-completed'))
      .toEqual([{ kind: 'player-action-completed', at: 1000, regionId: 'test-region', targetIds: ['target'] }]);

    const missed = advanceSimulation(fight(create(stats({ agility: '0' }))).state, 1000);
    expect(missed.events.find(event => event.kind === 'strike' && event.side === 'player'))
      .toMatchObject({ hit: false });
    expect(missed.events.filter(event => event.kind === 'player-action-completed')).toHaveLength(1);
  });

  it('applies promotion healing before another enemy acts at the same timestamp', () => {
    const base = stats({ maxHp: '100', attack: '100', agility: '1', defense: '0' });
    const initial = createSimulation({ clockMs: 0, seed: 417, base, hp: '1' });
    const entered = fight(initial, [
      enemy('weak', { maxHp: '1', agility: '0' }),
      enemy('survivor', { attack: '90', agility: '1000' }),
    ]).state;
    const result = advanceSimulation(entered, 1000, 100, {
      settle: (_state, event) => event.kind === 'enemy-defeated'
        ? { base: { ...base, maxHp: '200', defense: '1000' }, fullHeal: true } : undefined,
    });
    expect(result.events.some((event) => event.kind === 'enemy-defeated')).toBe(true);
    expect(result.events.some((event) => event.kind === 'strike' && event.side === 'enemy')).toBe(true);
    expect(result.state.player.hp).toBe('200');
    expect(result.state.mode).toBe('combat');
  });

  it('settles fixed miss punishment immediately without enemy strikes, timer resets or post-faint actions', () => {
    const base = stats({ maxHp: '100', agility: '0', defense: '100000', attackSpeed: '2' });
    const target = enemy('punisher', { attack: '100000', attackSpeed: '1' }, { missPunishment: '23' });
    const initial = fight(create(base), [target]).state;
    const nonlethal = advanceSimulation(initial, 500);
    expect(nonlethal.state.player.hp).toBe('77');
    expect(nonlethal.state.battle!.enemies[0].nextActionAt).toBe(1000);
    expect(nonlethal.events.map(event => event.kind)).toEqual(['strike', 'miss-punishment', 'player-action-completed']);
    expect(nonlethal.events[1]).toMatchObject({ at: 500, damage: '23', hpLost: '23' });
    const lethal = readSimulation(initial);
    lethal.player.hp = '10';
    lethal.battle!.enemies[0].nextActionAt = 500;
    const result = advanceSimulation(lethal, 500);
    expect(result.events.map(event => event.kind)).toEqual(['strike', 'miss-punishment', 'fainted', 'player-action-completed']);
    expect(result.events[1]).toMatchObject({ damage: '23', hpLost: '10' });
    expect(result.state.player.hp).toBe('0');
    expect(result.state.mode).toBe('rest');
    expect(result.state.battle).toBeNull();
    const ordinary = fight(create(base), [enemy('plain')]).state;
    expect(advanceSimulation(ordinary, 500).events.some(event => event.kind === 'miss-punishment')).toBe(false);
  });

  it('applies sturdy before critical and attack multipliers without inventing minimum damage', () => {
    const target = enemySchema.parse(enemy('sturdy', { agility: '0' }, { sturdy: true }));
    const attacker = stats({ attack: '100', critChance: '1', critMultiplier: '2', attackMultiplier: '3' });
    const strike = playerStrike({ rng: 7 }, attacker, target, 1);
    expect(strike.hit).toBe(true);
    expect(Number(strike.damage)).toBeGreaterThan(1);
    expect(Number(strike.damage)).toBeLessThanOrEqual(7.2);
    target.stats.defense = '1000';
    expect(playerStrike({ rng: 7 }, attacker, target, 1).damage).toBe('0');
    target.stats.defense = '0';
    expect(playerStrike({ rng: 7 }, { ...attacker, attackMultiplier: '0' }, target, 1).damage).toBe('0');
  });

  it('applies opponent-local weakening and post-defense rending without changing the panels', () => {
    const player = stats({ attack: '100', defense: '80', agility: '100', critChance: '0' });
    const target = enemySchema.parse(enemy('target', { attack: '100', defense: '50', agility: '0', critChance: '0' }));
    const weakened = enemySchema.parse({ ...target, abilities: { ...target.abilities, weakening: 10 } });
    const before = structuredClone({ player, target });
    const normalHit = playerStrike({ rng: 7 }, player, target, 1);
    const weakenedHit = playerStrike({ rng: 7 }, player, weakened, 1);
    expect(weakenedHit.incomingPower).toBe('90');
    expect(weakenedHit.damage).toBe(text(dec(normalHit.damage).mul('.8')));
    expect(playerStrike({ rng: 7 }, player, target, 1)).toEqual(normalHit);
    expect({ player, target }).toEqual(before);

    const attacker = enemySchema.parse({ ...target, stats: { ...target.stats, agility: '100' } });
    const defender = { ...player, agility: '0' };
    const plain = enemyStrike({ rng: 7 }, attacker, defender, 1);
    const debuffed = enemyStrike({ rng: 7 }, {
      ...attacker, abilities: { ...attacker.abilities, weakening: 10 },
    }, defender, 1);
    const ceilTenth = (value: string) => text(dec(value).mul(10).ceil().div(10));
    expect(debuffed.incomingPower).toBe(plain.incomingPower);
    expect(debuffed.damage).toBe(ceilTenth(text(dec(plain.incomingPower).mul('.28'))));
    const rending = { ...attacker, abilities: { ...attacker.abilities, rending: true } };
    const torn = enemyStrike({ rng: 7 }, rending, defender, 1);
    expect(torn.incomingPower).toBe(text(dec(plain.incomingPower).mul('1.5')));
    expect(torn.damage).toBe(ceilTenth(text(dec(torn.incomingPower).mul('.2'))));
    expect(enemyStrike({ rng: 7 }, rending, { ...defender, defense: '100' }, 1).damage).toBe('0');

    const restrained = enemySchema.parse(enemy('restraint', { defense: '17', agility: '0' }, { restraint: true }));
    const evasive = stats({ defense: '1', agility: '100' });
    expect(enemyStrike({ rng: 7 }, restrained, evasive, 1).hit).toBe(false);
    expect(enemyStrike({ rng: 7 }, {
      ...restrained, abilities: { ...restrained.abilities, rending: true },
    }, evasive, 1).hit).toBe(true);
  });

  it('keeps ignore-defense and zero-defense restraint on their actual damage paths', () => {
    const attacker = enemySchema.parse(enemy('caster', { attack: '10', critChance: '0' }, { ignoreDefense: true }));
    const defender = stats({ defense: '100', agility: '0' });
    expect(Number(enemyStrike({ rng: 7 }, attacker, defender, 1).damage)).toBeGreaterThan(0);
    attacker.abilities.ignoreDefense = false;
    expect(enemyStrike({ rng: 7 }, attacker, defender, 1).damage).toBe('0');
    attacker.abilities.restraint = true;
    attacker.stats.agility = '0';
    const restrained = enemyStrike({ rng: 7 }, attacker, stats({ defense: '0', agility: '1000' }), 1);
    expect(restrained.hit).toBe(true);
    expect(Number(restrained.damage)).toBeGreaterThan(10000);
  });

  it('substitutes opponent-local reversed stats even at zero without mutating other matchups', () => {
    const target = enemySchema.parse(enemy('target', { attack: '200', defense: '10', agility: '1' }, { weakening: 10 }));
    const reversed = enemySchema.parse({ ...target, abilities: { ...target.abilities, reversal: true } });
    for (const [attack, defense] of [['100', '40'], ['0', '40'], ['100', '0'], ['0', '0']]) {
      const player = stats({ attack, defense, agility: '1000' });
      const swapped = { ...player, attack: defense, defense: attack };
      const before = structuredClone({ player, target, reversed });
      const outgoing = playerStrike({ rng: 7 }, player, target, 2);
      const incoming = enemyStrike({ rng: 7 }, target, { ...player, agility: '0' }, 2);
      expect(playerStrike({ rng: 7 }, player, reversed, 2))
        .toEqual(playerStrike({ rng: 7 }, swapped, target, 2));
      expect(enemyStrike({ rng: 7 }, reversed, { ...player, agility: '0' }, 2))
        .toEqual(enemyStrike({ rng: 7 }, target, { ...swapped, agility: '0' }, 2));
      expect(playerStrike({ rng: 7 }, player, target, 2)).toEqual(outgoing);
      expect(enemyStrike({ rng: 7 }, target, { ...player, agility: '0' }, 2)).toEqual(incoming);
      expect({ player, target, reversed }).toEqual(before);
    }
  });

  it('scales each enemy attack before defense and includes its coefficient in the guaranteed-hit threshold', () => {
    const attacker = enemySchema.parse(enemy('target', { attack: '100', agility: '10', critChance: '0' }));
    const player = stats({ defense: '90', agility: '0' });
    const plain = enemyStrike({ rng: 7 }, attacker, player, 1);
    const light = enemyStrike({ rng: 7 }, attacker, player, 1, '0.8');
    const heavy = enemyStrike({ rng: 7 }, attacker, player, 1, '1.2');
    expect(light.incomingPower).toBe(text(dec(plain.incomingPower).mul('.8')));
    expect(light.damage).toBe('0');
    expect(heavy.incomingPower).toBe(text(dec(plain.incomingPower).mul('1.2')));
    expect(heavy.damage).toBe(text(dec(plain.incomingPower).mul('.3').mul(10).ceil().div(10)));
    const restrained = enemySchema.parse(enemy('target', { defense: '25', agility: '0' }, { restraint: true }));
    const evasive = stats({ defense: '1', agility: '100' });
    expect(enemyStrike({ rng: 7 }, restrained, evasive, 1, '0.8').hit).toBe(false);
    expect(enemyStrike({ rng: 7 }, restrained, evasive, 1, '1').hit).toBe(true);
    expect(enemyStrike({ rng: 7 }, restrained, evasive, 1, '1.2').hit).toBe(true);
  });

  it('scales wallet and round damage across defense but only wallet suppression changes guaranteed hits', () => {
    const target = enemySchema.parse(enemy('target', { attack: '100', agility: '100', critChance: '0' },
      { walletSuppressionUnit: '10', rampingDamage: true }));
    const player = stats({ defense: '80', agility: '0' });
    const plain = enemyStrike({ rng: 7 }, target, player, 1, '1', { money: '0' });
    const scaled = enemyStrike({ rng: 7 }, target, player, 1, '1', { money: '500', damageMultiplier: '3' });
    expect(scaled.incomingPower).toBe(text(dec(plain.incomingPower).mul('1.5')));
    expect(scaled.damage).toBe(text(dec(scaled.incomingPower).mul('.2').mul(10).ceil().div(10)));
    for (const money of ['1000', '2000']) {
      expect(enemyStrike({ rng: 7 }, target, player, 1, '1', { money, damageMultiplier: '3' }))
        .toMatchObject({ hit: true, incomingPower: '0', damage: '0' });
    }
    const restrained = enemySchema.parse(enemy('target', { defense: '25', agility: '0' },
      { restraint: true, walletSuppressionUnit: '10' }));
    const evasive = stats({ defense: '1', agility: '100' });
    expect(enemyStrike({ rng: 7 }, restrained, evasive, 1, '1', { money: '0' }).hit).toBe(true);
    expect(enemyStrike({ rng: 7 }, restrained, evasive, 1, '1', { money: '1', damageMultiplier: '100' }).hit).toBe(false);
    expect(enemyStrike({ rng: 7 }, target, evasive, 1, '1', { money: '0', damageMultiplier: '100' }).hit)
      .toBe(enemyStrike({ rng: 7 }, target, evasive, 1, '1', { money: '0' }).hit);
  });

  it('settles unequal timed strikes separately, keeps entry attacks unscaled and stops on defeat', () => {
    const base = stats({ maxHp: '10000', defense: '0', agility: '0' });
    const foe = enemy('unequal', { attack: '100', agility: '100', critChance: '0' },
      { entryStrikes: 1, strikes: ['0.8', '1.2'] });
    const entered = fight(create(base), [foe]);
    const unscaled = fight(create(base), [{ ...foe, abilities: { entryStrikes: 1 } }]);
    expect(entered.events).toEqual(unscaled.events);
    const result = advanceSimulation(entered.state, 1000, 10, {
      settle: (_state, event) => event.kind === 'strike' && event.side === 'enemy'
        ? { base: { ...base, defense: '1000' } } : undefined,
    });
    const strikes = result.events.filter(event => event.kind === 'strike').filter(event => event.side === 'enemy');
    expect(strikes).toHaveLength(2);
    expect(Number(strikes[0].damage)).toBeGreaterThan(0);
    expect(strikes[1].damage).toBe('0');
    expect(result.state.player.base.defense).toBe('1000');

    const low = structuredClone(entered.state);
    low.player.hp = '1';
    const defeated = advanceSimulation(low, 1000);
    const lethalStrikes = defeated.events.filter(event => event.kind === 'strike' && event.side === 'enemy');
    expect(lethalStrikes).toHaveLength(1);
    expect(lethalStrikes[0]).toMatchObject({ hpLost: '1' });
    expect(defeated.events.filter(event => event.kind === 'fainted')).toHaveLength(1);
    expect(defeated.state.battle).toBeNull();
  });

  it('tracks conditional normal rounds through pause and reads mirror attack after the preceding strike', () => {
    const base = stats({ maxHp: '1000000', attack: '20', defense: '0', agility: '0' });
    const foes = [
      enemy('mirror', { attack: '100', agility: '100', critChance: '0' }, { mirrorOpening: true }),
      enemy('array', { attack: '100', agility: '100', critChance: '0' }, { arrayStrikes: true }),
    ];
    const hooks = {
      settle: (_state: SimulationState, event: SimulationEvent | { kind: 'pulse' }) =>
        event.kind === 'strike' && event.side === 'enemy' && event.slot === 0
          ? { base: { ...base, attack: '40' } } : undefined,
    };
    const entered = fight(create(base), foes).state;
    const first = advanceSimulation(entered, 1000, 100, hooks);
    const mirror = first.events.filter(event => event.kind === 'strike' && event.side === 'enemy' && event.slot === 0);
    expect(mirror).toHaveLength(2);
    if (mirror[1].kind === 'strike') {
      expect(Number(mirror[1].incomingPower)).toBeGreaterThanOrEqual(32);
      expect(Number(mirror[1].incomingPower)).toBeLessThanOrEqual(48);
    }
    const expected = advanceSimulation(first.state, 7000, 100, hooks);
    const gap = 100000;
    const resumed = advanceSimulation(pauseSimulationUntil(first.state, 1000 + gap), 7000 + gap, 100, hooks);
    expect(resumed.events).toEqual(expected.events.map(event => ({ ...event, at: event.at + gap })));
    expect(resumed.state).toEqual(pauseSimulationUntil(expected.state, 7000 + gap));
    const all = [...first.events, ...expected.events].filter(event => event.kind === 'strike').filter(event => event.side === 'enemy');
    expect(all.filter(event => event.slot === 0)).toHaveLength(10);
    expect(all.filter(event => event.slot === 1)).toHaveLength(10);
    const invalid = structuredClone(first.state);
    delete invalid.battle!.enemies[0].nextRound;
    expect(() => readSimulation(invalid)).toThrow('round checkpoint');
  });

  it('keeps entry damage multipliers and odd-round growth separate from attack coefficients', () => {
    const base = stats({ maxHp: '100000', defense: '90', agility: '0' });
    const foe = enemy('storm', { attack: '100', agility: '100', critChance: '0' },
      { entryStrikes: 4, entryDamageMultiplier: '5', rampingDamage: true, rampingDamageStep: 2 });
    const entered = fight(create(base), [foe]);
    const plain = fight(create(base), [{ ...foe, abilities: { entryStrikes: 4 } }]);
    const strikes = entered.events.filter(event => event.kind === 'strike');
    const plainStrikes = plain.events.filter(event => event.kind === 'strike');
    expect(strikes).toHaveLength(4);
    for (let i = 0; i < strikes.length; i++) {
      expect(strikes[i].incomingPower).toBe(text(dec(plainStrikes[i].incomingPower).mul(5)));
      expect(strikes[i].damage).toBe(text(dec(strikes[i].incomingPower).div(10).mul(10).ceil().div(10)));
    }
    expect(entered.state.battle!.enemies[0].nextRound).toBe(1);
    const normal = advanceSimulation(entered.state, 2000).events
      .filter(event => event.kind === 'strike').filter(event => event.side === 'enemy');
    expect(normal).toHaveLength(2);
    expect(Number(normal[0].incomingPower)).toBeLessThanOrEqual(120);
    expect(Number(normal[1].incomingPower)).toBeGreaterThanOrEqual(240);
    expect(Number(normal[1].incomingPower)).toBeLessThanOrEqual(360);
    const low = create({ ...base, maxHp: '1', defense: '0' });
    expect(fight(low, [foe]).events.filter(event => event.kind === 'strike')).toHaveLength(1);
  });

  it('replaces periodic attacks with one coefficient-scaled strike before defense and critical damage', () => {
    for (const critChance of ['0', '1']) {
      const foe = enemy('periodic', { attack: '100', agility: '100', critChance, critMultiplier: '2' },
        { periodicStrike: { every: 3, coefficient: '2' } });
      const initial = fight(create(stats({ maxHp: '10000', attack: '0', defense: '50', agility: '0' })), [foe]).state;
      const result = advanceSimulation(initial, 6000);
      const strikes = result.events.filter(event => event.kind === 'strike').filter(event => event.side === 'enemy');
      expect(strikes).toHaveLength(6);
      strikes.forEach((strike, index) => {
        const heavy = (index + 1) % 3 === 0;
        const coefficient = (heavy ? 2 : 1) * (critChance === '1' ? 2 : 1);
        expect(strike.hit).toBe(true);
        expect(strike.critical).toBe(critChance === '1');
        expect(Number(strike.incomingPower)).toBeGreaterThanOrEqual(80 * coefficient);
        expect(Number(strike.incomingPower)).toBeLessThanOrEqual(120 * coefficient);
        expect(strike.damage).toBe(text(dec(strike.incomingPower).mul(heavy ? '.75' : '.5').mul(10).ceil().div(10)));
      });
      expect(result.state.battle!.enemies[0].nextRound).toBe(7);
    }
    for (const abilities of [
      { strikes: 2 as const }, { extraStrike: { coefficient: '2', damageMultiplier: '1' } },
      { rampingDamage: true }, { mirrorOpening: true }, { arrayStrikes: true },
    ]) {
      expect(() => fight(create(), [enemy('invalid', {}, {
        ...abilities, periodicStrike: { every: 3, coefficient: '2' },
      })])).toThrow('Periodic strikes cannot combine');
    }
  });

  it('keeps periodic counters independent through misses, sliced saves and paused time', () => {
    const foes = [
      enemy('misses', { attack: '100', agility: '0', attackSpeed: '2' },
        { periodicStrike: { every: 2, coefficient: '2' } }),
      enemy('slower', { attack: '100', agility: '100' },
        { periodicStrike: { every: 3, coefficient: '1.5' } }),
    ];
    const initial = fight(create(stats({ maxHp: '10000', attack: '0', agility: '100' })), foes).state;
    const partial = advanceSimulation(initial, 2000);
    expect(partial.state.battle!.enemies.map(entry => entry.nextRound)).toEqual([5, 3]);
    const misses = partial.events.filter(event => event.kind === 'strike' && event.side === 'enemy' && event.slot === 0);
    expect(misses).toHaveLength(4);
    expect(misses.every(event => event.kind === 'strike' && !event.hit)).toBe(true);
    const restored = readSimulation(JSON.parse(JSON.stringify(partial.state)));
    const continued = advanceSimulation(restored, 4500);
    const once = advanceSimulation(initial, 4500);
    expect(continued.state).toEqual(once.state);
    expect([...partial.events, ...continued.events]).toEqual(once.events);
    const gap = 100000;
    const paused = pauseSimulationUntil(restored, restored.clockMs + gap);
    expect(paused.battle!.enemies.map(entry => entry.nextRound)).toEqual([5, 3]);
    const resumed = advanceSimulation(paused, 4500 + gap);
    expect(resumed.state).toEqual(pauseSimulationUntil(continued.state, 4500 + gap));
    expect(resumed.events).toEqual(continued.events.map(event => ({ ...event, at: event.at + gap })));
    const invalid = structuredClone(restored);
    delete invalid.battle!.enemies[0].nextRound;
    expect(() => readSimulation(invalid)).toThrow('round checkpoint');
    expect(fight(withdraw(restored), foes).state.battle!.enemies.map(entry => entry.nextRound)).toEqual([1, 1]);
  });

  it('uses current health for attack and applies assisted sturdy caps before final damage factors', () => {
    const attacker = enemySchema.parse(enemy('drain', { attack: '100', agility: '0', critChance: '0' },
      { currentHpAttackDivisor: '200' }));
    const player = stats({ maxHp: '9999999', defense: '90', agility: '100' });
    expect(enemyStrike({ rng: 7 }, attacker, player, 1, '1', { hp: '479999' }).hit).toBe(false);
    expect(enemyStrike({ rng: 7 }, attacker, player, 1, '1', { hp: '480000' }).hit).toBe(true);
    const drained = enemyStrike({ rng: 7 }, attacker, { ...player, agility: '0' }, 1, '1', { hp: '20000' });
    const equivalent = enemyStrike({ rng: 7 }, { ...attacker, abilities: { ...attacker.abilities, currentHpAttackDivisor: undefined } },
      { ...player, agility: '0' }, 1, '2');
    expect(drained).toEqual(equivalent);
    const target = enemySchema.parse(enemy('shell', { agility: '0' }, { sturdy: true }));
    const hero = stats({ attack: '100', critChance: '1', critMultiplier: '2', attackMultiplier: '3' });
    const normal = playerStrike({ rng: 7 }, hero, target, 1);
    const assisted = playerStrike({ rng: 7 }, hero, target, 1, 4);
    expect(assisted.damage).toBe(text(dec(normal.damage).mul(4)));
    expect(Number(assisted.damage)).toBeGreaterThan(4);
  });

  it('separates five entry coefficients from amplified follow-up damage and settles between strikes', () => {
    const base = stats({ maxHp: '10000', defense: '90', agility: '0' });
    const foe = enemy('follow-up', { attack: '100', agility: '100', critChance: '0' }, {
      entryStrikes: 5, entryAttackCoefficient: '0.9',
      extraStrike: { coefficient: '1.5', damageMultiplier: '2' },
    });
    const entered = fight(create(base), [foe]);
    const entry = entered.events.filter(event => event.kind === 'strike');
    expect(entry).toHaveLength(5);
    expect(entry.map(event => event.damage)).toEqual(['0', '0', '0', '0', '0']);
    const normal = advanceSimulation(entered.state, 1000).events
      .filter(event => event.kind === 'strike').filter(event => event.side === 'enemy');
    expect(normal).toHaveLength(2);
    expect(Number(normal[0].incomingPower)).toBeGreaterThanOrEqual(80);
    expect(Number(normal[1].incomingPower)).toBeGreaterThanOrEqual(240);
    expect(Number(normal[1].incomingPower)).toBeLessThanOrEqual(360);
    expect(normal[1].damage).toBe(text(dec(normal[1].incomingPower).mul('0.4').mul(10).ceil().div(10)));
    const changed = advanceSimulation(entered.state, 1000, 100, {
      settle: (_state, event) => event.kind === 'strike' && event.side === 'enemy'
        ? { base: { ...base, defense: '1000' } } : undefined,
    });
    expect(changed.events.filter(event => event.kind === 'strike' && event.side === 'enemy').at(-1))
      .toMatchObject({ damage: '0' });
    const fragile = structuredClone(entered.state);
    fragile.player.hp = '1';
    const defeated = advanceSimulation(fragile, 1000);
    expect(defeated.events.filter(event => event.kind === 'strike' && event.side === 'enemy')).toHaveLength(1);
    expect(defeated.state.battle).toBeNull();
  });

  it('uses live agility deficits and coefficient multipliers in the guaranteed-hit threshold', () => {
    const target = enemySchema.parse(enemy('pursuit', { attack: '100', agility: '0', critChance: '0' }, {
      agilityDeficit: { threshold: '1000', scale: '5' },
    }));
    expect(enemyStrike({ rng: 7 }, target, stats({ agility: '521' }), 1).hit).toBe(false);
    expect(enemyStrike({ rng: 7 }, target, stats({ agility: '520' }), 1).hit).toBe(true);
    const plain = { ...target, abilities: { ...target.abilities, agilityDeficit: undefined } };
    expect(enemyStrike({ rng: 7 }, target, stats({ agility: '0', defense: '90' }), 1))
      .toEqual(enemyStrike({ rng: 7 }, plain, stats({ agility: '0', defense: '90' }), 1, '51'));
    for (const agility of ['1000', '1001']) {
      expect(enemyStrike({ rng: 7 }, target, stats({ agility }), 1))
        .toEqual(enemyStrike({ rng: 7 }, plain, stats({ agility }), 1));
    }
    const empowered = { ...plain, abilities: { ...plain.abilities, attackCoefficientMultiplier: '2' } };
    expect(enemyStrike({ rng: 7 }, empowered, stats({ agility: '1000' }), 1, '12.5').hit).toBe(true);
    expect(enemyStrike({ rng: 7 }, empowered, stats({ agility: '0', defense: '150' }), 1))
      .toEqual(enemyStrike({ rng: 7 }, plain, stats({ agility: '0', defense: '150' }), 1, '2'));
  });

  it('bounds defensive suppression and applies soft bones only to the current opponent', () => {
    const plain = enemySchema.parse(enemy('ward', { attack: '200', defense: '40', agility: '0', critChance: '0' }));
    const warded = { ...plain, abilities: { ...plain.abilities, defensiveFlash: true } };
    const player = stats({ attack: '100', defense: '80', agility: '100', critChance: '0' });
    const normal = playerStrike({ rng: 7 }, player, plain, 1);
    expect(playerStrike({ rng: 7 }, player, warded, 1).damage).toBe(text(dec(normal.damage).mul('0.75')));
    for (const defense of ['0', '1', '20']) {
      expect(playerStrike({ rng: 7 }, { ...player, defense }, warded, 1).damage).toBe('0');
    }
    const strong = { ...player, attack: '201' };
    expect(playerStrike({ rng: 7 }, strong, warded, 1)).toEqual(playerStrike({ rng: 7 }, strong, plain, 1));
    const equal = { ...player, attack: '200' };
    expect(playerStrike({ rng: 7 }, equal, warded, 1).damage)
      .toBe(text(dec(playerStrike({ rng: 7 }, equal, plain, 1).damage).mul('0.75')));
    const soft = { ...plain, abilities: { ...plain.abilities, softBones: true } };
    expect(playerStrike({ rng: 7 }, player, soft, 1))
      .toEqual(playerStrike({ rng: 7 }, { ...player, attack: '90' }, plain, 1));
    const defender = { ...player, agility: '0' };
    expect(enemyStrike({ rng: 7 }, soft, defender, 1))
      .toEqual(enemyStrike({ rng: 7 }, plain, { ...defender, defense: '90' }, 1));
    const piercing = { ...soft, abilities: { ...soft.abilities, ignoreDefense: true } };
    expect(enemyStrike({ rng: 7 }, piercing, defender, 1))
      .toEqual(enemyStrike({ rng: 7 }, { ...plain, abilities: { ...plain.abilities, ignoreDefense: true } }, defender, 1));
    expect(playerStrike({ rng: 7 }, { ...player, defense: '0' },
      { ...warded, stats: { ...warded.stats, defense: '0' } }, 1).damage)
      .toBe(playerStrike({ rng: 7 }, player, { ...plain, stats: { ...plain.stats, defense: '0' } }, 1).damage);
  });

  it('expires effects before healing, renews duration without intensity, and keeps distinct effects', () => {
    let state = fight(createSimulation({ clockMs: 0, seed: 5, hp: '1' })).state;
    const effect = { id: 'food', durationMs: 2000, source: { id: 'food', flat: { hpRegen: '10' } } };
    state = applyTimedEffect(state, effect).state;
    state = applyTimedEffect(state, effect).state;
    state = applyTimedEffect(state, {
      id: 'medicine', durationMs: 2000, source: { id: 'medicine', flat: { hpRegen: '5' } },
    }).state;
    expect(getPlayerStats(state).hpRegen).toBe('15');
    expect(state.effects.find((entry) => entry.id === 'food')?.expiresAt).toBe(4000);
    expect(advanceSimulation(state, 1000).state.player.hp).toBe('16');
    expect(advanceSimulation(state, 2000).state.player.hp).toBe('26');
    expect(advanceSimulation(state, 4000).state.player.hp).toBe('36');
  });

  it('makes negative regeneration lethal outside combat without removing the effect on defeat', () => {
    let state = applyTimedEffect(create(), {
      id: 'loss', durationMs: 10000, source: { id: 'loss', flat: { hpRegen: '-100' } },
    }).state;
    const result = advanceSimulation(state, 1000);
    expect(result.state.player.hp).toBe('0');
    expect(result.events.some((entry) => entry.kind === 'fainted')).toBe(true);
    expect(result.state.effects).toHaveLength(1);
    state = result.state;
    expect(() => fight(state)).toThrow();
    expect(rebaseHealth('0', '50', '100')).toBe('0');
    expect(rebaseHealth(rebaseHealth('40', '50', '20'), '20', '50')).toBe('40');
  });

  it('preserves attack progress when speed changes and rejects changes atomically', () => {
    let state = advanceSimulation(fight(create()).state, 500).state;
    const before = structuredClone(state);
    expect(() => updatePlayerStats(state, { sources: [{ id: 'bad', multiplier: { attackSpeed: '0' } }] })).toThrow();
    expect(state).toEqual(before);
    state = updatePlayerStats(state, { sources: [{ id: 'haste', multiplier: { attackSpeed: '2' } }] }).state;
    expect(state.player.nextActionAt).toBe(750);
    expect(advanceSimulation(state, 749).events).toEqual([]);
    expect(advanceSimulation(state, 750).events.some((entry) => entry.kind === 'strike' && entry.side === 'player')).toBe(true);
  });

  it('only clears a group after all enemies die, and withdrawal discards partial enemies but not progress', () => {
    const foes = [
      enemy('weak', { maxHp: '1', agility: '0' }),
      enemy('wall', { maxHp: '10', defense: '100000', agility: '0' }),
    ];
    let state = fight(create(stats({ attack: '100', critChance: '1' })), foes).state;
    const partial = advanceSimulation(state, 1000);
    expect(partial.events.filter((entry) => entry.kind === 'enemy-defeated')).toHaveLength(1);
    expect(partial.state.clearedGroups).toEqual({});
    state = withdraw(partial.state);
    state = fight(state, foes).state;
    expect(state.battle!.enemies[0].hp).toBe('1');
    state = withdraw(state);
    state = fight(state, [foes[0]]).state;
    const cleared = advanceSimulation(state, state.clockMs + 1000);
    expect(cleared.state.clearedGroups['test-region']).toBe('1');
    expect(advanceSimulation(cleared.state, cleared.state.clockMs + 1000).events.some((entry) => entry.kind === 'group-cleared')).toBe(false);
    expect(withdraw(cleared.state).clearedGroups['test-region']).toBe('1');
  });

  it('keeps recovery and effect lifetimes independent of world time', () => {
    const base = create();
    base.player.hp = '1';
    const effect = { id: 'duration', durationMs: 10000, source: { id: 'empty' } };
    const rest = advanceSimulation(applyTimedEffect(base, effect).state, 1000).state;
    const sleep = advanceSimulation(applyTimedEffect(setRecoveryMode(base, 'sleep'), effect).state, 1000).state;
    expect(Number(sleep.player.hp)).toBeGreaterThan(Number(rest.player.hp));
    expect(sleep.effects[0].expiresAt).toBe(rest.effects[0].expiresAt);
    const paused = pauseSimulationUntil(sleep, 100_000);
    expect(paused.effects[0].expiresAt - paused.clockMs).toBe(sleep.effects[0].expiresAt - sleep.clockMs);
    expect(paused.player.hp).toBe(sleep.player.hp);
    expect(paused.rng).toBe(sleep.rng);
  });

  it('rejects legacy snapshots instead of filling or migrating them', () => {
    expect(() => readSimulation({ schemaVersion: 14, player: { hp: '50', mp: '10' } })).toThrow();
    const state = create();
    expect(() => readSimulation({ ...state, kernelVersion: 'obsolete' })).toThrow();
    expect(() => readSimulation({ ...state, kernelVersion: 'neko-kernel-3', calendarMinutes: 0, environment: { restLevel: 0 } })).toThrow();
    expect(() => readSimulation({ ...state, rng: 0 })).toThrow();
    expect(() => readSimulation({ ...state, nextPulseAt: state.clockMs })).toThrow();
    const battle = fight(state).state;
    const broken = JSON.parse(JSON.stringify(battle));
    delete broken.battle.enemies[0].definition.abilities;
    expect(() => readSimulation(broken)).toThrow();
    const ramping = fight(state, [enemy('ramping', {}, { rampingDamage: true })]).state;
    const missingRound = structuredClone(ramping);
    delete missingRound.battle!.enemies[0].nextRound;
    expect(() => readSimulation(missingRound)).toThrow();
    for (const nextRound of [0, -1, .5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = structuredClone(ramping);
      invalid.battle!.enemies[0].nextRound = nextRound;
      expect(() => readSimulation(invalid)).toThrow();
    }
    battle.battle!.enemies[0].nextRound = 1;
    expect(() => readSimulation(battle)).toThrow();
  });
});
