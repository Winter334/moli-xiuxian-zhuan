import { describe, expect, it, vi } from 'vitest';
import { advanceCharacter, createCharacter, executeCharacterCommand, getCharacterView, pauseSimulationUntil } from '../core/prototype';
import { checkProgress, SaveCapacityError, type CloudProfile, type SaveUpload } from '../shared/client-save';
import * as reservations from './trade-reservation';
import type { OpeningCommand } from '../shared/opening-contracts';
import { COMBAT_POWER_VERSION } from '../core/prototype/combat-power';
import { worldCalendarAt, WORLD_EPOCH_MS } from '../core/prototype/calendar';
import { GameClient } from './game-client';
import { LOCAL_SAVE_KEY, LocalSaveStore, localFromCloud, type SaveStorage } from './local-save';
import { discordSaveKey } from '../shared/discord';
import { executeDebugCommand } from '../core/prototype/debug';
import { FATE_IDS } from '../core/prototype/fates';

const characterId = '00000000-0000-4000-8000-000000000001';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const profile = (fighting = false): CloudProfile => {
  let character = createCharacter(0, 19);
  if (fighting) {
    const regionId = getCharacterView(character).regions.find(region => region.enterable)!.id;
    character = executeCharacterCommand(character, { type: 'enter', regionId });
  }
  return { characterId, revision: '0', save: { format: 'opening-client-2', tradeRevision: '0', character, playedMs: 0 }, serverTime: 0 };
};
function memoryStorage() {
  const values = new Map<string, string>();
  const storage: SaveStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  return { storage, values };
}
const lock = async () => () => {};
async function seed(storage: SaveStorage, initial = profile(true)) {
  const store = new LocalSaveStore(storage);
  await store.load();
  await store.write(localFromCloud(initial, 0));
}
const saved = (storage: SaveStorage) => new LocalSaveStore(storage).load();

