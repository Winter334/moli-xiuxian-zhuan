import { describe, expect, it, vi } from 'vitest';
import { advanceCharacter, createCharacter, executeCharacterCommand, getCharacterView } from '../core/prototype';
import { reincarnateCharacter } from '../core/prototype/reincarnation';
import { ClientSaveService } from '../server/client/service';
import type { CloudSnapshot, CloudStore } from '../server/client/repository';
import { ApiError } from '../server/errors';
import type { CloudProfile } from '../shared/client-save';
import { discordSaveKey } from '../shared/discord';
import { GameClient } from './game-client';
import { LocalSaveStore, localFromCloud, type LocalSave, type SaveStorage } from './local-save';

const characterId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const key = discordSaveKey('123456789012345678', '234567890123456789');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function profile(): CloudProfile {
  let character = createCharacter(0, 19);
  const regionId = getCharacterView(character).regions.find(region => region.enterable)!.id;
  character = executeCharacterCommand(character, { type: 'enter', regionId });
  return { characterId, revision: '0', serverTime: 0,
    save: { format: 'opening-client-2', tradeRevision: '0', character, playedMs: 0 } };
}
async function setup(fetcher: typeof fetch, initial: CloudProfile | string = profile(), prepare?: (local: LocalSave) => void) {
  const values = new Map<string, string>();
  let failKey: string | null = null;
  const storage: SaveStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { if (key === failKey) throw new Error('quota'); values.set(key, value); },
  };
  if (typeof initial === 'string') values.set(key, initial);
  else {
    const store = new LocalSaveStore(storage, key);
    await store.load();
    const local = localFromCloud(initial, 0);
    prepare?.(local);
    await store.write(local);
  }
  let now = 0;
  const make = () => new GameClient({ fetcher, store: new LocalSaveStore(storage, key),
    acquireLock: async () => () => {}, expectedCharacterId: characterId, wallNow: () => now, monotonicNow: () => now });
  const client = make();
  await client.initialize();
  return { client, make, values, time: (value: number) => { now = value; }, fail: (value: string | null) => { failKey = value; },
    read: () => new LocalSaveStore(storage, key).load() };
}

