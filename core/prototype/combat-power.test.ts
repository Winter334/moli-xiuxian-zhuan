import { describe, expect, it } from 'vitest';
import { dec } from '../numbers';
import { addInstance, createCharacter, synchronizeCharacter } from './character-state';
import { combatPower } from './combat-power';
import { FOOD_EFFECTS, ITEMS, MANOR_AID } from './content';
import { getPlayerStats, applyTimedEffect } from './simulation';

describe('normal combat power', () => {
  it('ignores temporary effects, health, rest and stage aid while retaining equipment costs', () => {
    const state = createCharacter(0, 19);
    const normal = combatPower(state);
    state.simulation.player.hp = '1';
    state.simulation.mode = 'sleep';
    const [id, effect] = Object.entries(FOOD_EFFECTS).find(([, effect]) => effect.source.flat?.attack)!;
    state.simulation = applyTimedEffect(state.simulation, { id, ...effect }).state;
    state.equipment.special = addInstance(state, state.instances, MANOR_AID.itemId, 100);
    synchronizeCharacter(state);
    expect(dec(getPlayerStats(state.simulation).attack).gt(1)).toBe(true);
    expect(combatPower(state)).toBe(normal);

    const [itemId, item] = Object.entries(ITEMS).find(([, item]) =>
      item.slot === 'accessory' && dec(item.fixedStats?.flat?.hpRegenPercent ?? 0).lt(0))!;
    state.marrow.maxHp = '1000000';
    state.equipment.accessory = addInstance(state, state.instances, itemId, 100);
    const withCost = combatPower(state);
    // Remove the upkeep only in a temporary content fixture; the score must rise.
    const rate = item.fixedStats!.flat!.hpRegenPercent!;
    try {
      item.fixedStats!.flat!.hpRegenPercent = '0';
      expect(dec(combatPower(state)).gt(withCost)).toBe(true);
    } finally { item.fixedStats!.flat!.hpRegenPercent = rate; }
    delete state.instances[state.equipment.accessory];
    state.equipment.accessory = null;
    expect(dec(combatPower(state)).gt(normal)).toBe(true);
  });
});
