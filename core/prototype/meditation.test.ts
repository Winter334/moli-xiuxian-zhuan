import { describe, expect, it } from 'vitest';
import {
  advanceCharacter, createCharacter, executeCharacterCommand, getCharacterView, readCharacter, type CharacterCommand,
} from './index';
import { SAFE_LOCATIONS } from './content';
import { executeDebugCommand } from './debug';
import { MINING_SITE_IDS, MINING_SITES } from './gathering';

describe('safe-location meditation', () => {
  it('recovers and trains rest without cultivation at an allowed location', () => {
    const initial = createCharacter(0, 19);
    initial.simulation.player.hp = '1';
    const meditating = executeCharacterCommand(initial, { type: 'recover', mode: 'sleep' });
    const recovered = advanceCharacter(meditating, 2000);
    expect(recovered.locationId).toBe(initial.locationId);
    expect(recovered.simulation.mode).toBe('sleep');
    expect(recovered.simulation.battle).toBeNull();
    expect(Number(recovered.simulation.player.hp)).toBeGreaterThan(Number(initial.simulation.player.hp));
    expect(Number(recovered.skills.rest.xp)).toBeGreaterThan(Number(initial.skills.rest.xp));
    expect(recovered.cultivation).toBe(initial.cultivation);
    expect(recovered.inventory).toEqual(initial.inventory);
    expect(recovered.simulation.rng).toBe(initial.simulation.rng);
    const stopped = executeCharacterCommand(recovered, { type: 'recover', mode: 'rest' });
    expect(stopped.locationId).toBe(initial.locationId);
    expect(stopped.simulation.mode).toBe('rest');
    expect(stopped.simulation.battle).toBeNull();
    const regionId = getCharacterView(recovered).regions.find(region => region.enterable)!.id;
    expect(executeCharacterCommand(recovered, { type: 'enter', regionId })).toEqual(
      executeCharacterCommand(stopped, { type: 'enter', regionId }),
    );
  });

  it('rejects meditation during combat without altering the encounter and permits it after withdrawal', () => {
    const initial = createCharacter(0, 19);
    const regionId = getCharacterView(initial).regions.find(region => region.enterable && region.groupsPerClear > 1)!.id;
    const fighting = executeCharacterCommand(initial, { type: 'enter', regionId });
    fighting.simulation.clearedGroups[regionId] = '1';
    fighting.simulation.player.hp = '1';
    fighting.simulation.battle!.enemies[0].hp = '1';
    const before = structuredClone(fighting);
    expect(getCharacterView(fighting).canMeditate).toBe(false);
    expect(() => executeCharacterCommand(fighting, { type: 'recover', mode: 'sleep' })).toThrow('请先撤退');
    expect(fighting).toEqual(before);
    expect(() => readCharacter({
      ...fighting,
      simulation: {
        ...fighting.simulation, mode: 'sleep', battle: null,
        player: { ...fighting.simulation.player, nextActionAt: null },
      },
    })).toThrow('Invalid active region');
    const returned = executeCharacterCommand(fighting, { type: 'withdraw' });
    const meditating = executeCharacterCommand(returned, { type: 'recover', mode: 'sleep' });
    const restored = readCharacter(JSON.parse(JSON.stringify(meditating)));
    const recovered = advanceCharacter(restored, 2000);
    expect(recovered.locationId).toBe(initial.locationId);
    expect(recovered.simulation.mode).toBe('sleep');
    expect(recovered.simulation.battle).toBeNull();
    expect(recovered.simulation.clearedGroups).toEqual(fighting.simulation.clearedGroups);
    expect(recovered.cultivation).toBe(fighting.cultivation);
    const resumed = executeCharacterCommand(recovered, { type: 'enter', regionId });
    expect(resumed.simulation.mode).toBe('combat');
    expect(resumed.simulation.battle!.enemies.every(enemy => enemy.hp === enemy.definition.stats.maxHp)).toBe(true);
  });

  it('starts available mining directly from meditation and stops earning meditation experience', () => {
    const siteId = MINING_SITE_IDS.find(id => SAFE_LOCATIONS[MINING_SITES[id].location]?.meditation)!;
    const state = executeDebugCommand(createCharacter(0, 19), {
      type: 'travel', locationId: MINING_SITES[siteId].location,
    });
    const meditating = executeCharacterCommand(state, { type: 'recover', mode: 'sleep' });
    const before = structuredClone(meditating);
    expect(getCharacterView(meditating).miningSites.find(site => site.id === siteId)!.available).toBe(true);
    expect(meditating).toEqual(before);
    const command: CharacterCommand = { type: 'gather', siteId };
    const mining = executeCharacterCommand(meditating, command);
    const stopped = executeCharacterCommand(meditating, { type: 'recover', mode: 'rest' });
    expect(mining).toEqual(executeCharacterCommand(stopped, command));
    expect(mining.simulation.mode).toBe('rest');
    expect(mining.gathering?.siteId).toBe(siteId);
    expect(advanceCharacter(mining, 1000).skills.rest).toEqual(meditating.skills.rest);
    expect(meditating).toEqual(before);
  });

  it('preserves meditation when an action is rejected or an inactive activity is stopped', () => {
    const meditating = executeCharacterCommand(createCharacter(0, 19), { type: 'recover', mode: 'sleep' });
    const before = structuredClone(meditating);
    const commands: CharacterCommand[] = [
      { type: 'craft', recipeId: 'smelt-iron', quantity: 1 },
      { type: 'upgrade-furnace', tier: meditating.furnaceTier },
      { type: 'assemble', bladeId: 'missing', hiltId: 'missing' },
      { type: 'assemble-armor', interiorId: 'missing', exteriorId: 'missing' },
      { type: 'gather', siteId: MINING_SITE_IDS[0] },
      { type: 'train', skillId: 'footwork' },
    ];
    for (const command of commands) {
      expect(() => executeCharacterCommand(meditating, command)).toThrow();
      expect(meditating).toEqual(before);
    }
    expect(executeCharacterCommand(meditating, { type: 'train', skillId: null })).toEqual(before);
    expect(executeCharacterCommand(meditating, { type: 'gather', siteId: null })).toEqual(before);
  });
});
