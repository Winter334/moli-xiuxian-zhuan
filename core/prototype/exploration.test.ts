import { afterEach, describe, expect, it, vi } from 'vitest';
import { dec, text } from '../numbers';
import { readClientSave } from '../../shared/client-save';
import * as combat from './combat';
import { advanceCharacter, executeCharacterCommand, getCharacterView } from './character';
import { createCharacter, isUnlocked, readCharacter, synchronizeCharacter, type CharacterState } from './character-state';
import { FOOD_EFFECTS, ITEMS, REGIONS, SAFE_LOCATIONS } from './content';
import { executeDebugCommand } from './debug';
import { MINING_SITE_IDS, MINING_SITES } from './gathering';
import { MANUALS, TRAINING_IDS, TRAININGS } from './skills';
import { applyTimedEffect, getPlayerStats } from './simulation';

const initial = () => createCharacter(0, 19);
const regionId = getCharacterView(initial()).regions.find(region => region.enterable && !region.challenge)!.id;
const arrive = (state = initial()) => executeCharacterCommand(state, { type: 'arrive', regionId });
const homeId = initial().locationId;
const remoteSafeId = Object.keys(SAFE_LOCATIONS).find(id => SAFE_LOCATIONS[id].prerequisite !== null &&
  Object.values(REGIONS).some(region => region.parent === id))!;

// Control strike outcomes, not encounter content or rewards: these tests cover the activity lifecycle.
function finishGroup(input: CharacterState) {
  let state = readCharacter(input);
  const enemies = state.simulation.battle!.enemies.filter(enemy => dec(enemy.hp).gt(0)).length;
  for (let i = 0; i < enemies; i++) {
    const at = state.simulation.clockMs + 1;
    state.simulation.player.nextActionAt = at;
    state = advanceCharacter(state, at);
  }
  return state;
}

afterEach(() => vi.restoreAllMocks());

