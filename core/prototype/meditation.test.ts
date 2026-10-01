import { describe, expect, it } from 'vitest';
import {
  advanceCharacter, createCharacter, executeCharacterCommand, getCharacterView, readCharacter,
} from './index';

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
});
