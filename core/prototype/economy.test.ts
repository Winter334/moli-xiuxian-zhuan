import { describe, expect, it } from 'vitest';
import { executeCharacterCommand, type CharacterCommand } from './character';
import { addInstance, createCharacter } from './character-state';
import { ITEMS } from './content';

function inventory() {
  const state = createCharacter(0, 19);
  const equipmentId = Object.keys(ITEMS).find(id => ITEMS[id].slot === 'body')!;
  const partId = Object.keys(ITEMS).find(id => ITEMS[id].kind === 'part')!;
  const first = addInstance(state, state.instances, equipmentId, 100);
  const second = addInstance(state, state.instances, partId, 180);
  return { state, first, second };
}

describe('atomic instance sales', () => {
  it('matches individual sales including exact prices, shop ownership and history', () => {
    const { state, first, second } = inventory();
    const before = structuredClone(state);
    const batch = executeCharacterCommand(state, {
      type: 'sell-instances', shopId: 'village-stall', instanceIds: [first, second],
    }, 0);
    let individual = state;
    for (const instanceId of [first, second]) individual = executeCharacterCommand(individual, {
      type: 'sell', shopId: 'village-stall', target: { kind: 'instance', instanceId }, quantity: 1,
    }, 0);
    expect(batch).toEqual(individual);
    expect(state).toEqual(before);
  });

  it('rejects the whole sale for duplicate, missing or equipped instances', () => {
    const { state: initial, first, second } = inventory();
    const state = executeCharacterCommand(initial, { type: 'equip', instanceId: first }, 0);
    const before = structuredClone(state);
    for (const [instanceIds, issue] of [
      [[second, second], '不能重复选择同一件器物'],
      [[second, 'item-999999'], '所选器物已不在行囊中'],
      [[second, first], '请先卸下所选装备'],
    ] as [string[], string][]) {
      expect(() => executeCharacterCommand(state, {
        type: 'sell-instances', shopId: 'village-stall', instanceIds,
      }, 0)).toThrow(issue);
      expect(state).toEqual(before);
    }
  });

  it('keeps shop location and batch size restrictions', () => {
    const { state, first } = inventory();
    const before = structuredClone(state);
    const commands: CharacterCommand[] = [
      { type: 'sell-instances', shopId: 'market-supplies', instanceIds: [first] },
      { type: 'sell-instances', shopId: 'village-stall', instanceIds: [] },
      { type: 'sell-instances', shopId: 'village-stall', instanceIds: Array(1001).fill(first) },
    ];
    for (const command of commands) {
      expect(() => executeCharacterCommand(state, command, 0)).toThrow();
      expect(state).toEqual(before);
    }
  });
});