describe('region exploration lifecycle', () => {
  it('separates arrival from exploration, suppresses rest recovery and retains local preparation', () => {
    const before = initial();
    before.simulation.player.hp = '1';
    const meditating = executeCharacterCommand(before, { type: 'recover', mode: 'sleep' });
    let idle = arrive(meditating);
    expect(idle.locationId).toBe(regionId);
    expect(idle.simulation).toEqual({ ...before.simulation, mode: 'idle' });
    const advanced = advanceCharacter(idle, 1000);
    expect(advanced.simulation.mode).toBe('idle');
    expect(advanced.simulation.player.hp).toBe('1');
    expect(advanced.simulation.battle).toBeNull();
    expect(advanced.simulation.rng).toBe(idle.simulation.rng);
    expect(advanced.simulation.clearedGroups).toEqual(idle.simulation.clearedGroups);
    expect(advanced.cultivation).toBe(idle.cultivation);
    for (const mode of ['rest', 'sleep'] as const) {
      expect(() => executeCharacterCommand(idle, { type: 'recover', mode })).toThrow('战区不能歇息或调息');
    }
    synchronizeCharacter(idle);
    expect(idle.locationId).toBe(regionId);
    expect(getCharacterView(idle)).toMatchObject({ canMeditate: false, workshop: { available: true } });
    const upgrade = getCharacterView(idle).workshop.upgrade!;
    for (const cost of upgrade.materialCosts) idle.inventory[cost.itemId] = String(cost.required);
    idle = executeCharacterCommand(idle, { type: 'upgrade-furnace', tier: upgrade.tier });
    expect(idle.furnaceTier).toBe(upgrade.tier);
    expect(idle.locationId).toBe(regionId);
    expect(idle.simulation.mode).toBe('idle');

    const foodId = Object.keys(ITEMS).find(id => ITEMS[id].kind === 'food' &&
      ITEMS[id].foodEffects!.some(effect => dec(FOOD_EFFECTS[effect].source.flat?.hpRegen ?? 0).gt(0)))!;
    idle.inventory[foodId] = '1';
    idle = executeCharacterCommand(idle, { type: 'use', itemId: foodId, quantity: 1 });
    const stats = getPlayerStats(idle.simulation);
    const expected = dec(idle.simulation.player.hp).plus(stats.hpRegen).plus(dec(stats.hpRegenPercent).mul(stats.maxHp));
    expect(advanceCharacter(idle, 1000).simulation.player.hp).toBe(text(expected.greaterThan(stats.maxHp) ? dec(stats.maxHp) : expected));

    const fighting = executeCharacterCommand(arrive(before), { type: 'explore' });
    expect(fighting).toEqual(executeCharacterCommand(before, { type: 'enter', regionId }));
    expect(fighting.simulation.mode).toBe('combat');
    const returned = executeCharacterCommand(arrive(before), { type: 'travel', locationId: REGIONS[regionId].parent });
    expect(returned.simulation.player.hp).toBe(before.simulation.player.hp);
    expect(Number(advanceCharacter(returned, 1000).simulation.player.hp)).toBeGreaterThan(1);
  });

  it('continues between groups, stops on first clear and completed challenges, and repeats ordinary exploration', () => {
    vi.spyOn(combat, 'playerStrike').mockImplementation((_rng, _player, enemy) => ({
      hit: true, critical: false, damage: enemy.stats.maxHp, incomingPower: '1',
    }));
    const first = executeCharacterCommand(initial(), { type: 'enter', regionId });
    const continued = finishGroup(first);
    expect(continued.locationId).toBe(regionId);
    expect(continued.simulation.mode).toBe('combat');
    expect(continued.simulation.battle).not.toBeNull();
    expect(continued.simulation.clearedGroups[regionId]).toBe('1');
    const killed = first.simulation.battle!.enemies[0].definition.id;
    expect(continued.history.kills[killed]).toBe('1');

    const last = readCharacter(first);
    last.simulation.clearedGroups[regionId] = String(REGIONS[regionId].groups - 1);
    const cleared = finishGroup(last);
    expect(cleared.locationId).toBe(regionId);
    expect(cleared.simulation.mode).toBe('idle');
    expect(cleared.simulation.battle).toBeNull();
    expect(cleared.history.firstClears[regionId]).toEqual({
      at: cleared.simulation.clockMs, level: continued.level, life: continued.life.number,
    });
    const stationary = advanceCharacter(cleared, 2000);
    expect(stationary.simulation.clearedGroups).toEqual(cleared.simulation.clearedGroups);
    expect(stationary.simulation.rng).toBe(cleared.simulation.rng);
    expect(stationary.cultivation).toBe(cleared.cultivation);
    expect(stationary.inventory).toEqual(cleared.inventory);

    const repeat = executeCharacterCommand(stationary, { type: 'explore' });
    repeat.simulation.clearedGroups[regionId] = String(REGIONS[regionId].groups * 2 - 1);
    const repeating = finishGroup(repeat);
    expect(repeating.locationId).toBe(regionId);
    expect(repeating.simulation.mode).toBe('combat');
    expect(repeating.simulation.clearedGroups[regionId]).toBe(String(REGIONS[regionId].groups * 2));

    const challengeId = Object.keys(REGIONS).find(id => REGIONS[id].challenge)!;
    const prepared = executeDebugCommand(initial(), { type: 'region', regionId: challengeId, operation: 'open' });
    const challenge = executeCharacterCommand(prepared, { type: 'enter', regionId: challengeId });
    challenge.simulation.clearedGroups[challengeId] = String(REGIONS[challengeId].groups - 1);
    const won = finishGroup(challenge);
    expect(won.locationId).toBe(challengeId);
    expect(won.simulation.mode).toBe('idle');
    expect(() => executeCharacterCommand(won, { type: 'explore' })).toThrow('挑战已完成');
    const back = executeCharacterCommand(won, { type: 'travel', locationId: REGIONS[challengeId].parent });
    const revisited = executeCharacterCommand(back, { type: 'arrive', regionId: challengeId });
    expect(revisited.inventory).toEqual(won.inventory);
    expect(revisited.simulation.clearedGroups).toEqual(won.simulation.clearedGroups);
    expect(revisited.simulation.battle).toBeNull();
    expect(getCharacterView(revisited).regions.find(region => region.id === challengeId)?.explorable).toBe(false);
  });

  it('requires withdrawal before moving and returns defeats to the designated safety without healing', () => {
    const away = executeDebugCommand(initial(), { type: 'travel', locationId: remoteSafeId });
    const fighting = executeCharacterCommand(away, { type: 'enter', regionId });
    expect(away.locationId).not.toBe(REGIONS[regionId].parent);
    fighting.simulation.clearedGroups[regionId] = String(BigInt(fighting.simulation.clearedGroups[regionId] ?? '0') + 1n);
    fighting.simulation.player.hp = '1';
    const before = structuredClone(fighting);
    expect(() => executeCharacterCommand(fighting, { type: 'travel', locationId: REGIONS[regionId].parent })).toThrow();
    expect(() => executeCharacterCommand(fighting, { type: 'arrive', regionId })).toThrow();
    expect(() => executeCharacterCommand(fighting, { type: 'explore' })).toThrow();
    expect(fighting).toEqual(before);
    const withdrawn = executeCharacterCommand(fighting, { type: 'withdraw' });
    expect(withdrawn.locationId).toBe(REGIONS[regionId].parent);
    expect(withdrawn.simulation.mode).toBe('rest');
    expect(withdrawn.simulation.player.hp).toBe('1');
    expect(withdrawn.simulation.clearedGroups).toEqual(fighting.simulation.clearedGroups);
    expect(withdrawn.inventory).toEqual(fighting.inventory);
    expect(withdrawn.history.withdrawals).toBe('1');
    expect(withdrawn.history.defeats).toBe('0');

    vi.spyOn(combat, 'enemyStrike').mockImplementation((_rng, _enemy, player) => ({
      hit: true, critical: false, damage: player.maxHp, incomingPower: '1',
    }));
    fighting.simulation.battle!.enemies[0].nextActionAt = 1;
    const defeated = advanceCharacter(fighting, 1);
    expect(defeated.locationId).toBe(REGIONS[regionId].parent);
    expect(defeated.simulation.mode).toBe('rest');
    expect(defeated.simulation.player.hp).toBe('0');
    expect(defeated.simulation.battle).toBeNull();
    expect(defeated.history.defeats).toBe('1');
    expect(defeated.history.withdrawals).toBe('0');

    const idle = arrive();
    idle.simulation.player.hp = '0.00001';
    const effectId = Object.keys(FOOD_EFFECTS).find(id => dec(FOOD_EFFECTS[id].source.flat?.hpRegenPercent ?? 0).lt(0))!;
    idle.simulation = applyTimedEffect(idle.simulation, { id: effectId, ...FOOD_EFFECTS[effectId] }).state;
    const fainted = advanceCharacter(idle, 1000);
    expect(fainted.locationId).toBe(REGIONS[regionId].parent);
    expect(fainted.simulation.player.hp).toBe('0');
    expect(fainted.simulation.mode).toBe('rest');
  });

  it('round-trips idle saves and rejects recovery modes in regions and incompatible kernels', () => {
    const idle = arrive();
    const save = { format: 'opening-client-2', tradeRevision: '0', character: idle, playedMs: 0 };
    expect(readClientSave(JSON.parse(JSON.stringify(save))).character).toEqual(idle);
    for (const mode of ['rest', 'sleep']) {
      expect(() => readCharacter({ ...idle, simulation: { ...idle.simulation, mode } })).toThrow('Invalid active region');
    }
    expect(() => readCharacter({ ...initial(), simulation: idle.simulation })).toThrow('Idle outside a region');
    expect(() => readCharacter({
      ...idle, simulation: { ...idle.simulation, kernelVersion: 'neko-kernel-2' },
    })).toThrow();
    const zero = readCharacter(idle);
    zero.simulation.player.hp = '0';
    expect(() => executeCharacterCommand(zero, { type: 'explore' })).toThrow('请先恢复气血');
    expect(zero.simulation.mode).toBe('idle');
  });
});