describe('client-owned simulation and saves', () => {
  it('isolates Discord accounts from each other and from the existing development save', async () => {
    const memory = memoryStorage();
    await seed(memory.storage);
    const development = memory.storage.getItem(LOCAL_SAVE_KEY);
    const firstKey = discordSaveKey('123456789012345678', '234567890123456789');
    const secondKey = discordSaveKey('123456789012345678', '345678901234567890');
    const initial = profile();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(initial));
    const client = new GameClient({ fetcher, store: new LocalSaveStore(memory.storage, firstKey),
      acquireLock: lock, expectedCharacterId: characterId, wallNow: () => 0, monotonicNow: () => 0 });
    await client.initialize();
    expect(client.getSnapshot().blocked).toBe(false);
    expect(memory.storage.getItem(LOCAL_SAVE_KEY)).toBe(development);
    expect(memory.storage.getItem(firstKey)).not.toBeNull();
    expect(await new LocalSaveStore(memory.storage, secondKey).load()).toBeNull();
    const reopened = new GameClient({ fetcher, store: new LocalSaveStore(memory.storage, firstKey),
      acquireLock: lock, expectedCharacterId: characterId, wallNow: () => 0, monotonicNow: () => 0 });
    await reopened.initialize();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reopened.getSnapshot().response?.characterId).toBe(characterId);
  });

  it('refuses a mismatched Discord character before advancing or overwriting local progress', async () => {
    const memory = memoryStorage();
    await seed(memory.storage);
    const before = memory.storage.getItem(LOCAL_SAVE_KEY);
    const fetcher = vi.fn<typeof fetch>();
    const client = new GameClient({ fetcher, store: new LocalSaveStore(memory.storage), acquireLock: lock,
      expectedCharacterId: '00000000-0000-4000-8000-000000000002', wallNow: () => 86_400_000 });
    await client.initialize();
    expect(client.getSnapshot()).toMatchObject({ blocked: true, response: null });
    expect(memory.storage.getItem(LOCAL_SAVE_KEY)).toBe(before);
    expect(fetcher).not.toHaveBeenCalled();
    const empty = memoryStorage();
    fetcher.mockResolvedValue(json(profile()));
    const fresh = new GameClient({ fetcher, store: new LocalSaveStore(empty.storage), acquireLock: lock,
      expectedCharacterId: '00000000-0000-4000-8000-000000000002' });
    await fresh.initialize();
    expect(fresh.getSnapshot()).toMatchObject({ blocked: true, response: null });
    expect(empty.values.size).toBe(0);
  });

  it('publishes transient combat events only after saving and drops them on rejected capacity', async () => {
    const memory = memoryStorage();
    const initial = profile(true);
    await seed(memory.storage, initial);
    let now = 0;
    const client = new GameClient({ store: new LocalSaveStore(memory.storage), acquireLock: lock,
      wallNow: () => now, monotonicNow: () => now });
    await client.initialize();
    now = 1000;
    await client.tick();
    expect(client.getSnapshot().combatFrame.events.some(entry => entry.event.kind === 'strike')).toBe(true);
    expect((await saved(memory.storage))!.save.character).toEqual(advanceCharacter(initial.save.character, now));
    expect(memory.storage.getItem(LOCAL_SAVE_KEY)).not.toContain('combatFrame');
    const before = (await saved(memory.storage))!.save.character;
    const reject = vi.spyOn(reservations, 'checkReservedCapacity').mockImplementationOnce(() => { throw new SaveCapacityError('full'); });
    try {
      now = 2000;
      await client.tick();
      expect(client.getSnapshot().combatFrame).toMatchObject({ events: [], paused: true });
      expect((await saved(memory.storage))!.save.character).toEqual({
        ...before, simulation: pauseSimulationUntil(before.simulation, now),
      });
    } finally { reject.mockRestore(); }
  });

  it('does not publish unsaved combat events or replay them on offline reopening', async () => {
    const memory = memoryStorage();
    await seed(memory.storage);
    let now = 0;
    let fail = false;
    const storage: SaveStorage = { getItem: memory.storage.getItem, setItem: (key, value) => {
      if (fail) throw new Error('quota');
      memory.storage.setItem(key, value);
    } };
    const options = { acquireLock: lock, wallNow: () => now, monotonicNow: () => now };
    const client = new GameClient({ ...options, store: new LocalSaveStore(storage) });
    await client.initialize();
    const frame = client.getSnapshot().combatFrame;
    const before = await saved(storage);
    fail = true;
    now = 1000;
    await client.tick();
    expect(client.getSnapshot().blocked).toBe(true);
    expect(client.getSnapshot().combatFrame).toBe(frame);
    expect(await saved(storage)).toEqual(before);
    fail = false;
    now = 60_000;
    const reopened = new GameClient({ ...options, store: new LocalSaveStore(storage) });
    await reopened.initialize();
    expect(reopened.getSnapshot().combatFrame).toMatchObject({ events: [], paused: true });
  });

  it('keeps the initial fate unplayable until locally saved and reloads that checkpoint without a new draw', async () => {
    const memory = memoryStorage();
    const initial = profile();
    let failWrite = true;
    const storage: SaveStorage = {
      getItem: memory.storage.getItem,
      setItem: (key, value) => {
        if (failWrite) throw new Error('quota');
        memory.storage.setItem(key, value);
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(initial));
    const options = { fetcher, acquireLock: lock, wallNow: () => 0, monotonicNow: () => 0 };
    const client = new GameClient({ ...options, store: new LocalSaveStore(storage) });
    await client.initialize();
    expect(client.getSnapshot()).toMatchObject({ blocked: true, response: null });
    expect(await client.command({ type: 'recover', mode: 'sleep' })).toBe(false);
    expect(memory.storage.getItem(LOCAL_SAVE_KEY)).toBeNull();
    failWrite = false;
    await client.initialize();
    expect(client.getSnapshot().blocked).toBe(false);
    expect((await saved(memory.storage))!.save).toEqual(initial.save);
    expect(client.getSnapshot().response!.game.fate.id).toBe(initial.save.character.fateId);
    const calls = fetcher.mock.calls.length;
    const reopened = new GameClient({ ...options, store: new LocalSaveStore(storage) });
    await reopened.initialize();
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect((await saved(memory.storage))!.save).toEqual(initial.save);
    expect(reopened.getSnapshot().response!.game.fate.id).toBe(initial.save.character.fateId);
  });

  it('calibrates shared dates without granting play time and retains the clock across offline reopening', async () => {
    const memory = memoryStorage();
    const initial = profile(true);
    await seed(memory.storage, initial);
    let wall = 0;
    let mono = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ serverTime: WORLD_EPOCH_MS }));
    const options = { fetcher, acquireLock: lock, wallNow: () => wall, monotonicNow: () => mono };
    const client = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await client.initialize();
    const before = (await saved(memory.storage))!;
    await client.refreshWorldTime();
    const calibrated = (await saved(memory.storage))!;
    expect(calibrated.save).toEqual(before.save);
    expect(calibrated.localRevision).toBe(before.localRevision);
    expect(calibrated.pending).toEqual(before.pending);
    expect(calibrated.worldClock.timeMs).toBe(WORLD_EPOCH_MS);
    expect(client.getSnapshot().response!.game.calendar).toEqual(worldCalendarAt(WORLD_EPOCH_MS));
    expect(fetcher.mock.calls[0][0]).toBe('/api/client/time');

    wall = 3_600_000;
    mono = 1000;
    await client.tick();
    const advanced = (await saved(memory.storage))!;
    expect(advanced.save.character).toEqual(advanceCharacter(before.save.character, 1000));
    expect(advanced.save.playedMs).toBe(1000);
    expect(advanced.worldClock.timeMs).toBe(WORLD_EPOCH_MS + 1000);
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    await client.refreshWorldTime();
    expect(client.getSnapshot().blocked).toBe(false);
    expect(client.getSnapshot().issue).toBeNull();
    expect(await saved(memory.storage)).toEqual(advanced);

    wall += 2000;
    const reopened = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await reopened.initialize();
    const restored = (await saved(memory.storage))!;
    expect(restored.worldClock.timeMs).toBe(WORLD_EPOCH_MS + 3000);
    expect(restored.save.playedMs).toBe(1000);
    expect(restored.save.character).toEqual({
      ...advanced.save.character, simulation: pauseSimulationUntil(advanced.save.character.simulation, 3000),
    });
    expect(reopened.getSnapshot().response!.game.calendar).toEqual(worldCalendarAt(WORLD_EPOCH_MS + 3000));
  });

  it('reads rankings without uploading, moving, blocking local commands or keeping a wrong board', async () => {
    const memory = memoryStorage();
    await seed(memory.storage, profile());
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('offline'));
    const client = new GameClient({ fetcher, store: new LocalSaveStore(memory.storage), acquireLock: lock,
      wallNow: () => 0, monotonicNow: () => 0 });
    await client.initialize();
    const before = await saved(memory.storage);
    await expect(client.loadRanking('power')).rejects.toThrow('offline');
    expect(await saved(memory.storage)).toEqual(before);
    expect(client.getSnapshot().blocked).toBe(false);
    expect(client.getSnapshot().issue).toBeNull();
    const board = { board: 'power', scope: 'development', powerVersion: COMBAT_POWER_VERSION, entries: [], self: null };
    fetcher.mockResolvedValueOnce(json(board));
    expect(await client.loadRanking('power')).toEqual(board);
    expect(fetcher.mock.calls[0][0]).toContain('/api/client/rankings/power?characterId=');
    expect(fetcher.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
    fetcher.mockResolvedValueOnce(json({ ...board, board: 'money' }));
    await expect(client.loadRanking('power')).rejects.toThrow('榜单回执不匹配');
    expect(await client.command({ type: 'recover', mode: 'sleep' })).toBe(true);
  });

  it('bootstraps once, runs commands and monotonic ticks locally, and does not turn clock jumps into combat rewards', async () => {
    const memory = memoryStorage();
    const initial = profile(true);
    let wall = 0;
    let mono = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(initial));
    const client = new GameClient({
      fetcher, store: new LocalSaveStore(memory.storage), acquireLock: lock,
      wallNow: () => wall, monotonicNow: () => mono,
    });
    await client.initialize();
    wall = 3_600_000;
    mono = 1000;
    await client.tick();
    const advanced = advanceCharacter(initial.save.character, 1000);
    expect((await saved(memory.storage))!.save.character).toEqual(advanced);
    expect((await saved(memory.storage))!.save.playedMs).toBe(1000);
    wall += 10_000;
    mono += 10_000;
    await client.tick();
    const paused = { ...advanced, simulation: pauseSimulationUntil(advanced.simulation, 11_000) };
    expect((await saved(memory.storage))!.save.character).toEqual(paused);
    expect(await client.command({ type: 'withdraw' })).toBe(true);
    expect((await saved(memory.storage))!.save.character).toEqual(executeCharacterCommand(paused, { type: 'withdraw' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/client/session');
  });

  it('reloads a saved encounter without offline rewards while retaining safe-location offline recovery', async () => {
    const memory = memoryStorage();
    const initial = profile(true);
    await seed(memory.storage, initial);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    let wall = 86_400_000;
    const options = { fetcher, acquireLock: lock, wallNow: () => wall, monotonicNow: () => 0 };
    const client = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await client.initialize();
    const paused = { ...initial.save.character, simulation: pauseSimulationUntil(initial.save.character.simulation, wall) };
    expect((await saved(memory.storage))!.save.character).toEqual(paused);
    expect((await saved(memory.storage))!.save.playedMs).toBe(0);
    await client.command({ type: 'withdraw' });
    const resting = (await saved(memory.storage))!.save.character;
    wall += 2103;
    const reopened = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await reopened.initialize();
    expect((await saved(memory.storage))!.save.character).toEqual(advanceCharacter(resting, wall));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains allowed meditation across offline recovery and pauses combat again after entering a region', async () => {
    const memory = memoryStorage();
    const initial = profile(true);
    initial.save.character.simulation.player.hp = '1';
    await seed(memory.storage, initial);
    const fetcher = vi.fn<typeof fetch>();
    let wall = 0;
    const options = { fetcher, acquireLock: lock, wallNow: () => wall, monotonicNow: () => 0 };
    const client = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await client.initialize();
    expect(await client.command({ type: 'recover', mode: 'sleep' })).toBe(false);
    expect(await client.command({ type: 'withdraw' })).toBe(true);
    expect(await client.command({ type: 'recover', mode: 'sleep' })).toBe(true);
    const meditating = (await saved(memory.storage))!.save.character;
    wall = 2103;
    const reopened = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await reopened.initialize();
    const recovered = (await saved(memory.storage))!.save;
    expect(recovered.character).toEqual(advanceCharacter(meditating, wall));
    expect(recovered.character.locationId).toBe(meditating.locationId);
    expect(recovered.character.simulation.battle).toBeNull();
    expect(Number(recovered.character.simulation.player.hp)).toBeGreaterThan(1);
    expect(Number(recovered.character.skills.rest.xp)).toBeGreaterThan(Number(meditating.skills.rest.xp));
    expect(recovered.character.cultivation).toBe(meditating.cultivation);
    expect(recovered.character.inventory).toEqual(meditating.inventory);
    expect(recovered.playedMs).toBe(0);
    expect(await reopened.command({ type: 'enter', regionId: initial.save.character.locationId })).toBe(true);
    const fighting = (await saved(memory.storage))!.save.character;
    expect(fighting.simulation.battle).not.toBeNull();
    wall += 2103;
    await new GameClient({ ...options, store: new LocalSaveStore(memory.storage) }).initialize();
    expect((await saved(memory.storage))!.save.character).toEqual({
      ...fighting, simulation: pauseSimulationUntil(fighting.simulation, wall),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('persists idle exploration locations without offline rest recovery or automatic encounters', async () => {
    const memory = memoryStorage();
    const initial = profile();
    const regionId = getCharacterView(initial.save.character).regions.find(region => region.arrivable)!.id;
    initial.save.character.simulation.player.hp = '1';
    initial.save.character = executeCharacterCommand(initial.save.character, { type: 'arrive', regionId });
    await seed(memory.storage, initial);
    const fetcher = vi.fn<typeof fetch>();
    let wall = 2000;
    const options = { fetcher, acquireLock: lock, wallNow: () => wall, monotonicNow: () => 0 };
    const client = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await client.initialize();
    const idle = (await saved(memory.storage))!.save;
    expect(idle.character.locationId).toBe(regionId);
    expect(idle.character.simulation.mode).toBe('idle');
    expect(idle.character.simulation.player.hp).toBe('1');
    expect(idle.character.simulation.battle).toBeNull();
    expect(idle.character.simulation.rng).toBe(initial.save.character.simulation.rng);
    expect(idle.character.simulation.clearedGroups).toEqual(initial.save.character.simulation.clearedGroups);
    expect(idle.character.cultivation).toBe(initial.save.character.cultivation);
    expect(idle.playedMs).toBe(0);
    expect(await client.command({ type: 'explore' })).toBe(true);
    const fighting = (await saved(memory.storage))!.save.character;
    wall += 2000;
    await new GameClient({ ...options, store: new LocalSaveStore(memory.storage) }).initialize();
    expect((await saved(memory.storage))!.save.character).toEqual({
      ...fighting, simulation: pauseSimulationUntil(fighting.simulation, wall),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects unavailable resource actions without spending resources, RNG or blocking the next local command', async () => {
    const memory = memoryStorage();
    const initial = profile();
    await seed(memory.storage, initial);
    const fetcher = vi.fn<typeof fetch>();
    const client = new GameClient({
      fetcher, store: new LocalSaveStore(memory.storage), acquireLock: lock,
      wallNow: () => 0, monotonicNow: () => 0,
    });
    await client.initialize();
    const before = (await saved(memory.storage))!;
    const [itemId, owned] = Object.entries(initial.save.character.inventory)[0];
    const rejected: OpeningCommand[] = [
      { type: 'equip', instanceId: 'missing-item' },
      { type: 'sell', shopId: 'village-stall', target: { kind: 'stack', itemId }, quantity: Number(owned) + 1 },
      { type: 'use', itemId, quantity: 0 },
    ];
    for (const command of rejected) {
      expect(await client.command(command)).toBe(false);
      expect(client.getSnapshot()).toMatchObject({ blocked: false, issue: { source: 'action' } });
      expect(await saved(memory.storage)).toEqual(before);
    }
    expect(await client.command({ type: 'visit-shop', shopId: 'village-stall' })).toBe(true);
    expect(client.getSnapshot()).toMatchObject({ blocked: false, issue: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('persists personal furnace upgrades locally and in cloud backups while rejecting progression rollback', async () => {
    const memory = memoryStorage();
    const initial = profile();
    const upgrade = getCharacterView(initial.save.character).workshop.upgrade!;
    for (const material of upgrade.materialCosts) {
      initial.save.character.inventory[material.itemId] = String(material.required);
    }
    await seed(memory.storage, initial);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const input = JSON.parse(String(init!.body)) as SaveUpload;
      return json({ characterId, requestId: input.requestId, revision: '1', savedAt: 0 });
    });
    const options = { fetcher, acquireLock: lock, wallNow: () => 0, monotonicNow: () => 0 };
    const client = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await client.initialize();
    const command: OpeningCommand = { type: 'upgrade-furnace', tier: upgrade.tier };
    expect(await client.command(command)).toBe(true);
    const upgraded = (await saved(memory.storage))!;
    expect(upgraded.save.character.furnaceTier).toBe(upgrade.tier);
    expect(() => checkProgress(initial.save, upgraded.save, 0, 0)).not.toThrow();
    const rollback = structuredClone(upgraded.save);
    rollback.character.furnaceTier = initial.save.character.furnaceTier;
    expect(() => checkProgress(upgraded.save, rollback, 0, 0)).toThrow('成长进度发生回退');
    expect(await client.command(command)).toBe(false);
    expect(await saved(memory.storage)).toEqual(upgraded);
    const reopened = new GameClient({ ...options, store: new LocalSaveStore(memory.storage) });
    await reopened.initialize();
    expect(reopened.getSnapshot().response!.game.workshop.tier).toBe(upgrade.tier);
    expect((await saved(memory.storage))!.save).toEqual(upgraded.save);
    await reopened.sync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const upload = JSON.parse(String(fetcher.mock.calls[0][1]!.body)) as SaveUpload;
    expect(upload.save).toEqual(upgraded.save);
    expect((await saved(memory.storage))!.cloudRevision).toBe('1');
  });

  it('serializes and persists development actions locally, rejecting invalid or oversized changes atomically', async () => {
    vi.stubEnv('DEV', true);
    try {
      const memory = memoryStorage();
      await seed(memory.storage, profile());
      const fetcher = vi.fn<typeof fetch>();
      const client = new GameClient({
        fetcher, store: new LocalSaveStore(memory.storage), acquireLock: lock,
        wallNow: () => 0, monotonicNow: () => 0,
      });
      await client.initialize();
      const before = (await saved(memory.storage))!;
      const results = await Promise.all([
        client.debugCommand({ type: 'money', amount: 10 }),
        client.debugCommand({ type: 'money', amount: 20 }),
      ]);
      expect(results).toEqual([true, true]);
      const after = (await saved(memory.storage))!;
      expect(after.save.character.money).toBe('30');
      expect(BigInt(after.localRevision)).toBe(BigInt(before.localRevision) + 2n);
      expect(client.getSnapshot().response!.game).toEqual(getCharacterView(after.save.character, 0));
      expect(() => checkProgress(before.save, after.save, 0, 0)).not.toThrow();
      for (const amount of [-1, 1_000_000_000_001]) {
        expect(await client.debugCommand({ type: 'money', amount })).toBe(false);
        expect(await saved(memory.storage)).toEqual(after);
        expect(client.getSnapshot()).toMatchObject({ blocked: false, issue: { source: 'action' } });
      }
      expect(await client.command({ type: 'recover', mode: 'rest' })).toBe(true);
      expect(client.getSnapshot().issue).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('rejects debug dispatch outside development without changing the save or issuing a request', async () => {
    vi.stubEnv('DEV', false);
    try {
      const memory = memoryStorage();
      await seed(memory.storage, profile());
      const fetcher = vi.fn<typeof fetch>();
      const client = new GameClient({
        fetcher, store: new LocalSaveStore(memory.storage), acquireLock: lock,
        wallNow: () => 0, monotonicNow: () => 0,
      });
      await client.initialize();
      const before = await saved(memory.storage);
      const snapshot = client.getSnapshot();
      expect(await client.debugCommand({ type: 'money', amount: 10 })).toBe(false);
      expect(await saved(memory.storage)).toEqual(before);
      expect(client.getSnapshot()).toBe(snapshot);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('requires server permission in production and preserves the save when an administrator request is refused', async () => {
    vi.stubEnv('DEV', false);
    try {
      const memory = memoryStorage();
      const initial = profile();
      initial.save.character.history.testAssisted = true;
      await seed(memory.storage, initial);
      let allowed = false;
      let revoked = false;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        if (!init?.body) return json({ characterId, allowed });
        const input = JSON.parse(String(init.body));
        if (String(url) === '/api/client/save') {
          const pending = (await saved(memory.storage))!.pending;
          expect(pending?.request.save.character.fateId).toBe(input.save.character.fateId);
          return json({ characterId, requestId: input.requestId, revision: String(BigInt(input.baseRevision) + 1n), savedAt: 0 });
        }
        if (revoked) return json({ message: '没有测试控制台权限' }, 403);
        return json({ characterId, character: executeDebugCommand(input.character, input.command) });
      });
      const client = new GameClient({ fetcher, expectedCharacterId: characterId,
        store: new LocalSaveStore(memory.storage), acquireLock: lock, wallNow: () => 0, monotonicNow: () => 0 });
      await client.initialize();
      const before = (await saved(memory.storage))!;
      await client.refreshDebugAccess();
      expect(client.getSnapshot().debugAllowed).toBe(false);
      expect(await client.debugCommand({ type: 'money', amount: 10 })).toBe(false);
      expect(await saved(memory.storage)).toEqual(before);
      allowed = true;
      await client.refreshDebugAccess();
      expect(await client.debugCommand({ type: 'clear-test-marker' })).toBe(true);
      expect((await saved(memory.storage))!.save.character.history.testAssisted).toBe(false);
      const fateId = FATE_IDS.find(id => id !== before.save.character.fateId)!;
      expect(await client.debugCommand({ type: 'fate', fateId })).toBe(true);
      const after = (await saved(memory.storage))!;
      expect(after.save.character).toMatchObject({ fateId, history: { testAssisted: false } });
      expect(after).toMatchObject({ pending: null, cloudRevision: '2' });
      expect(fetcher).toHaveBeenCalledWith('/api/client/save', expect.anything());
      expect(new GameClient({ expectedCharacterId: characterId }).getSnapshot().debugAllowed).toBe(false);
      revoked = true;
      expect(await client.debugCommand({ type: 'money', amount: 10 })).toBe(false);
      expect(await saved(memory.storage)).toEqual(after);
      expect(client.getSnapshot()).toMatchObject({ debugAllowed: false, blocked: false, issue: { source: 'action' } });
    } finally { vi.unstubAllEnvs(); }
  });

  it('keeps playing after upload failure and retries the exact persisted upload after reopening', async () => {
    const memory = memoryStorage();
    await seed(memory.storage);
    let now = 0;
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const options = { acquireLock: lock, wallNow: () => now, monotonicNow: () => now };
    const client = new GameClient({ ...options, fetcher, store: new LocalSaveStore(memory.storage) });
    await client.initialize();
    now = 1000;
    await client.tick();
    await client.sync();
    const pending = (await saved(memory.storage))!.pending!;
    expect(client.getSnapshot().blocked).toBe(false);
    expect(await client.command({ type: 'withdraw' })).toBe(true);
    const later = (await saved(memory.storage))!;
    const retryFetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const input = JSON.parse(String(init!.body)) as SaveUpload;
      return json({ characterId, requestId: input.requestId, revision: '1', savedAt: now });
    });
    const reopened = new GameClient({ ...options, fetcher: retryFetcher, store: new LocalSaveStore(memory.storage) });
    await reopened.initialize();
    await reopened.sync();
    expect(retryFetcher.mock.calls[0][1]!.body).toBe(fetcher.mock.calls[0][1]!.body);
    const accepted = (await saved(memory.storage))!;
    expect(accepted.save).toEqual(later.save);
    expect(accepted.pending).toBeNull();
    expect(accepted.cloudRevision).toBe('1');
    expect(accepted.uploadedRevision).toBe(pending.localRevision);
    expect(BigInt(accepted.localRevision)).toBeGreaterThan(BigInt(accepted.uploadedRevision));
  });

  it('does not force-overwrite conflicting cloud progress or block local commands when cloud sync stops', async () => {
    const memory = memoryStorage();
    await seed(memory.storage);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'conflict' }, 409));
    const client = new GameClient({
      fetcher, store: new LocalSaveStore(memory.storage), acquireLock: lock,
      wallNow: () => 0, monotonicNow: () => 0,
    });
    await client.initialize();
    await client.command({ type: 'withdraw' });
    await client.sync();
    expect(client.getSnapshot()).toMatchObject({ blocked: false, issue: { source: 'cloud', retryable: false } });
    expect(await client.command({ type: 'recover', mode: 'rest' })).toBe(true);
    await client.sync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await saved(memory.storage))!.cloudRevision).toBe('0');
    expect((await saved(memory.storage))!.pending).not.toBeNull();
  });

  it('fails closed on tampered saves, stale writers, storage failure and an occupied local lock', async () => {
    const memory = memoryStorage();
    await seed(memory.storage);
    const one = new LocalSaveStore(memory.storage);
    const two = new LocalSaveStore(memory.storage);
    const first = (await one.load())!;
    await two.load();
    await one.write({ ...first, localRevision: '1' });
    const newest = memory.storage.getItem(LOCAL_SAVE_KEY);
    await expect(two.write(first)).rejects.toThrow('另一页面');
    expect(memory.storage.getItem(LOCAL_SAVE_KEY)).toBe(newest);

    const fetcher = vi.fn<typeof fetch>();
    const blocked = new GameClient({
      fetcher, store: new LocalSaveStore(memory.storage), acquireLock: async () => { throw new Error('occupied'); },
    });
    await blocked.initialize();
    expect(blocked.getSnapshot().blocked).toBe(true);
    expect(memory.storage.getItem(LOCAL_SAVE_KEY)).toBe(newest);
    expect(fetcher).not.toHaveBeenCalled();

    const broken = JSON.parse(newest!);
    broken.data.save.character.money = '12345';
    memory.storage.setItem(LOCAL_SAVE_KEY, JSON.stringify(broken));
    const tampered = memory.storage.getItem(LOCAL_SAVE_KEY);
    await expect(new LocalSaveStore(memory.storage).load()).rejects.toThrow('校验');
    expect(memory.storage.getItem(LOCAL_SAVE_KEY)).toBe(tampered);

    const clean = memoryStorage();
    await seed(clean.storage);
    let full = false;
    const failingStorage: SaveStorage = {
      getItem: clean.storage.getItem,
      setItem: (key, value) => { if (full) throw new Error('quota'); clean.storage.setItem(key, value); },
    };
    const client = new GameClient({
      fetcher, store: new LocalSaveStore(failingStorage), acquireLock: lock,
      wallNow: () => 0, monotonicNow: () => 0,
    });
    await client.initialize();
    const before = clean.storage.getItem(LOCAL_SAVE_KEY);
    full = true;
    expect(await client.command({ type: 'withdraw' })).toBe(false);
    expect(client.getSnapshot().blocked).toBe(true);
    expect(clean.storage.getItem(LOCAL_SAVE_KEY)).toBe(before);
  });
});
