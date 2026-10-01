import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { addInstance, createCharacter, synchronizeCharacter } from '../../core/prototype/character-state';
import { executeDebugCommand } from '../../core/prototype/debug';
import { ITEMS, MANOR_AID, SHOPS } from '../../core/prototype/content';
import { consignmentFee, CONSIGNMENT_SLOTS } from '../../core/prototype/consignment';
import { itemValue } from '../../core/prototype/equipment';
import { readClientSave, type ClientSave } from '../../shared/client-save';
import {
  CONSIGNMENT_PAGE_SIZE, type ConsignmentDelivery, type ConsignmentFill, type ConsignmentListing,
  type ConsignmentReceipt, type ConsignmentRequest, type ConsignmentTotals,
} from '../../shared/consignment';
import { ConsignmentService } from '../../server/client/consignment';
import {
  type ConsignmentStore, type ConsignmentTransaction, type ListingQuery, type StoredConsignmentReceipt,
} from '../../server/client/consignment-store';
import type { CloudSnapshot, CloudStore } from '../../server/client/repository';
import { ClientSaveService } from '../../server/client/service';
import { ReincarnationService } from '../../server/client/reincarnation';
import type { ReincarnationStore, StoredReincarnationReceipt } from '../../server/client/reincarnation-store';
import type { ReincarnationRequest } from '../../shared/reincarnation';
import { developmentProfile } from '../../server/client/player-profile';

const seller = '00000000-0000-4000-8000-000000000001';
const buyer = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const shopId = 'market-supplies' as const;
const now = 20_000;
const initial = (): ClientSave => {
  const shop = SHOPS[shopId];
  const character = executeDebugCommand(createCharacter(0, 19), { type: 'region', regionId: shop.prerequisite!, operation: 'complete' });
  character.locationId = shop.locationId;
  character.inventory['copper-coin'] = '100';
  character.money = '1000';
  return readClientSave({ format: 'opening-client-2', tradeRevision: '0', character, playedMs: 0 });
};

