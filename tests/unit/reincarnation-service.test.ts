import { describe, expect, it } from 'vitest';
import { advanceGame, applyCommand, content, createGame, getGameView } from '../../core/index';
import type { GameState } from '../../core/types';
import { GameService } from '../../server/game-service';
import type { CommandReceipt, GameRepository, StoredResponse } from '../../server/repository';

function enter(state: GameState) {
  const candidates = [...state.opening!.candidates];
  let next = state;
  for (let slot = 0; slot < state.opening!.selected.length; slot++) {
    next = applyCommand(next, { type: 'fate-select', lifeId: state.lifeId, slot, fateId: candidates[slot] });
  }
  return applyCommand(next, { type: 'enter-life', lifeId: next.lifeId });
}

function nearThreshold() {
  let state = enter(createGame(0, 1));
  state.level = 12;
  state.cultivation = content.realms[12].required;
  state.inventory[content.settings.breakthroughItemId] = content.settings.breakthroughQuantity;
  state.rng = 1;
  state = applyCommand(state, { type: 'breakthrough', methodId: 'human', lifeId: state.lifeId });
  state = enter(applyCommand(state, { type: 'reincarnate', lifeId: state.lifeId }));
  state.level = content.reincarnation.minimumLevel - 1;
  state.cultivation = String(Number(content.realms[state.level].required) - 0.1);
  return applyCommand(state, { type: 'activity', kind: 'meditate' });
}

function memoryRepository(initial: GameState) {
  let state = structuredClone(initial);
  let revision = '1';
  const receipts = new Map<string, CommandReceipt>();
  const repository = {
    async load() { return { state: structuredClone(state), revision }; },
    async findReceipt(_characterId: string, requestId: string, hash: string): Promise<StoredResponse | null> {
      const receipt = receipts.get(requestId);
      if (receipt && receipt.payloadHash !== hash) throw new Error('Receipt payload mismatch');
      return receipt ? structuredClone(receipt) : null;
    },
    async commit(_characterId: string, expected: string, next: GameState | null, receipt?: CommandReceipt) {
      const replay = receipt && receipts.get(receipt.requestId);
      if (replay) return { committed: false, replay: structuredClone(replay) };
      if (expected !== revision) return { committed: false };
      if (next) {
        state = structuredClone(next);
        revision = (BigInt(revision) + 1n).toString();
      }
      if (receipt) receipts.set(receipt.requestId, structuredClone(receipt));
      return { committed: true };
    },
  };
  return {
    repository: repository as unknown as GameRepository,
    snapshot: () => ({ state: structuredClone(state), revision, receipts: receipts.size }),
  };
}

describe('reincarnation service with in-memory persistence', () => {
  it('catches up the old life before rechecking eligibility and replays confirmation without awarding twice', async () => {
    const start = nearThreshold();
    const memory = memoryRepository(start);
    const service = new GameService(memory.repository, { now: () => 1000, maxTicksPerChunk: 1 });
    const command = { type: 'reincarnate' as const, lifeId: start.lifeId };
    expect(getGameView(start).reincarnation.ready).toBe(false);
    const result = await service.command('character', 'request', command);
    expect(result.statusCode).toBe(200);
    const expected = applyCommand(advanceGame(start, 1000), command);
    expect(memory.snapshot().state).toEqual(expected);
    expect(expected.history.reincarnation.lastSettlement!.at).toBe(1000);
    expect(expected.history.reincarnation.lastSettlement!.level).toBe(content.reincarnation.minimumLevel);
    expect(expected.phase).toBe('preparing');
    expect(expected.totals.activeSeconds).toBe('0');
    const settled = memory.snapshot();
    const replay = await service.command('character', 'request', command);
    expect(replay.statusCode).toBe(result.statusCode);
    expect(replay.body).toEqual(result.body);
    expect(memory.snapshot()).toEqual(settled);
    expect((await service.command('character', 'new-request', command)).statusCode).toBe(422);
    expect(memory.snapshot().state).toEqual(settled.state);
  });

  it('commits one new life when distinct confirmations race from the same old life', async () => {
    const start = nearThreshold();
    const memory = memoryRepository(start);
    const service = new GameService(memory.repository, { now: () => 1000, maxTicksPerChunk: 1 });
    const command = { type: 'reincarnate' as const, lifeId: start.lifeId };
    const results = await Promise.all([
      service.command('character', 'first', command),
      service.command('character', 'second', command),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 422]);
    expect(memory.snapshot().state).toEqual(applyCommand(advanceGame(start, 1000), command));
    expect(memory.snapshot().revision).toBe('2');
    expect(memory.snapshot().receipts).toBe(2);
  });
});