describe('explicit account save recovery', () => {
  it('never silently replaces a damaged save and archives the exact original before an explicit cloud restore', async () => {
    const cloud = profile();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(cloud));
    const broken = '{"damaged":true}';
    const state = await setup(fetcher, broken);
    expect(state.client.getSnapshot()).toMatchObject({ blocked: true, recoveryAvailable: true, response: null });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await state.client.inspectSaves()).toBe(true);
    expect(state.values.get(key)).toBe(broken);
    expect(state.client.getSnapshot().recovery).toMatchObject({ local: null, cloudBlocked: null });
    expect(await state.client.chooseSave('local')).toBe(false);
    expect(state.values.get(key)).toBe(broken);
    expect(await state.client.chooseSave('cloud')).toBe(true);
    expect(state.values.get(`${key}:recovery`)).toBe(broken);
    expect(state.client.exportSave('recovery')).toBe(broken);
    expect((await state.read())!.save).toEqual(cloud.save);
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, tradeStopped: false, issue: null });
    expect(fetcher.mock.calls.every(([url, init]) => url === '/api/client/save' && init?.method === 'GET')).toBe(true);
    const freshValues = new Map<string, string>();
    const fresh = new GameClient({ fetcher, store: new LocalSaveStore({
      getItem: key => freshValues.get(key) ?? null, setItem: (key, value) => { freshValues.set(key, value); },
    }, key), acquireLock: async () => () => {}, expectedCharacterId: characterId, wallNow: () => 0, monotonicNow: () => 0 });
    await fresh.initialize();
    expect(fresh.getSnapshot().response).toEqual(state.client.getSnapshot().response);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe('/api/client/session');
  });

  it('preserves both files on a changed cloud revision, a backup failure, or a stale local writer', async () => {
    const cloud = profile();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(cloud));
    const state = await setup(fetcher);
    const before = state.values.get(key);
    await state.client.inspectSaves();
    cloud.revision = '1';
    expect(await state.client.chooseSave('cloud')).toBe(false);
    expect(state.client.getSnapshot().recoveryMessage).toContain('重新查看');
    expect(state.values.get(key)).toBe(before);
    expect(state.values.has(`${key}:recovery`)).toBe(false);
    state.fail(`${key}:recovery`);
    expect(await state.client.chooseSave('cloud')).toBe(false);
    expect(state.values.get(key)).toBe(before);
    state.fail(null);
    await state.client.retry();
    await state.client.inspectSaves();
    state.values.set(key, '{"anotherWriter":true}');
    expect(await state.client.chooseSave('cloud')).toBe(false);
    expect(state.values.get(key)).toBe('{"anotherWriter":true}');
    expect(state.values.has(`${key}:recovery`)).toBe(false);
  });

  it('rebases only an explicitly chosen valid local branch through the ordinary server checks and conditional upload', async () => {
    const initial = profile();
    let snapshot: CloudSnapshot = { save: initial.save, revision: '1', receivedAt: 0,
      lastRequestId: null, lastPayloadHash: null };
    const store: CloudStore = {
      async createSession() { throw new Error('must not create a role'); },
      async load() { return structuredClone(snapshot); },
      async commit(_id, expected, save, now, requestId, hash) {
        if (snapshot.revision !== expected) return false;
        snapshot = { save: structuredClone(save), revision: String(BigInt(expected) + 1n),
          receivedAt: now, lastRequestId: requestId, lastPayloadHash: hash };
        return true;
      },
    };
    const service = new ClientSaveService(store, () => 1000);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      try {
        return json(init?.method === 'GET' ? await service.getProfile(characterId)
          : await service.upload(characterId, JSON.parse(String(init?.body))));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        return json({ message: error.message }, error.statusCode);
      }
    });
    const state = await setup(fetcher, initial);
    state.time(1000);
    await state.client.tick();
    await state.client.sync();
    expect(state.client.getSnapshot().tradeStopped).toBe(true);
    const stopped = (await state.read())!;
    expect(stopped.syncConflict).not.toBeNull();
    const reopened = state.make();
    await reopened.initialize();
    await reopened.sync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await reopened.inspectSaves();
    expect(reopened.getSnapshot().recovery?.localBlocked).toBeNull();
    expect(await reopened.chooseSave('local')).toBe(true);
    expect(snapshot.revision).toBe('2');
    expect(snapshot.save).toEqual(stopped.save);
    expect((await state.read())!).toMatchObject({ cloudRevision: '2', pending: null, syncConflict: null });
    expect(reopened.getSnapshot().issue).toBeNull();
    expect(JSON.parse(reopened.exportSave('recovery')!).data.syncConflict).not.toBeNull();
  });

  it('does not allow a stale local branch to undo cloud trades, lives or growth, and restores cloud combat without offline rewards', async () => {
    const cloud = profile();
    cloud.save = { ...cloud.save, tradeRevision: '1', character: reincarnateCharacter(cloud.save.character, 0, 29) };
    cloud.revision = '2';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(cloud));
    const state = await setup(fetcher);
    await state.client.inspectSaves();
    expect(state.client.getSnapshot().recovery?.localBlocked).toContain('交易版本');
    const before = state.values.get(key);
    expect(await state.client.chooseSave('local')).toBe(false);
    expect(state.values.get(key)).toBe(before);
    cloud.save = profile().save;
    cloud.save.character = advanceCharacter(cloud.save.character, 1000);
    cloud.serverTime = 60_000;
    state.time(60_000);
    await state.client.inspectSaves();
    expect(state.client.getSnapshot().recovery?.localBlocked).not.toBeNull();
    expect(await state.client.chooseSave('cloud')).toBe(true);
    const recovered = (await state.read())!;
    expect(recovered.save.playedMs).toBe(cloud.save.playedMs);
    expect(recovered.save.character.simulation.player.hp).toBe(cloud.save.character.simulation.player.hp);
    expect(recovered.save.character.simulation.clearedGroups).toEqual(cloud.save.character.simulation.clearedGroups);
    expect(recovered.save.character.simulation.clockMs).toBe(cloud.serverTime);
    expect(state.client.getSnapshot().combatFrame.events).toEqual([]);
  });

  it('keeps an unresolved reincarnation frozen and permits cloud recovery only after a matching settled receipt', async () => {
    const initial = profile();
    const requestId = crypto.randomUUID();
    const committed = { ...initial.save, tradeRevision: '1', character: reincarnateCharacter(initial.save.character, 0, 29) };
    let settled = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).includes('/receipts/')) return json(settled ? { status: 'settled', receipt: {
        status: 'committed', characterId, requestId, fromLife: initial.save.character.life.number,
        settledAt: 0, revision: '1', save: committed,
      } } : { status: 'unknown' });
      return json({ ...initial, save: settled ? committed : initial.save, revision: settled ? '1' : '0' });
    });
    const state = await setup(fetcher, initial, local => {
      local.pendingReincarnation = { characterId, requestId, baseRevision: '0', save: local.save };
    });
    const before = state.values.get(key);
    await state.client.inspectSaves();
    expect(state.client.getSnapshot().recovery?.cloudBlocked).toContain('尚未确认');
    expect(await state.client.chooseSave('cloud')).toBe(false);
    expect(state.values.get(key)).toBe(before);
    settled = true;
    await state.client.inspectSaves();
    expect(state.client.getSnapshot().recovery?.localBlocked).not.toBeNull();
    expect(await state.client.chooseSave('cloud')).toBe(true);
    expect((await state.read())!).toMatchObject({ pendingReincarnation: null, save: committed });
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, reincarnationPending: false });
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('never archives or adopts an invalid cloud save, another account, or a cloud race during the final upload', async () => {
    const cloud = profile();
    let mode: 'identity' | 'invalid' | 'race' = 'identity';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') return json({ message: 'cloud race' }, 409);
      if (mode === 'identity') return json({ ...cloud, characterId: otherId });
      if (mode === 'invalid') {
        const invalid = structuredClone(cloud);
        invalid.save.character.simulation.player.base.attack = '999';
        return json(invalid);
      }
      return json(cloud);
    });
    const state = await setup(fetcher, '{"damaged":true}');
    for (mode of ['identity', 'invalid'] as const) {
      expect(await state.client.inspectSaves()).toBe(false);
      expect(await state.client.chooseSave('cloud')).toBe(false);
      expect(state.values.get(key)).toBe('{"damaged":true}');
      expect(state.values.has(`${key}:recovery`)).toBe(false);
    }
    mode = 'race';
    await state.client.inspectSaves();
    await state.client.chooseSave('cloud');
    state.time(1000);
    await state.client.tick();
    await state.client.inspectSaves();
    expect(await state.client.chooseSave('local')).toBe(true);
    expect((await state.read())!.syncConflict).toBe('cloud race');
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, tradeStopped: true });
    const calls = fetcher.mock.calls.length;
    const reopened = state.make();
    await reopened.initialize();
    await reopened.sync();
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it('permits only manual reconciliation of the original pending request after online operations have stopped', async () => {
    const initial = profile();
    const request = { characterId, requestId: crypto.randomUUID(), baseRevision: '0', save: initial.save };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes('/receipts/')) return json({ status: 'unknown' });
      expect(init?.body).toBe(JSON.stringify(request));
      return json({ status: 'rejected', characterId, requestId: request.requestId, settledAt: 0,
        error: { code: 'SAVE_CONFLICT', message: 'another device' } });
    });
    const state = await setup(fetcher, initial, local => {
      local.pendingReincarnation = request;
      local.syncConflict = 'stopped';
    });
    expect(await state.client.reconcileReincarnation()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await state.client.reconcileReincarnation(true)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await state.read())!).toMatchObject({ pendingReincarnation: null, syncConflict: 'another device' });
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, tradeStopped: true });
  });

  it('pauses combat during an asynchronous recovery check without granting elapsed combat or accepting commands', async () => {
    const cloud = profile();
    let answer!: (response: Response) => void;
    let started!: () => void;
    const pending = new Promise<Response>(resolve => { answer = resolve; });
    const sent = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { started(); return pending; });
    const state = await setup(fetcher);
    const before = (await state.read())!;
    const inspection = state.client.inspectSaves();
    await sent;
    state.time(60_000);
    await state.client.tick();
    expect(await state.client.command({ type: 'withdraw' })).toBe(false);
    expect((await state.read())!.save).toEqual(before.save);
    answer(json({ ...cloud, serverTime: 60_000 }));
    expect(await inspection).toBe(true);
    const after = (await state.read())!;
    expect(after.save.playedMs).toBe(before.save.playedMs);
    expect(after.save.character.simulation.actionCounts).toEqual(before.save.character.simulation.actionCounts);
    expect(after.save.character.simulation.player.hp).toBe(before.save.character.simulation.player.hp);
    expect(after.save.character.simulation.clockMs).toBe(60_000);
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, recoveryBusy: false });
  });
});