// Copy-on-commit store exercises service atomicity; it does not simulate PostgreSQL row locks.
class MemoryStore implements ConsignmentStore, CloudStore {
  readonly scope = { kind: 'development' as const };
  data = {
    characters: new Map<string, CloudSnapshot>(),
    listings: new Map<string, ConsignmentListing>(),
    deliveries: new Map<string, ConsignmentDelivery>(),
    receipts: new Map<string, StoredConsignmentReceipt>(),
    fills: [] as ConsignmentFill[],
    reincarnations: new Map<string, StoredReincarnationReceipt>(),
  };
  failReceipt = false;
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  put(id: string, save = initial()) {
    this.data.characters.set(id, { save: structuredClone(save), revision: '0', receivedAt: 0, lastRequestId: null, lastPayloadHash: null });
  }
  async createSession(): Promise<{ token: string; characterId: string }> { throw new Error('unused'); }
  async load(id: string) { return structuredClone(this.data.characters.get(id)!); }
  async commit(id: string, expected: string, save: ClientSave, receivedAt: number, requestId: string, hash: string) {
    return this.serial(async () => {
      if (this.data.characters.get(id)?.revision !== expected) return false;
      this.data.characters.set(id, { save: structuredClone(save), revision: String(BigInt(expected) + 1n),
        receivedAt, lastRequestId: requestId, lastPayloadHash: hash });
      return true;
    });
  }
  transact<T>(id: string, work: (tx: ConsignmentTransaction) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const data = structuredClone(this.data);
      const snapshot = data.characters.get(id)!;
      const result = await work({
        snapshot,
        receipt: async requestId => structuredClone(data.receipts.get(`${id}:${requestId}`) ?? null),
        activeCount: async () => [...data.listings.values()].filter(row => row.sellerId === id && row.status === 'active').length,
        listing: async key => structuredClone(data.listings.get(key) ?? null),
        delivery: async key => structuredClone(data.deliveries.get(key) ?? null),
        apply: async (plan, receivedAt) => {
          if (plan.listing) data.listings.set(plan.listing.state.id, structuredClone(plan.listing.state));
          for (const delivery of plan.deliveries) data.deliveries.set(delivery.id, structuredClone(delivery));
          if (plan.claimed) data.deliveries.set(plan.claimed.id, structuredClone(plan.claimed));
          if (plan.fill) data.fills.push(structuredClone(plan.fill));
          data.characters.set(id, { save: structuredClone(plan.save), revision: String(BigInt(snapshot.revision) + 1n),
            receivedAt, lastRequestId: null, lastPayloadHash: null });
        },
        record: async (hash, receipt) => {
          if (this.failReceipt) { this.failReceipt = false; throw new Error('receipt storage unavailable'); }
          data.receipts.set(`${id}:${receipt.requestId}`, { hash, receipt: structuredClone(receipt) });
        },
      });
      this.data = data;
      return result;
    });
  }
  async receipt(id: string, requestId: string) { return structuredClone(this.data.receipts.get(`${id}:${requestId}`) ?? null); }
  async activeCount(id: string) { return [...this.data.listings.values()].filter(row => row.sellerId === id && row.status === 'active').length; }
  async listings(query: ListingQuery) {
    return structuredClone([...this.data.listings.values()].filter(row =>
      (query.sellerId ? row.sellerId === query.sellerId : row.status === 'active') &&
      query.itemIds.includes(row.asset.itemId) &&
      (query.minQuality === undefined || row.asset.kind === 'instance' && row.asset.quality >= query.minQuality) &&
      (query.maxQuality === undefined || row.asset.kind === 'instance' && row.asset.quality <= query.maxQuality) &&
      (query.minPrice === undefined || BigInt(row.unitPrice) >= BigInt(query.minPrice)) &&
      (query.maxPrice === undefined || BigInt(row.unitPrice) <= BigInt(query.maxPrice)),
    ).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .slice(query.page * CONSIGNMENT_PAGE_SIZE, (query.page + 1) * CONSIGNMENT_PAGE_SIZE + 1)
      .map(row => ({ ...row, sellerProfile: developmentProfile(row.sellerId) })));
  }
  async deliveries(id: string, page: number) {
    return structuredClone([...this.data.deliveries.values()].filter(row => row.ownerId === id && BigInt(row.quantity) > 0n)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .slice(page * CONSIGNMENT_PAGE_SIZE, (page + 1) * CONSIGNMENT_PAGE_SIZE + 1));
  }
  async totals(id: string): Promise<ConsignmentTotals> {
    const sum = (side: 'buyerId' | 'sellerId', key: 'gross' | 'fee' | 'net') =>
      String(this.data.fills.filter(row => row[side] === id).reduce((total, row) => total + BigInt(row[key]), 0n));
    return { purchaseSpent: sum('buyerId', 'gross'), saleGross: sum('sellerId', 'gross'),
      saleFees: sum('sellerId', 'fee'), saleNet: sum('sellerId', 'net') };
  }
  async request(id: string, command: ConsignmentRequest['command']): Promise<ConsignmentRequest> {
    const snapshot = await this.load(id);
    return { characterId: id, requestId: randomUUID(), baseRevision: snapshot.revision,
      save: readClientSave(snapshot.save), shopId, command };
  }
  lifecycle(): ReincarnationStore {
    return {
      receipt: async (id, requestId) => structuredClone(this.data.reincarnations.get(`${id}:${requestId}`) ?? null),
      transact: (id, work) => this.serial(async () => {
        const data = structuredClone(this.data);
        const snapshot = data.characters.get(id)!;
        const result = await work({
          snapshot,
          receipt: async key => structuredClone(data.reincarnations.get(`${id}:${key}`) ?? null),
          replaceLife: async (save, receivedAt) => {
            for (const row of data.listings.values()) {
              if (row.sellerId === id && row.status === 'active') {
                row.remaining = 0;
                row.status = 'cancelled';
                row.updatedAt = Math.max(row.updatedAt, receivedAt);
              }
            }
            for (const row of data.deliveries.values()) if (row.ownerId === id) row.quantity = '0';
            data.characters.set(id, { save: structuredClone(save), revision: String(BigInt(snapshot.revision) + 1n),
              receivedAt, lastRequestId: null, lastPayloadHash: null });
          },
          record: async (hash, receipt) => {
            if (this.failReceipt) { this.failReceipt = false; throw new Error('receipt storage unavailable'); }
            data.reincarnations.set(`${id}:${receipt.requestId}`, { hash, receipt: structuredClone(receipt) });
          },
        });
        this.data = data;
        return result;
      }),
    };
  }
}

