import { describe, expect, it, vi } from 'vitest';
import { advanceCharacter, createCharacter, executeCharacterCommand, getCharacterView, pauseSimulationUntil } from '../core/prototype';
import { reincarnateCharacter } from '../core/prototype/reincarnation';
import { ClientSaveService } from '../server/client/service';
import type { CloudSnapshot, CloudStore } from '../server/client/repository';
import { ApiError } from '../server/errors';
import { CLOUD_RESUME_TOLERANCE_MS, type CloudProfile } from '../shared/client-save';
import { discordSaveKey } from '../shared/discord';
import { GameClient } from './game-client';
import { LocalSaveStore, localFromCloud, type LocalSave, type SaveStorage } from './local-save';
import { EMPTY_PVP } from '../shared/pvp';
import { matchesCloudCheckpoint } from './save-recovery';

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
async function setup(fetcher: typeof fetch, initial: CloudProfile | string = profile(), prepare?: (local: LocalSave) => void,
  requireCloudBaseline = false) {
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
  const make = (openedAt?: number) => new GameClient({ fetcher, store: new LocalSaveStore(storage, key),
    acquireLock: async () => () => {}, expectedCharacterId: characterId, requireCloudBaseline,
    openedAt,
    wallNow: () => now, monotonicNow: () => now });
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
    expect(await state.client.chooseSave('local' as never)).toBe(false);
    expect(state.values.get(key)).toBe(broken);
    expect(await state.client.chooseSave('cloud')).toBe(true);
    expect(state.values.get(`${key}:recovery`)).toBe(broken);
    expect('exportSave' in state.client).toBe(false);
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

  it('never rebases a local branch after a cloud conflict, even when the branch passes ordinary progress checks', async () => {
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
    const calls = fetcher.mock.calls.length;
    expect(await reopened.chooseSave('local' as never)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(snapshot.revision).toBe('1');
    expect(snapshot.save).toEqual(initial.save);
    expect((await state.read())!).toEqual(stopped);
    expect(reopened.getSnapshot().onlineReady).toBe(false);
  });

  it('does not allow a stale local branch to undo cloud trades, lives or growth, and restores cloud combat without offline rewards', async () => {
    const cloud = profile();
    cloud.save = { ...cloud.save, tradeRevision: '1', character: reincarnateCharacter(cloud.save.character, 0, 29) };
    cloud.revision = '2';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(cloud));
    const state = await setup(fetcher);
    await state.client.inspectSaves();
    const before = state.values.get(key);
    expect(await state.client.chooseSave('local' as never)).toBe(false);
    expect(state.values.get(key)).toBe(before);
    cloud.save = profile().save;
    cloud.save.character = advanceCharacter(cloud.save.character, 1000);
    cloud.serverTime = 60_000;
    state.time(60_000);
    await state.client.inspectSaves();
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
    expect(await state.client.chooseSave('cloud')).toBe(true);
    expect((await state.read())!).toMatchObject({ pendingReincarnation: null, save: committed });
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, reincarnationPending: false });
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('never archives or adopts an invalid cloud save or another account, and blocks online use after a normal upload race', async () => {
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
    await state.client.sync();
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
    expect(after.save).toEqual(before.save);
    expect(after.wallSavedAt).toBe(60_000);
    state.time(61_000);
    await state.client.tick();
    expect((await state.read())!.save.character.simulation.clockMs).toBe(before.save.character.simulation.clockMs + 1000);
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, recoveryBusy: false });
  });

  it('keeps a cache beyond the resume window offline until the player explicitly adopts cloud', async () => {
    const cloud = profile();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => json(url === '/api/client/pvp'
      ? { state: EMPTY_PVP, battleId: null, serverTime: 0 } : cloud));
    const state = await setup(fetcher, cloud, local => {
      local.save.character.simulation = pauseSimulationUntil(local.save.character.simulation, CLOUD_RESUME_TOLERANCE_MS + 1);
      local.localRevision = '1';
    }, true);
    const original = state.values.get(key);
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, onlineReady: false, tradeStopped: true });
    expect(() => state.client.getOnlineRevision()).toThrow('云端存档');
    await state.client.sync();
    expect(state.values.get(key)).toBe(original);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(await state.client.command({ type: 'withdraw' })).toBe(true);
    await state.client.inspectSaves();
    const beforeRestore = state.values.get(key);
    expect(await state.client.chooseSave('cloud')).toBe(true);
    expect(state.values.get(`${key}:recovery`)).toBe(beforeRestore);
    expect((await state.read())!.save).toEqual(cloud.save);
    expect(state.client.getSnapshot()).toMatchObject({ onlineReady: true, tradeStopped: false, onlineMessage: null });
    expect(state.client.getOnlineRevision()).toBe('0');
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('recognizes identical cloud content regardless of JSON object key order, and fails closed when cloud is unavailable', async () => {
    const cloud = profile();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(cloud));
    const state = await setup(fetcher, cloud, local => {
      local.save.character.skills = Object.fromEntries(Object.entries(local.save.character.skills).reverse()) as typeof local.save.character.skills;
    }, true);
    expect(state.client.getSnapshot().onlineReady).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const offline = await setup(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')), cloud, undefined, true);
    const original = offline.values.get(key);
    expect(offline.client.getSnapshot()).toMatchObject({ blocked: false, onlineReady: false, tradeStopped: true });
    await offline.client.sync();
    expect(offline.values.get(key)).toBe(original);
    expect((await offline.read())!.save).toEqual(cloud.save);
  });

  it('excludes Discord login and delayed startup reads from cached progress across repeated openings', async () => {
    const cloud = profile();
    cloud.save.character = executeCharacterCommand(cloud.save.character, { type: 'withdraw' });
    cloud.save.character.simulation.player.hp = '1';
    let answer!: (response: Response) => void, started!: () => void;
    let waiting = false;
    const pending = new Promise<Response>(resolve => { answer = resolve; });
    const sent = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (waiting) { started(); return pending; }
      return json(cloud);
    });
    const state = await setup(fetcher, cloud, undefined, true);
    state.client.stop();
    waiting = true;
    state.time(10_000);
    const reopened = state.make(2000);
    const loading = reopened.initialize();
    await sent;
    const tick = reopened.tick();
    state.time(12_000);
    cloud.serverTime = 12_000;
    answer(json(cloud));
    await loading; await tick;
    const recovered = { ...cloud.save, character: advanceCharacter(cloud.save.character, 2000) };
    expect((await state.read())!.save).toEqual(recovered);
    expect((await state.read())!.wallSavedAt).toBe(12_000);
    expect(reopened.getSnapshot()).toMatchObject({ onlineReady: true, onlineMessage: null, blocked: false });
    reopened.stop();
    waiting = false;
    state.time(13_000);
    cloud.serverTime = 13_000;
    const again = state.make();
    await again.initialize();
    expect((await state.read())!.save).toEqual({ ...cloud.save, character: advanceCharacter(recovered.character, 3000) });
    expect(again.getSnapshot()).toMatchObject({ onlineReady: true, onlineMessage: null });
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('retains small unsynchronized progress at the resume boundary and uploads it normally', async () => {
    const cloud = profile();
    cloud.serverTime = CLOUD_RESUME_TOLERANCE_MS;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === 'GET') return json(cloud);
      const request = JSON.parse(String(init?.body));
      cloud.save = request.save;
      cloud.revision = '1';
      return json({ characterId, requestId: request.requestId, revision: '1', savedAt: cloud.serverTime });
    });
    const state = await setup(fetcher, cloud, local => {
      local.save.character = advanceCharacter(local.save.character, CLOUD_RESUME_TOLERANCE_MS);
      local.save.playedMs = CLOUD_RESUME_TOLERANCE_MS;
      local.localRevision = '1';
    }, true);
    const admitted = (await state.read())!;
    expect(state.client.getSnapshot()).toMatchObject({ onlineReady: true, onlineMessage: null });
    expect(admitted).toMatchObject({ uploadedRevision: '0', localRevision: '1', cloudRevision: '0', pending: null });
    expect(admitted.save.playedMs).toBe(CLOUD_RESUME_TOLERANCE_MS);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    await state.client.sync();
    expect((await state.read())!).toMatchObject({ save: admitted.save, uploadedRevision: '1', cloudRevision: '1' });
    expect(cloud.save).toEqual(admitted.save);
    state.client.stop();
    const reopened = state.make();
    await reopened.initialize();
    expect(reopened.getSnapshot()).toMatchObject({ onlineReady: true, onlineMessage: null });
  });

  it('bounds resume tolerance without bypassing revisions, identities, timing or pending uploads', () => {
    const cloud = profile();
    cloud.serverTime = CLOUD_RESUME_TOLERANCE_MS;
    const local = localFromCloud(cloud, 0);
    local.save.character = advanceCharacter(local.save.character, CLOUD_RESUME_TOLERANCE_MS);
    local.save.playedMs = CLOUD_RESUME_TOLERANCE_MS;
    local.localRevision = '1';
    expect(matchesCloudCheckpoint(local, cloud)).toBe(true);
    for (const edit of [
      (changed: LocalSave) => { changed.save.character.simulation.clockMs++; },
      (changed: LocalSave) => { changed.save.playedMs++; },
      (changed: LocalSave) => { changed.save.playedMs = -1; },
      (changed: LocalSave) => { changed.cloudRevision = '1'; },
      (changed: LocalSave) => { changed.characterId = otherId; },
      (changed: LocalSave) => { changed.save.tradeRevision = '1'; },
      (changed: LocalSave) => { changed.save.character.life.number = '2'; },
      (changed: LocalSave) => { changed.save.character.fateId = cloud.save.character.fateId === 'light-step' ? 'strong-arms' : 'light-step'; },
      (changed: LocalSave) => { changed.syncConflict = 'another device'; },
      (changed: LocalSave) => { changed.pending = { localRevision: '1', request: {
        characterId, requestId: crypto.randomUUID(), baseRevision: '0', save: changed.save,
      } }; },
    ]) {
      const changed = structuredClone(local);
      edit(changed);
      expect(matchesCloudCheckpoint(changed, cloud)).toBe(false);
    }
    expect(matchesCloudCheckpoint(local, { ...cloud, serverTime: 0 })).toBe(false);
    expect(matchesCloudCheckpoint(local, { ...cloud, revision: '1' })).toBe(false);
    const behind = structuredClone(cloud);
    behind.save.character.simulation.clockMs = local.save.character.simulation.clockMs + 1;
    expect(matchesCloudCheckpoint(local, behind)).toBe(false);
  });

  it('does not create new local progress while waiting to adopt a cloud save', async () => {
    const cloud = profile();
    cloud.save.character = executeCharacterCommand(cloud.save.character, { type: 'withdraw' });
    let waiting = false, answer!: (response: Response) => void, started!: () => void;
    const pending = new Promise<Response>(resolve => { answer = resolve; });
    const sent = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (url === '/api/client/pvp') return json({ state: EMPTY_PVP, battleId: null, serverTime: cloud.serverTime });
      if (waiting) { started(); return pending; }
      return json(cloud);
    });
    const state = await setup(fetcher, cloud, local => { local.save.character.money = '1'; }, true);
    await state.client.inspectSaves();
    waiting = true;
    const choosing = state.client.chooseSave('cloud');
    await sent;
    state.time(30_000);
    cloud.serverTime = 30_000;
    answer(json(cloud));
    expect(await choosing).toBe(true);
    expect((await state.read())!.save).toEqual(cloud.save);
    expect(state.client.getSnapshot()).toMatchObject({ onlineReady: true, onlineMessage: null });
  });

  it('suspends online use after an uncertain upload and resumes on the original receipt without rolling back new local progress', async () => {
    const cloud = profile();
    let uploads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === 'GET') return json(cloud);
      if (++uploads === 1) throw new Error('offline');
      const input = JSON.parse(String(init?.body));
      return json({ characterId, requestId: input.requestId, revision: '1', savedAt: 2000 });
    });
    const state = await setup(fetcher, cloud, undefined, true);
    state.time(1000);
    await state.client.tick();
    await state.client.sync();
    expect(state.client.getSnapshot()).toMatchObject({ blocked: false, onlineReady: false, tradeStopped: true });
    const original = (await state.read())!.pending!.request;
    state.time(2000);
    await state.client.tick();
    const latest = (await state.read())!.save;
    expect(await state.client.prepareOnlineConnection()).toBe('1');
    const uploaded = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(uploaded).toHaveLength(2);
    expect(uploaded[0][1]!.body).toBe(JSON.stringify(original));
    expect(uploaded[1][1]!.body).toBe(uploaded[0][1]!.body);
    expect((await state.read())!).toMatchObject({ save: latest, pending: null, cloudRevision: '1' });
    expect(state.client.getSnapshot()).toMatchObject({ onlineReady: true, tradeStopped: false, onlineMessage: null });
  });
});