describe('unlocked map travel', () => {
  it('omits locked nodes, rejects direct commands to them and reveals nodes on unlock', () => {
    const state = initial();
    const before = structuredClone(state);
    const view = getCharacterView(state);
    expect(view.regions.map(region => region.id)).toEqual(Object.keys(REGIONS).filter(id => isUnlocked(state, id)));
    expect(view.destinations.map(location => location.id)).toEqual(Object.keys(SAFE_LOCATIONS).filter(id => isUnlocked(state, id)));
    const nextId = Object.keys(REGIONS).find(id => REGIONS[id].prerequisite === regionId)!;
    expect(view.regions.some(region => region.id === nextId)).toBe(false);
    expect(view.destinations.some(location => location.id === remoteSafeId)).toBe(false);
    for (const type of ['arrive', 'enter'] as const) {
      expect(() => executeCharacterCommand(state, { type, regionId: nextId })).toThrow('尚不可');
    }
    expect(() => executeCharacterCommand(state, { type: 'travel', locationId: remoteSafeId })).toThrow('尚不可');
    for (const manual of view.manuals) {
      const definition = MANUALS[manual.id];
      if (!isUnlocked(state, definition.location)) expect(manual.locationName).toBeNull();
      if (!isUnlocked(state, definition.prerequisite)) expect(manual.prerequisiteName).toBeNull();
    }
    expect(state).toEqual(before);

    const opened = executeDebugCommand(state, { type: 'region', regionId, operation: 'complete' });
    expect(getCharacterView(opened).regions.find(region => region.id === nextId)?.arrivable).toBe(true);
    expect(executeCharacterCommand(opened, { type: 'arrive', regionId: nextId }).locationId).toBe(nextId);
  });

  it('travels across unlocked nodes and keeps the same visible map with movement disabled during combat', () => {
    const opened = executeDebugCommand(initial(), { type: 'travel', locationId: remoteSafeId });
    const atHome = executeCharacterCommand(opened, { type: 'travel', locationId: homeId });
    const remoteRegionId = getCharacterView(atHome).regions.find(region => region.parent === remoteSafeId)!.id;
    const view = getCharacterView(atHome);
    expect(view.destinations.find(location => location.id === remoteSafeId)?.travelable).toBe(true);
    expect(view.regions.find(region => region.id === remoteRegionId)).toMatchObject({ arrivable: true, enterable: true });
    expect(executeCharacterCommand(atHome, { type: 'travel', locationId: remoteSafeId }).locationId).toBe(remoteSafeId);

    const arrived = executeCharacterCommand(atHome, { type: 'arrive', regionId: remoteRegionId });
    expect(arrived.simulation).toEqual({ ...atHome.simulation, mode: 'idle' });
    expect(executeCharacterCommand(arrived, { type: 'travel', locationId: homeId }).locationId).toBe(homeId);
    expect(arrive(arrived).locationId).toBe(regionId);
    const fighting = executeCharacterCommand(atHome, { type: 'enter', regionId: remoteRegionId });
    expect(fighting).toEqual(executeCharacterCommand(arrived, { type: 'explore' }));
    const before = structuredClone(fighting);
    const battleView = getCharacterView(fighting);
    expect(battleView.regions.map(region => region.id)).toEqual(view.regions.map(region => region.id));
    expect(battleView.destinations.map(location => location.id)).toEqual(view.destinations.map(location => location.id));
    expect(battleView.destinations.every(location => !location.travelable)).toBe(true);
    expect(battleView.regions.every(region => !region.arrivable && !region.enterable && !region.explorable)).toBe(true);
    expect(() => executeCharacterCommand(fighting, { type: 'travel', locationId: homeId })).toThrow('先撤退');
    for (const type of ['arrive', 'enter'] as const) {
      expect(() => executeCharacterCommand(fighting, { type, regionId })).toThrow('先撤退');
    }
    expect(fighting).toEqual(before);
    const withdrawn = executeCharacterCommand(fighting, { type: 'withdraw' });
    expect(withdrawn.locationId).toBe(REGIONS[remoteRegionId].parent);
    expect(withdrawn.simulation.player.hp).toBe(fighting.simulation.player.hp);
    expect(withdrawn.inventory).toEqual(fighting.inventory);
  });

  it('preserves noncombat activities while browsing or staying put and ends them only on actual travel', () => {
    const trainingId = TRAINING_IDS[0];
    const siteId = MINING_SITE_IDS[0];
    const states = [
      executeCharacterCommand(initial(), { type: 'recover', mode: 'sleep' }),
      executeCharacterCommand(executeDebugCommand(initial(), {
        type: 'travel', locationId: TRAININGS[trainingId].location,
      }), { type: 'train', skillId: trainingId }),
      executeCharacterCommand(executeDebugCommand(initial(), {
        type: 'travel', locationId: MINING_SITES[siteId].location,
      }), { type: 'gather', siteId }),
    ];
    for (const state of states) {
      state.simulation.player.hp = '1';
      const before = structuredClone(state);
      getCharacterView(state);
      expect(state).toEqual(before);
      expect(executeCharacterCommand(state, { type: 'travel', locationId: state.locationId })).toEqual(before);
      const lockedId = Object.keys(REGIONS).find(id => !isUnlocked(state, id))!;
      expect(() => executeCharacterCommand(state, { type: 'arrive', regionId: lockedId })).toThrow();
      expect(state).toEqual(before);
      const safeId = getCharacterView(state).destinations.find(location => location.travelable)!.id;
      const moved = executeCharacterCommand(state, { type: 'travel', locationId: safeId });
      const idle = arrive(state);
      const fighting = executeCharacterCommand(state, { type: 'enter', regionId });
      expect(moved.simulation.mode).toBe('rest');
      expect(idle.simulation.mode).toBe('idle');
      expect(fighting.simulation.mode).toBe('combat');
      for (const result of [moved, idle, fighting]) {
        expect(result.training).toBeUndefined();
        expect(result.gathering).toBeUndefined();
        expect(result.simulation.player.hp).toBe('1');
      }
    }
  });
});
