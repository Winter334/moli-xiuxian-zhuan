import { describe, expect, it } from 'vitest';
import {
  advanceCharacter, createCharacter, executeCharacterCommand, getCharacterView,
  pauseSimulationUntil, type CharacterState,
} from '../../core/prototype';
import { ApiError } from '../../server/errors';
import type { OpeningStore, Receipt, StoredResponse } from '../../server/opening/repository';
import { ONLINE_REQUEST_GAP_MS, OpeningService, requestSchema } from '../../server/opening/service';

function memoryStore(initial: CharacterState) {
  let state: unknown = structuredClone(initial);
  let revision = '0';
  const receipts = new Map<string, Receipt>();
  const store: OpeningStore = {
    async createSession(next) { state = structuredClone(next); return { token: 'session', characterId: 'character' }; },
    async load() { return { state: structuredClone(state), revision }; },
    async findReceipt(_id, key, hash): Promise<StoredResponse | null> {
      const receipt = receipts.get(key);
      if (receipt && receipt.payloadHash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'conflict');
      return receipt ? structuredClone({ statusCode: receipt.statusCode, body: receipt.body }) : null;
    },
    async commit(id, expected, next, receipt) {
      const replay = receipt && await store.findReceipt(id, receipt.requestId, receipt.payloadHash);
      if (replay) return { committed: false, replay };
      if (revision !== expected) return { committed: false };
      state = structuredClone(next);
      revision = String(BigInt(revision) + 1n);
      if (receipt) receipts.set(receipt.requestId, structuredClone(receipt));
      return { committed: true };
    },
  };
  return { store, snapshot: () => structuredClone({ state, revision, receipts: receipts.size }),
    replaceRaw: (raw: unknown) => { state = raw; } };
}

function fightingCharacter() {
  const initial = createCharacter(117, 19);
  const regionId = getCharacterView(initial).regions.find((region) => region.enterable)!.id;
  return executeCharacterCommand(initial, { type: 'enter', regionId });
}

function pausedCharacter(state: CharacterState, now: number): CharacterState {
  return { ...state, simulation: pauseSimulationUntil(state.simulation, now) };
}

describe('opening authority and persistence contract', () => {
  it('preserves milliseconds across bounded catch-up and never rewinds a later checkpoint', async () => {
    const initial = createCharacter(117, 19);
    const memory = memoryStore(initial);
    let now = 2873;
    const service = new OpeningService(memory.store, () => now, 1);
    const result = await service.getGame('character');
    expect(result.game.clockMs).toBe(now);
    expect(memory.snapshot().state).toEqual(advanceCharacter(initial, now));
    const settled = memory.snapshot();
    now = 1000;
    expect((await service.getGame('character')).game.clockMs).toBe(2873);
    expect(memory.snapshot()).toEqual(settled);
  });

  it('commits a raced command once, replays it, and rejects a reused key with a different action', async () => {
    const initial = createCharacter(0, 19);
    const memory = memoryStore(initial);
    const service = new OpeningService(memory.store, () => 0);
    const locationId = getCharacterView(initial).destinations[0].id;
    const command = { type: 'travel' as const, locationId };
    const results = await Promise.all([
      service.command('character', 'request', command),
      service.command('character', 'request', { locationId, type: 'travel' }),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(memory.snapshot()).toEqual({
      state: executeCharacterCommand(initial, command), revision: '1', receipts: 1,
    });
    const settled = memory.snapshot();
    await expect(service.command('character', 'request', { type: 'withdraw' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(memory.snapshot()).toEqual(settled);
  });

  it('persists only elapsed time on rejection and refuses incompatible saves and legacy commands', async () => {
    const initial = createCharacter(0, 19);
    const memory = memoryStore(initial);
    const service = new OpeningService(memory.store, () => 1031);
    const result = await service.command('character', 'rejected', { type: 'withdraw' });
    expect(result.statusCode).toBe(422);
    expect(memory.snapshot().state).toEqual(advanceCharacter(initial, 1031));
    const settled = memory.snapshot();
    expect(await service.command('character', 'rejected', { type: 'withdraw' })).toEqual(result);
    expect(memory.snapshot()).toEqual(settled);
    memory.replaceRaw({ ...initial, contentVersion: 'obsolete' });
    const incompatible = memory.snapshot();
    await expect(service.getGame('character')).rejects.toMatchObject({ code: 'SAVE_VERSION_MISMATCH' });
    expect(memory.snapshot()).toEqual(incompatible);
    expect(requestSchema.safeParse({
      requestId: '00000000-0000-4000-8000-000000000001', command: { type: 'activity', kind: 'meditate' },
    }).success).toBe(false);
  });

  it('settles only connected combat time, skips the whole disconnected gap, and resumes once across concurrent reads', async () => {
    const initial = fightingCharacter();
    const memory = memoryStore(initial);
    let now = initial.simulation.clockMs;
    const service = new OpeningService(memory.store, () => now, 1);
    await service.getGame('character');
    now += 117;
    await service.getGame('character');
    const connected = advanceCharacter(initial, now);
    expect(memory.snapshot().state).toEqual(connected);
    expect(connected.simulation.battle).not.toBeNull();

    now += ONLINE_REQUEST_GAP_MS + 1;
    const disconnected = await Promise.all([service.getGame('character'), service.getGame('character')]);
    const paused = pausedCharacter(connected, now);
    expect(disconnected[0]).toEqual(disconnected[1]);
    expect(memory.snapshot().state).toEqual(paused);
    expect(memory.snapshot().revision).toBe('2');

    now += 86_400_000;
    await service.getGame('character');
    const returned = pausedCharacter(paused, now);
    expect(memory.snapshot().state).toEqual(returned);
    now += ONLINE_REQUEST_GAP_MS;
    await Promise.all([service.getGame('character'), service.getGame('character')]);
    expect(memory.snapshot().state).toEqual(advanceCharacter(returned, now));
    expect(memory.snapshot().revision).toBe('4');
  });

  it('pauses on service restart and reconnect commands without letting receipt replays authorize offline combat', async () => {
    const initial = fightingCharacter();
    const memory = memoryStore(initial);
    let now = initial.simulation.clockMs + 1000;
    const service = new OpeningService(memory.store, () => now);
    const rejected = await service.command('character', 'rejected', { type: 'recover', mode: 'rest' });
    expect(rejected.statusCode).toBe(422);
    const paused = pausedCharacter(initial, now);
    expect(memory.snapshot().state).toEqual(paused);

    now += ONLINE_REQUEST_GAP_MS + 1;
    const saved = memory.snapshot();
    expect(await service.command('character', 'rejected', { type: 'recover', mode: 'rest' })).toEqual(rejected);
    expect(memory.snapshot()).toEqual(saved);
    now += 117;
    await service.getGame('character');
    const returned = pausedCharacter(paused, now);
    expect(memory.snapshot().state).toEqual(returned);

    now += 1000;
    const restarted = new OpeningService(memory.store, () => now);
    const result = await restarted.command('character', 'withdrawn', { type: 'withdraw' });
    expect(result.statusCode).toBe(200);
    expect(memory.snapshot().state).toEqual(
      executeCharacterCommand(pausedCharacter(returned, now), { type: 'withdraw' }),
    );
    const settled = memory.snapshot();
    expect(await restarted.command('character', 'withdrawn', { type: 'withdraw' })).toEqual(result);
    expect(memory.snapshot()).toEqual(settled);
  });
});