function setup() {
  const store = new MemoryStore();
  for (const id of [seller, buyer, other]) store.put(id);
  return { store, service: new ConsignmentService(store, () => now) };
}
function succeeded(receipt: ConsignmentReceipt) {
  expect(receipt.status).toBe('succeeded');
  if (receipt.status !== 'succeeded') throw new Error(receipt.error.message);
  return receipt;
}
const listing = (quantity: number, unitPrice = '1'): ConsignmentRequest['command'] =>
  ({ type: 'list', selection: { kind: 'stack', itemId: 'copper-coin', quantity }, unitPrice });

describe('reincarnation transaction contracts', () => {
  async function request(store: MemoryStore, id = seller): Promise<ReincarnationRequest> {
    const snapshot = await store.load(id);
    return { characterId: id, requestId: randomUUID(), baseRevision: snapshot.revision, save: readClientSave(snapshot.save) };
  }

  it('clears only ending-life consignment assets, keeps completed transfers and records one immutable new life', async () => {
    const { store, service } = setup();
    const posted = succeeded(await service.execute(seller, await store.request(seller, listing(60))));
    succeeded(await service.execute(buyer, await store.request(buyer,
      { type: 'buy', listingId: posted.listingId!, quantity: 20, unitPrice: '1' })));
    const withdrawn = succeeded(await service.execute(seller, await store.request(seller, listing(5))));
    succeeded(await service.execute(seller, await store.request(seller, { type: 'cancel', listingId: withdrawn.listingId! })));
    const buyerBefore = await store.load(buyer);
    const buyerDeliveries = await store.deliveries(buyer, 0);
    const totals = await store.totals(seller);
    const oldTrade = structuredClone(store.data.receipts);
    const oldFills = structuredClone(store.data.fills);
    const seed = vi.fn(() => 29);
    const lifecycle = new ReincarnationService(store.lifecycle(), () => now, seed);
    const input = await request(store);
    const done = await lifecycle.execute(seller, input);
    expect(done.status).toBe('committed');
    if (done.status !== 'committed') throw new Error('expected commit');
    expect(await lifecycle.execute(seller, input)).toEqual(done);
    expect(await lifecycle.lookup(seller, input.requestId)).toEqual({ status: 'settled', receipt: done });
    expect(seed).toHaveBeenCalledTimes(1);
    expect(done.save.character.life.number).toBe('2');
    expect(done.save.character.history).toEqual(input.save.character.history);
    expect(await store.activeCount(seller)).toBe(0);
    expect(await store.deliveries(seller, 0)).toEqual([]);
    expect(await store.load(buyer)).toEqual(buyerBefore);
    expect(await store.deliveries(buyer, 0)).toEqual(buyerDeliveries);
    expect(await store.totals(seller)).toEqual(totals);
    expect(store.data.receipts).toEqual(oldTrade);
    expect(store.data.fills).toEqual(oldFills);
    expect(await service.execute(buyer, await store.request(buyer,
      { type: 'buy', listingId: posted.listingId!, quantity: 1, unitPrice: '1' }))).toMatchObject({ status: 'rejected' });
    const after = await lifecycle.execute(seller, await request(store));
    expect(after).toMatchObject({ status: 'committed', save: { character: { life: { number: '3' } } } });
    expect(await lifecycle.execute(seller, input)).toEqual(done);
    expect(readClientSave((await store.load(seller)).save).character.life.number).toBe('3');
  });

  it('rolls back cleanup, snapshot and receipt together; stale checkpoints cannot resurrect an old life', async () => {
    const { store, service } = setup();
    await service.execute(seller, await store.request(seller, listing(10)));
    const lifecycle = new ReincarnationService(store.lifecycle(), () => now, () => 29);
    const input = await request(store);
    const before = structuredClone(store.data);
    store.failReceipt = true;
    await expect(lifecycle.execute(seller, input)).rejects.toThrow('receipt storage');
    expect(store.data).toEqual(before);
    expect(await lifecycle.lookup(seller, input.requestId)).toEqual({ status: 'unknown' });
    expect(await lifecycle.execute(seller, input)).toMatchObject({ status: 'committed' });
    const after = await store.load(seller);
    const rejected = { ...input, requestId: randomUUID() };
    expect(await lifecycle.execute(seller, rejected)).toMatchObject({ status: 'rejected', error: { code: 'SAVE_CONFLICT' } });
    expect(await store.load(seller)).toEqual(after);
    const cloud = new ClientSaveService(store, () => now);
    await expect(cloud.upload(seller, { ...input, requestId: randomUUID() })).rejects.toThrow();
    await expect(lifecycle.execute(seller, { ...input, save: { ...input.save, playedMs: 1 } })).rejects.toThrow('原请求');
    await expect(lifecycle.execute(buyer, input)).rejects.toThrow('身份');
    expect(await store.load(seller)).toEqual(after);
  });
});

