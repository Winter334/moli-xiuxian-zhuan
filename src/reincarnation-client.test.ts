import { describe, expect, it, vi } from 'vitest';
import { createCharacter } from '../core/prototype/character-state';
import { executeDebugCommand } from '../core/prototype/debug';
import { SHOPS } from '../core/prototype/content';
import { reincarnateCharacter } from '../core/prototype/reincarnation';
import type { CloudProfile, SaveUpload } from '../shared/client-save';
import type { ConsignmentRequest } from '../shared/consignment';
import type { ReincarnationReceipt, ReincarnationRequest } from '../shared/reincarnation';
import { GameClient } from './game-client';
import { LOCAL_SAVE_KEY, LocalSaveStore, localFromCloud, type LocalSave, type SaveStorage } from './local-save';
import { reserveTrade } from './trade-reservation';

const characterId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const shopId = 'market-supplies' as const;
const json = (value: unknown) => new Response(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function receipt(request: ReincarnationRequest): ReincarnationReceipt {
  return {
    status: 'committed', characterId, requestId: request.requestId, settledAt: request.save.character.simulation.clockMs,
    fromLife: request.save.character.life.number, revision: String(BigInt(request.baseRevision) + 1n),
    save: { ...request.save, tradeRevision: String(BigInt(request.save.tradeRevision) + 1n),
      character: reincarnateCharacter(request.save.character, request.save.character.simulation.clockMs, 29) },
  };
}
async function setup(fetcher: typeof fetch, prepare?: (local: LocalSave) => void) {
  const initial: CloudProfile = { characterId, revision: '0', serverTime: 0,
    save: { format: 'opening-client-2', tradeRevision: '0', playedMs: 0, character: createCharacter(0, 19) } };
  const local = localFromCloud(initial, 0);
  prepare?.(local);
  const values = new Map<string, string>();
  let failWrite = false;
  const storage: SaveStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { if (failWrite) throw new Error('quota'); values.set(key, value); },
  };
  const store = new LocalSaveStore(storage);
  await store.load();
  await store.write(local);
  let now = 0;
  const make = (network = fetcher) => new GameClient({ fetcher: network, store: new LocalSaveStore(storage),
    wallNow: () => now, monotonicNow: () => now, acquireLock: async () => () => {} });
  const client = make();
  await client.initialize();
  return {
    client, make, storage,
    read: async () => (await new LocalSaveStore(storage).load())!,
    time: (value: number) => { now = value; },
    fail: (value: boolean) => { failWrite = value; },
  };
}

