import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, RuleError, type GameCommand, type GameState } from './index';
import { quantity } from './numbers';

describe('rule error boundary', () => {
  it('exports a distinguishable Error subclass with the original message', () => {
    const error = new RuleError('rejected');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RuleError);
    expect(error.name).toBe('RuleError');
    expect(error.message).toBe('rejected');
  });

  it('classifies business refusals without mutating input', () => {
    const commands: GameCommand[] = [
      { type: 'buy', itemId: 'herb', quantity: 100 },
      { type: 'sell', itemId: 'herb', quantity: 100 },
      { type: 'consume', itemId: 'healing-pill', quantity: 100 },
      { type: 'craft', recipeId: 'healing', quantity: 10 },
      { type: 'activity', kind: 'dungeon', targetId: 'quarry' },
      { type: 'technique', techniqueId: 'flame' },
      { type: 'equip', slot: 'weapon', instanceId: 'not-owned' },
      { type: 'breakthrough', lifeId: '1', methodId: 'human' },
    ];
    const state = createGame(0);
    const before = structuredClone(state);
    for (const command of commands) expect(() => applyCommand(state, command)).toThrow(RuleError);
    expect(state).toEqual(before);

    state.player.hp = '0';
    expect(() => applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' })).toThrow(RuleError);
    state.level = 12;
    state.cultivation = '17000';
    expect(() => applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' })).toThrow(RuleError);
  });

  it('classifies out-of-combat requirements as business refusals', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const commands: GameCommand[] = [
      { type: 'equip', slot: 'weapon', instanceId: null },
      { type: 'technique', techniqueId: 'breathing' },
      { type: 'craft', recipeId: 'healing', quantity: 1 },
      { type: 'consume', itemId: 'healing-pill', quantity: 1 },
      { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' },
    ];
    for (const command of commands) expect(() => applyCommand(state, command)).toThrow(RuleError);
  });

  it('classifies malformed commands and quantities as RuleError', () => {
    const commands: unknown[] = [
      null, undefined, false, 'buy', [], {}, { type: 'unknown' },
      { type: 'activity', kind: 'unknown' },
      { type: 'activity', kind: 'dungeon', targetId: 'unknown' },
      { type: 'activity', kind: 'practice', targetId: 'unknown' },
      { type: 'technique', techniqueId: 'unknown' },
      { type: 'supply', enabled: true, hpThreshold: 2 },
      { type: 'buy', itemId: 'unknown', quantity: 1 },
      { type: 'sell', itemId: 'unknown', quantity: 1 },
      { type: 'consume', itemId: 'herb', quantity: 1 },
      { type: 'craft', recipeId: 'unknown', quantity: 1 },
    ];
    for (const command of commands) {
      expect(() => applyCommand(createGame(0), command as GameCommand)).toThrow(RuleError);
    }
    for (const count of [0, -1, 1.5, 10001, NaN, Infinity]) {
      expect(() => quantity(count)).toThrow(RuleError);
      expect(() => applyCommand(createGame(0), { type: 'buy', itemId: 'herb', quantity: count })).toThrow(RuleError);
    }
  });

  it('keeps assertState failures as ordinary errors, even when the command is invalid', () => {
    const invalid: Partial<GameState>[] = [
      { schemaVersion: 0 }, { contentVersion: 'old' }, { rulesVersion: 'old' },
      { clockMs: 1 }, { clockMs: NaN }, { level: 14 }, { rng: 0 },
    ];
    for (const change of invalid) {
      const state = { ...createGame(0), ...change };
      const act = () => applyCommand(state, { type: 'unknown' } as never);
      expect(act).toThrow(Error);
      expect(act).not.toThrow(RuleError);
    }
  });

  it('does not wrap corrupted internal references or asset parsing failures', () => {
    const state = createGame(0);
    state.equipment[0].definitionId = 'missing-internal-definition';
    const equip = () => applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: state.loadout.weapon });
    expect(equip).toThrow(Error);
    expect(equip).not.toThrow(RuleError);

    const corruptAssets = createGame(0);
    corruptAssets.stones = 'not-an-integer';
    const buy = () => applyCommand(corruptAssets, { type: 'buy', itemId: 'herb', quantity: 1 });
    expect(buy).toThrow(Error);
    expect(buy).not.toThrow(RuleError);
  });
});