describe('consignment transaction contracts', () => {
  it('escrows, sells in parts, cancels and claims without duplicating fees or changing offline sellers', async () => {
    const { store, service } = setup();
    const before = readClientSave((await store.load(seller)).save);
    const listed = succeeded(await service.execute(seller, await store.request(seller, listing(60))));
    const escrowed = await store.load(seller);
    expect(readClientSave(escrowed.save).character.inventory['copper-coin']).toBe('40');
    for (const quantity of [30, 20]) {
      succeeded(await service.execute(buyer, await store.request(buyer,
        { type: 'buy', listingId: listed.listingId!, quantity, unitPrice: '1' })));
    }
    expect(await store.load(seller)).toEqual(escrowed);
    expect(await store.totals(seller)).toMatchObject({ saleGross: '50', saleFees: consignmentFee('50'), saleNet: '49' });
    expect(store.data.fills.map(row => row.fee)).toEqual(['1', '0']);
    const pendingBuyer = await store.deliveries(buyer, 0);
    expect(pendingBuyer.reduce((sum, row) => sum + Number(row.quantity), 0)).toBe(50);
    expect(readClientSave((await store.load(buyer)).save).character.inventory).toEqual(before.character.inventory);
    succeeded(await service.execute(seller, await store.request(seller, { type: 'cancel', listingId: listed.listingId! })));
    expect(await store.activeCount(seller)).toBe(0);
    for (const id of [seller, buyer]) {
      for (const delivery of await store.deliveries(id, 0)) {
        succeeded(await service.execute(id, await store.request(id,
          { type: 'claim', deliveryId: delivery.id, quantity: Number(delivery.quantity) })));
      }
    }
    const afterSeller = readClientSave((await store.load(seller)).save).character;
    const afterBuyer = readClientSave((await store.load(buyer)).save).character;
    expect(afterSeller.money).toBe('1049');
    expect(afterBuyer.money).toBe('950');
    expect(BigInt(afterSeller.money) + BigInt(afterBuyer.money) + 1n).toBe(2000n);
    expect(afterSeller.inventory['copper-coin']).toBe('50');
    expect(afterBuyer.inventory['copper-coin']).toBe('150');
    expect(afterSeller.skills).toEqual(before.character.skills);
    expect(afterSeller.history).toEqual(before.character.history);
    expect(afterBuyer.history).toEqual(before.character.history);
    expect(await store.deliveries(seller, 0)).toEqual([]);
    expect(await store.totals(buyer)).toMatchObject({ purchaseSpent: '50' });
  });

  it('enforces ownership, real-quality price floors, merchant access and recipient-local instance IDs', async () => {
    const { store, service } = setup();
    const prepared = initial();
    const itemId = Object.keys(ITEMS).find(id => ITEMS[id].kind === 'equipment' && ITEMS[id].slot === 'body')!;
    const uid = addInstance(prepared.character, prepared.character.instances, itemId, 120);
    store.put(seller, prepared);
    const price = itemValue(itemId, 120);
    const command: ConsignmentRequest['command'] = { type: 'list', selection: { kind: 'instance', instanceId: uid }, unitPrice: price };
    const low = { ...command, unitPrice: String(BigInt(price) - 1n) };
    expect(await service.execute(seller, await store.request(seller, low))).toMatchObject({ status: 'rejected', error: { code: 'PRICE_TOO_LOW' } });
    const equipped = await store.request(seller, command);
    equipped.save.character.equipment.body = uid;
    synchronizeCharacter(equipped.save.character);
    expect(await service.execute(seller, equipped)).toMatchObject({ status: 'rejected' });
    const away = await store.request(seller, command);
    away.save.character.locationId = 'qingshi-village';
    expect(await service.execute(seller, away)).toMatchObject({ status: 'rejected' });
    const listed = succeeded(await service.execute(seller, await store.request(seller, command)));
    const funded = initial();
    funded.character.money = price;
    addInstance(funded.character, funded.character.instances, itemId, 80);
    store.put(buyer, funded);
    expect(await service.execute(seller, await store.request(seller,
      { type: 'buy', listingId: listed.listingId!, unitPrice: price, quantity: 1 }))).toMatchObject({ status: 'rejected', error: { code: 'OWN_LISTING' } });
    succeeded(await service.execute(buyer, await store.request(buyer,
      { type: 'buy', listingId: listed.listingId!, unitPrice: price, quantity: 1 })));
    const [delivery] = await store.deliveries(buyer, 0);
    expect(await service.execute(other, await store.request(other,
      { type: 'claim', deliveryId: delivery.id, quantity: 1 }))).toMatchObject({ status: 'rejected' });
    succeeded(await service.execute(buyer, await store.request(buyer, { type: 'claim', deliveryId: delivery.id, quantity: 1 })));
    expect(readClientSave((await store.load(buyer)).save).character.instances).toEqual({
      'item-1': { itemId, quality: 80 }, 'item-2': { itemId, quality: 120 },
    });
    const seal = initial();
    const sealId = addInstance(seal.character, seal.character.instances, MANOR_AID.itemId, 100);
    store.put(other, seal);
    expect(await service.execute(other, await store.request(other,
      { type: 'list', selection: { kind: 'instance', instanceId: sealId }, unitPrice: '1000000000000' }))).toMatchObject({ status: 'rejected' });
  });

  it('serializes competing purchases and withdrawal without overselling or returning sold stock', async () => {
    const { store, service } = setup();
    const listed = succeeded(await service.execute(seller, await store.request(seller, listing(3))));
    const requests = await Promise.all([buyer, other].map(id => store.request(id,
      { type: 'buy', listingId: listed.listingId!, quantity: 2, unitPrice: '1' })));
    const results = await Promise.all(requests.map(request => service.execute(request.characterId, request)));
    expect(results.map(row => row.status).sort()).toEqual(['rejected', 'succeeded']);
    const loser = results[0].status === 'rejected' ? buyer : other;
    await Promise.all([
      store.request(loser, { type: 'buy', listingId: listed.listingId!, quantity: 1, unitPrice: '1' })
        .then(request => service.execute(loser, request)),
      store.request(seller, { type: 'cancel', listingId: listed.listingId! })
        .then(request => service.execute(seller, request)),
    ]);
    const bought = store.data.fills.reduce((sum, row) => sum + row.quantity, 0);
    const returned = (await store.deliveries(seller, 0)).filter(row => row.asset.kind === 'stack')
      .reduce((sum, row) => sum + Number(row.quantity), 0);
    expect(bought + returned).toBe(3);
    expect(store.data.listings.get(listed.listingId!)!.remaining).toBe(0);
  });

  it('persists terminal receipts, rolls back storage failures and rejects stale trade versions in cloud uploads', async () => {
    const { store, service } = setup();
    const request = await store.request(seller, listing(5));
    const before = structuredClone(store.data);
    store.failReceipt = true;
    await expect(service.execute(seller, request)).rejects.toThrow('receipt storage unavailable');
    expect(store.data).toEqual(before);
    expect(await service.lookup(seller, request.requestId)).toEqual({ status: 'unknown' });
    const results = await Promise.all([service.execute(seller, request), service.execute(seller, request)]);
    expect(results[0]).toEqual(results[1]);
    succeeded(results[0]);
    expect(store.data.listings.size).toBe(1);
    expect(await service.lookup(buyer, request.requestId)).toEqual({ status: 'unknown' });
    expect(await new ConsignmentService(store).lookup(seller, request.requestId)).toEqual({ status: 'settled', receipt: results[0] });
    await expect(service.execute(seller, { ...request, command: listing(6) })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const current = await store.load(seller);
    const oldSave = { ...readClientSave(current.save), tradeRevision: '0' };
    const cloud = new ClientSaveService(store, () => now);
    await expect(cloud.upload(seller, { characterId: seller, requestId: randomUUID(), baseRevision: current.revision, save: oldSave }))
      .rejects.toMatchObject({ code: 'SAVE_REJECTED' });
    expect(await store.load(seller)).toEqual(current);
    const pendingUpload = { characterId: seller, requestId: randomUUID(), baseRevision: current.revision, save: current.save };
    const staleTrade = await store.request(seller, listing(2));
    await cloud.upload(seller, pendingUpload);
    expect(await service.execute(seller, staleTrade)).toMatchObject({ status: 'rejected', error: { code: 'SAVE_CONFLICT' } });
    expect(await service.execute(seller, staleTrade)).toEqual((await service.lookup(seller, staleTrade.requestId) as { receipt: ConsignmentReceipt }).receipt);
    expect(await service.execute(seller, request)).toEqual(results[0]);
    const { tradeRevision: _oldField, ...legacy } = readClientSave(current.save);
    expect(() => readClientSave({ ...legacy, format: 'opening-client-1' })).toThrow();
  });

  it('retains unclaimed assets on capacity rejection and permits a new partial claim without charging again', async () => {
    const { store, service } = setup();
    const listed = succeeded(await service.execute(seller, await store.request(seller, listing(50))));
    succeeded(await service.execute(buyer, await store.request(buyer,
      { type: 'buy', listingId: listed.listingId!, unitPrice: '1', quantity: 50 })));
    const [delivery] = await store.deliveries(seller, 0);
    const request = await store.request(seller, { type: 'claim', deliveryId: delivery.id, quantity: 49 });
    request.save.character.money = '999999999980';
    const before = await store.load(seller);
    const denied = await service.execute(seller, request);
    expect(denied).toMatchObject({ status: 'rejected' });
    expect(await store.load(seller)).toEqual(before);
    expect((await store.deliveries(seller, 0))[0]).toEqual(delivery);
    const partial = { ...request, requestId: randomUUID(), command: { type: 'claim' as const, deliveryId: delivery.id, quantity: 20 } };
    succeeded(await service.execute(seller, partial));
    expect(readClientSave((await store.load(seller)).save).character.money).toBe('1000000000000');
    expect((await store.deliveries(seller, 0))[0].quantity).toBe('29');
    expect(await service.execute(seller, request)).toEqual(denied);
    expect(await store.totals(seller)).toMatchObject({ saleGross: '50', saleFees: '1', saleNet: '49' });
  });

  it('limits active listings and shares filtered views across merchants without publishing owner IDs or saves', async () => {
    const { store, service } = setup();
    const listed = succeeded(await service.execute(seller, await store.request(seller, listing(1))));
    const row = store.data.listings.get(listed.listingId!)!;
    for (let i = 1; i < CONSIGNMENT_SLOTS; i++) {
      const id = randomUUID();
      store.data.listings.set(id, { ...structuredClone(row), id });
    }
    expect(await service.execute(seller, await store.request(seller, listing(1))))
      .toMatchObject({ status: 'rejected', error: { code: 'LISTING_LIMIT' } });
    const context = await store.request(buyer, listing(1));
    const { requestId: _request, command: _command, ...viewContext } = context;
    const view = await service.view(buyer, { ...viewContext, view: 'market', page: 0,
      filter: { search: ITEMS['copper-coin'].name, category: 'material', minPrice: '1', maxPrice: '1' } });
    expect(view.listings).toHaveLength(CONSIGNMENT_SLOTS);
    expect(view.scope).toBe('development');
    expect(view.listings[0]).not.toHaveProperty('sellerId');
    expect(view.listings[0]).not.toHaveProperty('gross');
    expect(view.listings[0]).not.toHaveProperty('fee');
    expect(view.listings[0]).not.toHaveProperty('save');
    expect(view.listings[0]).not.toHaveProperty('locationId');
    const remote = 'stoneforge-supplies' as const;
    viewContext.save.character = executeDebugCommand(viewContext.save.character,
      { type: 'region', regionId: SHOPS[remote].prerequisite!, operation: 'complete' });
    viewContext.save.character.locationId = SHOPS[remote].locationId;
    const elsewhere = await service.view(buyer, { ...viewContext, shopId: remote, view: 'market', page: 0, filter: {} });
    expect(elsewhere.listings).toEqual(view.listings);
    expect((await service.view(buyer, { ...viewContext, shopId: remote, view: 'market', page: 0, filter: { minPrice: '2' } })).listings).toEqual([]);
  });
});