describe('durable client reincarnation', () => {
  it('freezes the persisted checkpoint before sending and exposes the new life only after local commit', async () => {
    const sent = deferred<ReincarnationRequest>();
    const answer = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      sent.resolve(JSON.parse(String(init!.body)));
      return answer.promise;
    });
    const { client, read, time } = await setup(fetcher);
    const work = client.submitReincarnation();
    const request = await sent.promise;
    const frozen = await read();
    expect(frozen.pendingReincarnation).toEqual(request);
    expect(client.submitReincarnation()).toBe(work);
    expect(client.getSnapshot()).toMatchObject({ blocked: true, reincarnationPending: true });
    time(5000);
    await client.tick();
    await client.sync();
    expect(await client.command({ type: 'recover', mode: 'sleep' })).toBe(false);
    expect(await client.submitTrade(shopId, { type: 'list',
      selection: { kind: 'stack', itemId: 'copper-coin', quantity: 1 }, unitPrice: '1' })).toBe(false);
    expect((await read()).save).toEqual(frozen.save);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const done = receipt(request);
    answer.resolve(json(done));
    expect(await work).toBe(true);
    const saved = await read();
    expect(saved.pendingReincarnation).toBeNull();
    expect(saved.save.character.life.number).toBe('2');
    expect(saved.save.playedMs).toBe(frozen.save.playedMs);
    expect(saved.localRevision).toBe(saved.uploadedRevision);
    expect(saved.worldClock.timeMs).toBe(5000);
    time(5001);
    await client.tick();
    expect((await read()).save.playedMs).toBe(1);
  });

  it('reopens without advancing the frozen life and looks up or resends exactly the original request', async () => {
    for (const known of [true, false]) {
      let body = '';
      let result!: ReincarnationReceipt;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        body = String(init!.body);
        result = receipt(JSON.parse(body));
        throw new TypeError('lost after commit');
      });
      const { client, make, read, time } = await setup(fetcher);
      expect(await client.submitReincarnation()).toBe(false);
      const before = await read();
      client.stop();
      await client.tick();
      time(86_400_000);
      const retry = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        if (String(url).includes('/receipts/')) return json(known ? { status: 'settled', receipt: result } : { status: 'unknown' });
        expect(String(init!.body)).toBe(body);
        return json(result);
      });
      const reopened = make(retry);
      await reopened.initialize();
      expect((await read()).save).toEqual(before.save);
      expect(reopened.getSnapshot().blocked).toBe(true);
      expect(await reopened.reconcileReincarnation()).toBe(true);
      expect(retry).toHaveBeenCalledTimes(known ? 1 : 2);
      expect((await read()).save.character.life.number).toBe('2');
      expect((await read()).save.playedMs).toBe(0);
    }
  });

  it('does not send an unsaved request or publish an unpersisted new fate, and recovers the committed receipt', async () => {
    let result!: ReincarnationReceipt;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes('/receipts/')) return json({ status: 'settled', receipt: result });
      result = receipt(JSON.parse(String(init!.body)));
      state.fail(true);
      return json(result);
    });
    const state = await setup(fetcher);
    state.fail(true);
    expect(await state.client.submitReincarnation()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    state.fail(false);
    await state.client.retry();
    expect(await state.client.submitReincarnation()).toBe(false);
    expect(state.client.getSnapshot()).toMatchObject({ blocked: true, response: { game: { life: { number: '1' } } } });
    const pending = (await state.read()).pendingReincarnation;
    expect(pending).not.toBeNull();
    state.fail(false);
    await state.client.retry();
    expect((await state.read()).save.character.life.number).toBe('2');
    expect((await state.read()).pendingReincarnation).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains mismatched receipts as a durable conflict instead of accepting a different transition', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const result = receipt(JSON.parse(String(init!.body)));
      if (result.status === 'committed') result.save.character.life.number = '3';
      return json(result);
    });
    const { client, make, read } = await setup(fetcher);
    expect(await client.submitReincarnation()).toBe(false);
    expect((await read()).pendingReincarnation).not.toBeNull();
    expect((await read()).syncConflict).toContain('轮回回执');
    client.stop();
    await client.tick();
    const reopened = make();
    await reopened.initialize();
    expect(reopened.getSnapshot().blocked).toBe(true);
    expect(await reopened.reconcileReincarnation()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the ending life on a definitive rejection and persists the cloud conflict before resuming local play', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init!.body)) as ReincarnationRequest;
      return json({ status: 'rejected', characterId, requestId: request.requestId, settledAt: 0,
        error: { code: 'SAVE_CONFLICT', message: '云端已有另一份进度' } });
    });
    const { client, read, make } = await setup(fetcher);
    const before = await read();
    expect(await client.submitReincarnation()).toBe(false);
    const after = await read();
    expect(after.save).toEqual(before.save);
    expect(after.pendingReincarnation).toBeNull();
    expect(after.syncConflict).toBe('云端已有另一份进度');
    expect(client.getSnapshot().blocked).toBe(false);
    expect(await client.command({ type: 'recover', mode: 'sleep' })).toBe(true);
    client.stop();
    await client.tick();
    const reopened = make();
    await reopened.initialize();
    expect(await reopened.submitReincarnation()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reconciles outstanding uploads and trades before freezing a new lifecycle request', async () => {
    for (const kind of ['upload', 'trade'] as const) {
      const urls: string[] = [];
      let lifecycleRequest!: ReincarnationRequest;
      let tradeRequest!: ConsignmentRequest;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        urls.push(String(url));
        if (String(url).includes('/consignment/receipts/')) {
          return json({ status: 'settled', receipt: {
            status: 'succeeded', characterId, requestId, settledAt: 0, revision: '1', tradeRevision: '1',
            delta: reserveTrade(tradeRequest, '0').expected, listingId: requestId, deliveryId: null,
          } });
        }
        const request = JSON.parse(String(init!.body)) as SaveUpload;
        if (String(url).endsWith('/save')) return json({ characterId, requestId, revision: '1', savedAt: 0 });
        lifecycleRequest = request;
        return json(receipt(request));
      });
      const { client, read } = await setup(fetcher, local => {
        const shop = SHOPS[shopId];
        local.save.character = executeDebugCommand(local.save.character, {
          type: 'region', regionId: shop.prerequisite!, operation: 'complete',
        });
        local.save.character.locationId = shop.locationId;
        const request: SaveUpload = { characterId, requestId, baseRevision: '0', save: structuredClone(local.save) };
        if (kind === 'upload') local.pending = { request, localRevision: '0' };
        else {
          tradeRequest = { ...request, shopId, command: {
            type: 'list', selection: { kind: 'stack', itemId: 'copper-coin', quantity: 1 }, unitPrice: '1',
          } };
          local.pendingTrade = reserveTrade(tradeRequest, '0');
        }
      });
      const before = await read();
      expect(await client.submitReincarnation()).toBe(true);
      expect(urls).toHaveLength(2);
      expect(urls[0]).toContain(kind === 'upload' ? '/save' : '/consignment/receipts/');
      expect(lifecycleRequest.baseRevision).toBe('1');
      if (kind === 'trade') {
        expect(lifecycleRequest.save.tradeRevision).toBe('1');
        expect(BigInt(lifecycleRequest.save.character.inventory['copper-coin'])).toBe(
          BigInt(before.save.character.inventory['copper-coin']) - 1n,
        );
      }
      expect((await read()).pending).toBeNull();
      expect((await read()).pendingTrade).toBeNull();
    }
  });

  it('ignores a stopped client response and keeps the same pending request available after reopening', async () => {
    const sent = deferred<ReincarnationRequest>();
    const answer = deferred<Response>();
    const { client, make, read, storage } = await setup(async (_url, init) => {
      sent.resolve(JSON.parse(String(init!.body)));
      return answer.promise;
    });
    const work = client.submitReincarnation();
    const request = await sent.promise;
    const before = storage.getItem(LOCAL_SAVE_KEY);
    client.stop();
    await client.tick();
    const done = receipt(request);
    answer.resolve(json(done));
    expect(await work).toBe(false);
    expect(storage.getItem(LOCAL_SAVE_KEY)).toBe(before);
    const reopened = make(async () => json({ status: 'settled', receipt: done }));
    await reopened.initialize();
    expect(await reopened.reconcileReincarnation()).toBe(true);
    expect((await read()).save.character.life.number).toBe('2');
  });
});
