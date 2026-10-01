import { describe, expect, it, vi } from 'vitest';
import { addInstance, createCharacter } from '../core/prototype/character-state';
import { SHOPS } from '../core/prototype/content';
import { executeDebugCommand } from '../core/prototype/debug';
import type { ConsignmentAsset } from '../core/prototype/consignment';
import type { CloudProfile, SaveUpload } from '../shared/client-save';
import type { ConsignmentReceipt, ConsignmentRequest } from '../shared/consignment';
import { GameClient } from './game-client';
import { LocalSaveStore, localFromCloud, type SaveStorage } from './local-save';
import { reserveTrade } from './trade-reservation';

const characterId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const shopId = 'market-supplies' as const;
const json = (data: unknown) => new Response(JSON.stringify(data));
const list = (quantity: number): ConsignmentRequest['command'] =>
  ({ type: 'list', selection: { kind: 'stack', itemId: 'copper-coin', quantity }, unitPrice: '1' });
const claim: ConsignmentRequest['command'] = { type: 'claim', deliveryId: assetId, quantity: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function profile(): CloudProfile {
  const shop = SHOPS[shopId];
  const character = executeDebugCommand(createCharacter(0, 19), { type: 'region', regionId: shop.prerequisite!, operation: 'complete' });
  character.locationId = shop.locationId;
  character.inventory['copper-coin'] = '100';
  character.money = '1000';
  return { characterId, revision: '0', serverTime: 0,
    save: { format: 'opening-client-2', tradeRevision: '0', playedMs: 0, character } };
}
function receipt(request: ConsignmentRequest, asset?: ConsignmentAsset): ConsignmentReceipt {
  return {
    status: 'succeeded', characterId, requestId: request.requestId, settledAt: 0,
    revision: String(BigInt(request.baseRevision) + 1n), tradeRevision: String(BigInt(request.save.tradeRevision) + 1n),
    delta: reserveTrade(request, '0', asset).expected,
    listingId: request.command.type === 'claim' ? null : assetId,
    deliveryId: request.command.type === 'claim' ? request.command.deliveryId : null,
  };
}
async function setup(fetcher: typeof fetch, initial = profile()) {
  const values = new Map<string, string>();
  const storage: SaveStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  const seed = new LocalSaveStore(storage);
  await seed.load();
  await seed.write(localFromCloud(initial, 0));
  let now = 0;
  const make = (network = fetcher) => new GameClient({ store: new LocalSaveStore(storage), fetcher: network,
    wallNow: () => now, monotonicNow: () => now, acquireLock: async () => () => {} });
  const client = make();
  await client.initialize();
  return { client, make, storage, read: async () => (await new LocalSaveStore(storage).load())!, time: (value: number) => { now = value; } };
}

describe('durable client consignment', () => {
  it('reserves before sending, protects assets and applies a receipt to later local progress only once', async () => {
    const sent = deferred<ConsignmentRequest>();
    const answer = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/save')) {
        const request = JSON.parse(String(init!.body)) as SaveUpload;
        return json({ characterId, requestId: request.requestId, revision: '2', savedAt: 0 });
      }
      sent.resolve(JSON.parse(String(init!.body)));
      return answer.promise;
    });
    const { client, read } = await setup(fetcher);
    const work = client.submitTrade(shopId, list(40));
    const request = await sent.promise;
    expect((await read()).pendingTrade!.request).toEqual(request);
    expect(request.save.character.inventory['copper-coin']).toBe('100');
    expect(client.getSnapshot().response!.game.inventory.find(item => item.itemId === 'copper-coin')!.quantity).toBe('60');
    expect(await client.command({ type: 'sell', shopId, target: { kind: 'stack', itemId: 'copper-coin' }, quantity: 61 })).toBe(false);
    expect(await client.command({ type: 'sell', shopId, target: { kind: 'stack', itemId: 'copper-coin' }, quantity: 10 })).toBe(true);
    expect(await client.command({ type: 'travel', locationId: 'qingshi-village' })).toBe(true);
    const later = await read();
    await client.sync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    answer.resolve(json(receipt(request)));
    expect(await work).toBe(true);
    const after = await read();
    expect(after.save.character.locationId).toBe('qingshi-village');
    expect(after.save.character.money).toBe(later.save.character.money);
    expect(after.save.character.history).toEqual(later.save.character.history);
    expect(after.save.character.inventory['copper-coin']).toBe('50');
    expect(after.pendingTrade).toBeNull();
    expect(after.cloudRevision).toBe('1');
    expect(after.save.tradeRevision).toBe('1');
    expect(await client.reconcileTrade()).toBe(false);
    expect(await read()).toEqual(after);
    await client.sync();
    const upload = JSON.parse(String(fetcher.mock.calls[1][1]!.body)) as SaveUpload;
    expect(upload.baseRevision).toBe('1');
    expect(upload.save).toEqual(after.save);
  });

  it('recovers an accepted timeout by lookup and resends the identical request when lookup is unknown', async () => {
    for (const known of [true, false]) {
      let body = '';
      let result: ConsignmentReceipt;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        body = String(init!.body);
        result = receipt(JSON.parse(body));
        throw new TypeError('connection lost after commit');
      });
      const { client, make, read } = await setup(fetcher);
      expect(await client.submitTrade(shopId, list(40))).toBe(false);
      const pending = (await read()).pendingTrade!;
      expect(await client.command({ type: 'sell', shopId, target: { kind: 'stack', itemId: 'copper-coin' }, quantity: 10 })).toBe(true);
      client.stop();
      await client.tick();
      const retry = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        if (String(url).includes('/receipts/')) return json(known ? { status: 'settled', receipt: result } : { status: 'unknown' });
        expect(String(init!.body)).toBe(body);
        return json(result);
      });
      const reopened = make(retry);
      await reopened.initialize();
      expect((await read()).pendingTrade).toEqual(pending);
      expect(await reopened.reconcileTrade()).toBe(true);
      expect(retry).toHaveBeenCalledTimes(known ? 1 : 2);
      expect((await read()).save.character.inventory['copper-coin']).toBe('50');
      expect((await read()).pendingTrade).toBeNull();
    }
  });

  it('releases rejected money reservations without rolling back local earnings and persists conflicts', async () => {
    const sent = deferred<ConsignmentRequest>();
    const answer = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      sent.resolve(JSON.parse(String(init!.body)));
      return answer.promise;
    });
    const { client, read, make } = await setup(fetcher);
    const work = client.submitTrade(shopId, { type: 'buy', listingId: assetId, unitPrice: '10', quantity: 90 });
    const request = await sent.promise;
    expect(client.getSnapshot().response!.game.money).toBe('100');
    expect(await client.command({ type: 'sell', shopId, target: { kind: 'stack', itemId: 'copper-coin' }, quantity: 10 })).toBe(true);
    expect(client.getSnapshot().response!.game.money).toBe('110');
    answer.resolve(json({ status: 'rejected', characterId, requestId: request.requestId, settledAt: 0,
      error: { code: 'INSUFFICIENT_STOCK', message: '余量不足' } }));
    expect(await work).toBe(false);
    expect(client.getSnapshot().response!.game.money).toBe('1010');
    expect((await read()).pendingTrade).toBeNull();
    expect((await read()).syncConflict).toBeNull();
    client.stop();
    await client.tick();
    const conflictFetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init!.body)) as ConsignmentRequest;
      return json({ status: 'rejected', characterId, requestId: request.requestId, settledAt: 0,
        error: { code: 'SAVE_CONFLICT', message: '云端冲突' } });
    });
    const second = make(conflictFetcher);
    await second.initialize();
    expect(await second.submitTrade(shopId, list(1))).toBe(false);
    expect((await read()).syncConflict).toBe('云端冲突');
    second.stop();
    await second.tick();
    const third = make(conflictFetcher);
    await third.initialize();
    await third.sync();
    expect(await third.submitTrade(shopId, list(1))).toBe(false);
    expect(conflictFetcher).toHaveBeenCalledTimes(1);
    expect(await third.command({ type: 'travel', locationId: 'qingshi-village' })).toBe(true);
  });

  it('preserves claim headroom and allocates received instances after intervening local creation', async () => {
    vi.stubEnv('DEV', true);
    try {
      const initial = profile();
      initial.save.character.money = '999999999999';
      let asset: ConsignmentAsset = { kind: 'money' };
      let resolve!: (value: Response) => void;
      let submitted = deferred<ConsignmentRequest>();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        const response = new Promise<Response>(done => { resolve = done; });
        submitted.resolve(JSON.parse(String(init!.body)));
        return response;
      });
      const { client, read } = await setup(fetcher, initial);
      let work = client.submitTrade(shopId, claim, asset);
      let request = await submitted.promise;
      const before = await read();
      expect(await client.command({ type: 'sell', shopId, target: { kind: 'stack', itemId: 'copper-coin' }, quantity: 1 })).toBe(false);
      expect(await read()).toEqual(before);
      expect(await client.command({ type: 'recover', mode: 'rest' })).toBe(true);
      resolve(json(receipt(request, asset)));
      expect(await work).toBe(true);
      expect((await read()).save.character.money).toBe('1000000000000');

      asset = { kind: 'instance', itemId: 'old-wood-hilt', quality: 100 };
      submitted = deferred<ConsignmentRequest>();
      work = client.submitTrade(shopId, claim, asset);
      request = await submitted.promise;
      expect(await client.debugCommand({ type: 'item', itemId: 'old-wood-hilt', quantity: 1, quality: 100 })).toBe(true);
      const during = await read();
      const nextId = `item-${during.save.character.nextInstanceId}`;
      resolve(json(receipt(request, asset)));
      expect(await work).toBe(true);
      const after = await read();
      expect(after.save.character.instances[nextId]).toEqual({ itemId: asset.itemId, quality: asset.quality });
      for (const [id, item] of Object.entries(during.save.character.instances)) expect(after.save.character.instances[id]).toEqual(item);
      expect(after.save.character.history).toEqual(during.save.character.history);
    } finally { vi.unstubAllEnvs(); }
  });

  it('keeps listed instance identities on rejection and reserves total instance capacity including shop stock', async () => {
    const initial = profile();
    const state = initial.save.character;
    const id = addInstance(state, state.instances, 'old-wood-hilt', 100);
    state.shop.dayIndex = 0;
    for (let index = 0; index < 998; index++) addInstance(state, state.shop.instances, 'old-wood-hilt', 100);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const { client, read } = await setup(fetcher, initial);
    expect(await client.submitTrade(shopId, { type: 'list', selection: { kind: 'instance', instanceId: id }, unitPrice: '100' })).toBe(false);
    expect(client.getSnapshot().response!.game.instances.some(item => item.instanceId === id)).toBe(false);
    expect(await client.command({ type: 'sell', shopId, target: { kind: 'instance', instanceId: id }, quantity: 1 })).toBe(false);
    const pending = (await read()).pendingTrade!;
    fetcher.mockResolvedValueOnce(json({ status: 'settled', receipt: {
      status: 'rejected', characterId, requestId: pending.request.requestId, settledAt: 0,
      error: { code: 'LISTING_LIMIT', message: '货单已满' },
    } }));
    expect(await client.reconcileTrade()).toBe(false);
    expect((await read()).save.character.instances[id]).toEqual(state.instances[id]);
    expect((await read()).pendingTrade).toBeNull();
    const raw: ConsignmentRequest = { ...pending.request, command: claim };
    const reserved = reserveTrade(raw, '0', { kind: 'instance', itemId: 'old-wood-hilt', quality: 100 });
    expect(reserved.expected.credit?.quantity).toBe('1');
    addInstance(raw.save.character, raw.save.character.shop.instances, 'old-wood-hilt', 100);
    expect(() => reserveTrade(raw, '0', reserved.expected.credit!.asset)).toThrow('存档上限');
  });

  it('finishes an existing upload before trading and ignores late responses after stop', async () => {
    const uploadSent = deferred<SaveUpload>();
    const uploadAnswer = deferred<Response>();
    const tradeSent = deferred<ConsignmentRequest>();
    const tradeAnswer = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/save')) {
        uploadSent.resolve(JSON.parse(String(init!.body)));
        return uploadAnswer.promise;
      }
      tradeSent.resolve(JSON.parse(String(init!.body)));
      return tradeAnswer.promise;
    });
    const { client, read } = await setup(fetcher);
    await client.command({ type: 'recover', mode: 'rest' });
    const uploadWork = client.sync();
    const upload = await uploadSent.promise;
    const work = client.submitTrade(shopId, list(1));
    expect((await read()).pendingTrade).toBeNull();
    uploadAnswer.resolve(json({ characterId, requestId: upload.requestId, revision: '1', savedAt: 0 }));
    await uploadWork;
    const request = await tradeSent.promise;
    expect(request.baseRevision).toBe('1');
    expect((await read()).pending).toBeNull();
    client.stop();
    await client.tick();
    const stopped = await read();
    tradeAnswer.resolve(json(receipt(request)));
    expect(await work).toBe(false);
    expect(await read()).toEqual(stopped);
  });

  it('refuses mismatched receipts without releasing escrow or allowing ordinary uploads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init!.body)) as ConsignmentRequest;
      const result = receipt(request);
      if (result.status === 'succeeded') result.delta.debit = null;
      return json(result);
    });
    const { client, read } = await setup(fetcher);
    expect(await client.submitTrade(shopId, list(1))).toBe(false);
    expect((await read()).pendingTrade).not.toBeNull();
    expect((await read()).syncConflict).not.toBeNull();
    expect(client.getSnapshot().tradeStopped).toBe(true);
    await client.sync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await client.command({ type: 'recover', mode: 'rest' })).toBe(true);
  });

  it('does not send without a durable reservation and retains it if receipt persistence fails', async () => {
    const sent = deferred<ConsignmentRequest>();
    const answer = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      sent.resolve(JSON.parse(String(init!.body)));
      return answer.promise;
    });
    const { client, read, storage, make } = await setup(fetcher);
    const write = storage.setItem;
    const original = await read();
    storage.setItem = () => { throw new Error('quota'); };
    expect(await client.submitTrade(shopId, list(1))).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await read()).toEqual(original);
    storage.setItem = write;
    client.stop();
    await client.tick();
    const reopened = make();
    await reopened.initialize();
    const work = reopened.submitTrade(shopId, list(1));
    const request = await sent.promise;
    const reserved = await read();
    storage.setItem = () => { throw new Error('quota'); };
    answer.resolve(json(receipt(request)));
    expect(await work).toBe(false);
    expect(await read()).toEqual(reserved);
    expect(reopened.getSnapshot().blocked).toBe(true);
    storage.setItem = write;
    reopened.stop();
    await reopened.tick();
    const finalClient = make(vi.fn<typeof fetch>().mockResolvedValue(json({ status: 'settled', receipt: receipt(request) })));
    await finalClient.initialize();
    expect(await finalClient.reconcileTrade()).toBe(true);
    expect((await read()).save.character.inventory['copper-coin']).toBe('99');
  });

  it('discards a late market response after leaving the merchant without uploading or changing progress', async () => {
    const sent = deferred<void>();
    const answer = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { sent.resolve(); return answer.promise; });
    const { client, read } = await setup(fetcher);
    const loading = client.loadConsignment(shopId, 'market', 0, {});
    const rejected = expect(loading).rejects.toThrow('页面已变化');
    await sent.promise;
    expect(await client.command({ type: 'travel', locationId: 'qingshi-village' })).toBe(true);
    const later = await read();
    answer.resolve(json({ scope: 'development', view: 'market', page: 0, hasMore: false, activeCount: 0, slots: 20,
      listings: [], deliveries: [], totals: { purchaseSpent: '0', saleGross: '0', saleFees: '0', saleNet: '0' } }));
    await rejected;
    expect(await read()).toEqual(later);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/client/consignment/view');
  });
});
