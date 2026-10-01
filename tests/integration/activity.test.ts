import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCharacter } from '../../core/prototype/character-state';
import { SHOPS } from '../../core/prototype/content';
import { executeDebugCommand } from '../../core/prototype/debug';
import { cloudProfileSchema, readClientSave, type CloudProfile } from '../../shared/client-save';
import { discordSessionSchema, type DiscordSession, type DiscordUser } from '../../shared/discord';
import { consignmentReceiptSchema, consignmentViewSchema, type ConsignmentRequest } from '../../shared/consignment';
import { rankingBoardSchema, type RankingId } from '../../shared/rankings';
import { reincarnationReceiptSchema } from '../../shared/reincarnation';
import { createPool } from '../../server/database';
import { createClientApp } from '../../server/client/main';
import { ClientRepository, initializeStorage } from '../../server/client/repository';
import { ConsignmentRepository } from '../../server/client/consignment-store';
import { ConsignmentService } from '../../server/client/consignment';
import { requireTestDatabaseUrl } from './database-guard';

// Only database selection and external Discord responses are substituted.
// HTTP routes, authentication, SQL, transactions and row locks use the real implementation.
vi.mock('../../server/database', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/database')>();
  return {
    ...original,
    createPool: () => original.createPool(requireTestDatabaseUrl(process.env.TEST_DATABASE_URL)),
  };
});

const applicationId = '123456789012345678';
const otherApplicationId = '345678901234567890';
const shopId = 'market-supplies' as const;
type App = Awaited<ReturnType<typeof createClientApp>>;
type Actor = { app: App; session: DiscordSession };
const codes = new Map<string, DiscordUser>();
const characterIds: string[] = [];
let pool: Pool;
let repository: ClientRepository;
let app: App;
let otherApp: App;
const fetchDiscord = vi.fn<typeof fetch>(async (url, init) => {
  if (String(url).endsWith('/oauth2/token')) {
    const code = new URLSearchParams(String(init?.body)).get('code')!;
    return new Response(JSON.stringify({ access_token: code, token_type: 'Bearer', expires_in: 3600, scope: 'identify' }));
  }
  const token = (init?.headers as Record<string, string>).Authorization.slice(7);
  const user = codes.get(token)!;
  return new Response(JSON.stringify({ id: user.id, username: user.username, global_name: user.displayName, avatar: user.avatar }));
});
function headers(actor: Actor) {
  return { origin: `https://${actor.session.clientId}.discordsays.com`, authorization: `Bearer ${actor.session.sessionToken}` };
}
async function actor(target = app, clientId = applicationId, user: DiscordUser = {
  id: String(200_000_000_000_000_000n + BigInt(randomInt(1, 1_000_000_000))),
  username: 'activity.test', displayName: '验证修士', avatar: null,
}): Promise<Actor> {
  const code = randomUUID();
  codes.set(code, user);
  const response = await target.inject({
    method: 'POST', url: '/api/discord/token', headers: { origin: `https://${clientId}.discordsays.com` },
    payload: { code, codeVerifier: 'v'.repeat(64) },
  });
  expect(response.statusCode).toBe(200);
  const session = discordSessionSchema.parse(response.json());
  if (!characterIds.includes(session.characterId)) characterIds.push(session.characterId);
  return { app: target, session };
}
async function profile(actor: Actor): Promise<CloudProfile> {
  const response = await actor.app.inject({ url: '/api/client/save', headers: headers(actor) });
  expect(response.statusCode).toBe(200);
  // Response time is not part of the persisted character checkpoint.
  return { ...cloudProfileSchema.parse(response.json()), serverTime: 0 };
}
async function merchant(actor: Actor) {
  const current = await profile(actor);
  const character = executeDebugCommand(createCharacter(Date.now(), 19),
    { type: 'region', regionId: SHOPS[shopId].prerequisite!, operation: 'complete' });
  character.locationId = SHOPS[shopId].locationId;
  character.history.testAssisted = false; // Isolated fixture, never a player character or client command.
  character.inventory['copper-coin'] = '100';
  character.money = '1000';
  const save = readClientSave({ ...current.save, character });
  expect(await repository.commit(actor.session.characterId, current.revision, save, Date.now(), randomUUID(), 'a'.repeat(64))).toBe(true);
}
async function request(actor: Actor, command: ConsignmentRequest['command']): Promise<ConsignmentRequest> {
  const current = await profile(actor);
  return { characterId: current.characterId, requestId: randomUUID(), baseRevision: current.revision,
    save: current.save, shopId, command };
}
async function trade(actor: Actor, input: ConsignmentRequest) {
  const response = await actor.app.inject({
    method: 'POST', url: '/api/client/consignment/command', headers: headers(actor), payload: input,
  });
  expect(response.statusCode).toBe(200);
  return consignmentReceiptSchema.parse(response.json());
}
async function list(actor: Actor, quantity: number) {
  const done = await trade(actor, await request(actor,
    { type: 'list', selection: { kind: 'stack', itemId: 'copper-coin', quantity }, unitPrice: '1' }));
  if (done.status !== 'succeeded' || !done.listingId) throw new Error(JSON.stringify(done));
  return done.listingId;
}
async function view(actor: Actor, type: 'market' | 'deliveries' = 'market') {
  const current = await profile(actor);
  const response = await actor.app.inject({
    method: 'POST', url: '/api/client/consignment/view', headers: headers(actor),
    payload: { characterId: current.characterId, baseRevision: current.revision, save: current.save,
      shopId, view: type, page: 0, filter: {} },
  });
  expect(response.statusCode).toBe(200);
  return consignmentViewSchema.parse(response.json());
}
async function board(actor: Actor, board: RankingId = 'money') {
  const response = await actor.app.inject({
    url: `/api/client/rankings/${board}?characterId=${actor.session.characterId}`, headers: headers(actor),
  });
  expect(response.statusCode).toBe(200);
  return rankingBoardSchema.parse(response.json());
}
async function reincarnate(actor: Actor) {
  const current = await profile(actor);
  const input = { characterId: current.characterId, requestId: randomUUID(), baseRevision: current.revision, save: current.save };
  const send = async () => {
    const response = await actor.app.inject({ method: 'POST', url: '/api/client/reincarnation', headers: headers(actor), payload: input });
    expect(response.statusCode).toBe(200);
    return reincarnationReceiptSchema.parse(response.json());
  };
  return { input, send };
}

beforeAll(async () => {
  const databaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  pool = createPool(databaseUrl);
  const identity = await pool.query('SELECT current_database() AS database, current_user AS role');
  expect(identity.rows[0]).toEqual({ database: 'moli_test', role: 'moli_test' });
  await initializeStorage(pool);
  repository = new ClientRepository(pool);
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CLIENT_AUTH_MODE', 'discord');
  vi.stubEnv('DEV_AUTH', 'false');
  vi.stubEnv('DISCORD_CLIENT_SECRET', 'external-discord-stub-only');
  vi.stubEnv('ACTIVITY_DATABASE_URL', `postgres://moli_activity_vps:${'a'.repeat(64)}@postgres:5432/moli_activity_vps`);
  vi.stubGlobal('fetch', fetchDiscord);
  vi.stubEnv('DISCORD_CLIENT_ID', applicationId);
  app = await createClientApp({ deployment: true });
  vi.stubEnv('DISCORD_CLIENT_ID', otherApplicationId);
  otherApp = await createClientApp({ deployment: true });
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (otherApp) await otherApp.close();
  if (pool) {
    // Remove only this run's fixtures, after both URL and server identities have been checked.
    if (characterIds.length) {
      for (const table of ['consignment_fills', 'consignment_deliveries', 'consignment_receipts',
        'reincarnation_receipts', 'consignment_listings', 'discord_sessions', 'discord_profiles', 'discord_accounts', 'dev_sessions', 'characters']) {
        const condition = table === 'consignment_fills' ? 'buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])'
          : ['discord_sessions', 'discord_profiles'].includes(table)
            ? '(application_id, user_id) IN (SELECT application_id, user_id FROM moli_client.discord_accounts WHERE character_id = ANY($1::uuid[]))'
          : table === 'characters' ? 'id = ANY($1::uuid[])'
          : table === 'consignment_listings' ? 'seller_id = ANY($1::uuid[])'
          : table === 'consignment_deliveries' ? 'owner_id = ANY($1::uuid[])' : 'character_id = ANY($1::uuid[])';
        await pool.query(`DELETE FROM moli_client.${table} WHERE ${condition}`, [characterIds]);
      }
    }
    await pool.end();
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isolated PostgreSQL Activity contracts', () => {
  it('publishes verified profiles and server metrics only, segregates applications and rejects test-assisted players', async () => {
    const first = await actor();
    await merchant(first);
    const before = await profile(first);
    const user = { ...first.session.user, displayName: '<名录 & 修士>'.repeat(10), avatar: 'a'.repeat(32) };
    const renamed = await actor(app, applicationId, user);
    expect(renamed.session.characterId).toBe(first.session.characterId);
    expect(await profile(renamed)).toEqual(before);
    for (const id of ['money', 'cultivation', 'power', 'refining'] as RankingId[]) {
      const ranks = await board(renamed, id);
      expect(ranks).toMatchObject({ scope: 'discord', self: { name: user.displayName,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` } });
      expect(Object.keys(ranks.self!).sort()).toEqual(['avatarUrl', 'isSelf', 'metric', 'name', 'rank', 'realmName', 'updatedAt']);
    }
    const foreign = await actor(otherApp, otherApplicationId, user);
    expect(foreign.session.characterId).not.toBe(first.session.characterId);
    await merchant(foreign);
    const foreignListing = await list(foreign, 1);
    expect((await view(renamed)).listings.some(row => row.id === foreignListing)).toBe(false);
    expect((await board(renamed)).entries.some(row => row.name === user.displayName && !row.isSelf)).toBe(false);
    const rejected = await trade(renamed, await request(renamed,
      { type: 'buy', listingId: foreignListing, quantity: 1, unitPrice: '1' }));
    expect(rejected).toMatchObject({ status: 'rejected', error: { code: 'LISTING_UNAVAILABLE' } });
    expect(await profile(renamed)).toEqual(before);

    const local = await repository.createSession(before.save, Date.now());
    characterIds.push(local.characterId);
    expect((await board(renamed)).entries.some(row => row.name.startsWith('试修'))).toBe(false);
    const ownListing = await list(renamed, 1);
    expect((await view(renamed)).listings.find(row => row.id === ownListing)).toMatchObject({
      sellerName: user.displayName, sellerAvatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`,
    });
    const assisted = await profile(renamed);
    assisted.save.character.history.testAssisted = true;
    expect(await repository.commit(assisted.characterId, assisted.revision, assisted.save, Date.now(), randomUUID(), 'b'.repeat(64))).toBe(true);
    expect((await board(renamed)).self).toBeNull();
    const purchaser = await actor();
    await merchant(purchaser);
    expect((await view(purchaser)).listings.some(row => row.id === ownListing)).toBe(false);
    expect(await trade(purchaser, await request(purchaser,
      { type: 'buy', listingId: ownListing, quantity: 1, unitPrice: '1' })))
      .toMatchObject({ status: 'rejected', error: { code: 'LISTING_UNAVAILABLE' } });
    expect(await trade(renamed, await request(renamed,
      { type: 'list', selection: { kind: 'stack', itemId: 'copper-coin', quantity: 1 }, unitPrice: '1' })))
      .toMatchObject({ status: 'rejected', error: { code: 'TEST_CHARACTER' } });
    await pool.query(`DELETE FROM moli_client.discord_profiles WHERE application_id = $1 AND user_id = $2`, [otherApplicationId, user.id]);
    expect((await board(foreign)).self).toBeNull();
    const relogin = await actor(otherApp, otherApplicationId, user);
    expect(relogin.session.characterId).toBe(foreign.session.characterId);
    expect((await board(relogin)).self?.name).toBe(user.displayName);
  });

  it('settles partial trades once, retains offline proceeds and rejects obsolete checkpoints through HTTP', async () => {
    const seller = await actor();
    const buyer = await actor();
    await merchant(seller);
    await merchant(buyer);
    const listingId = await list(seller, 60);
    const escrowed = await profile(seller);
    const input = await request(buyer, { type: 'buy', listingId, quantity: 30, unitPrice: '1' });
    const [done, duplicate] = await Promise.all([trade(buyer, input), trade(buyer, input)]);
    expect(done).toMatchObject({ status: 'succeeded' });
    expect(duplicate).toEqual(done);
    const lookup = await buyer.app.inject({ url: `/api/client/consignment/receipts/${input.requestId}?characterId=${buyer.session.characterId}`,
      headers: headers(buyer) });
    expect(lookup.json()).toEqual({ status: 'settled', receipt: done });
    expect(await trade(buyer, await request(buyer, { type: 'buy', listingId, quantity: 20, unitPrice: '1' })))
      .toMatchObject({ status: 'succeeded' });
    expect(await profile(seller)).toEqual(escrowed);
    expect((await board(seller)).self?.metric).toEqual({ kind: 'money', amount: '1000' });
    expect((await view(seller)).totals).toMatchObject({ saleGross: '50', saleFees: '1', saleNet: '49' });
    expect(await trade(seller, await request(seller, { type: 'cancel', listingId }))).toMatchObject({ status: 'succeeded' });
    for (const owner of [seller, buyer]) {
      for (const delivery of (await view(owner, 'deliveries')).deliveries) {
        expect(await trade(owner, await request(owner,
          { type: 'claim', deliveryId: delivery.id, quantity: Number(delivery.quantity) }))).toMatchObject({ status: 'succeeded' });
      }
    }
    const afterSeller = await profile(seller);
    const afterBuyer = await profile(buyer);
    expect(afterSeller.save.character.money).toBe('1049');
    expect(afterBuyer.save.character.money).toBe('950');
    expect(afterSeller.save.character.inventory['copper-coin']).toBe('50');
    expect(afterBuyer.save.character.inventory['copper-coin']).toBe('150');
    expect((await board(seller)).self?.metric).toEqual({ kind: 'money', amount: '1049' });
    const stale = await seller.app.inject({ method: 'POST', url: '/api/client/save', headers: headers(seller),
      payload: { characterId: escrowed.characterId, requestId: randomUUID(), baseRevision: escrowed.revision, save: escrowed.save } });
    expect(stale.statusCode).toBe(409);
    expect(await profile(seller)).toEqual(afterSeller);
    expect(await trade(buyer, input)).toEqual(done);
    expect(await profile(buyer)).toEqual(afterBuyer);
  });

  it('uses PostgreSQL locks for competing buyers and withdrawal, and rolls all writes back on receipt failure', async () => {
    const seller = await actor();
    const buyers = await Promise.all([actor(), actor()]);
    for (const owner of [seller, ...buyers]) await merchant(owner);
    const listingId = await list(seller, 3);
    const inputs = await Promise.all(buyers.map(buyer => request(buyer, { type: 'buy', listingId, quantity: 2, unitPrice: '1' })));
    const results = await Promise.all(buyers.map((buyer, index) => trade(buyer, inputs[index])));
    expect(results.map(row => row.status).sort()).toEqual(['rejected', 'succeeded']);
    const loser = buyers[results.findIndex(row => row.status === 'rejected')];
    await Promise.all([
      request(loser, { type: 'buy', listingId, quantity: 1, unitPrice: '1' }).then(input => trade(loser, input)),
      request(seller, { type: 'cancel', listingId }).then(input => trade(seller, input)),
    ]);
    const fills = await pool.query('SELECT sum(quantity)::int AS quantity FROM moli_client.consignment_fills WHERE listing_id = $1', [listingId]);
    const deliveries = (await view(seller, 'deliveries')).deliveries;
    const returned = deliveries.filter(row => row.asset.kind === 'stack').reduce((sum, row) => sum + Number(row.quantity), 0);
    expect(fills.rows[0].quantity + returned).toBe(3);

    const failing = new ConsignmentRepository(pool, { kind: 'discord', applicationId });
    const transact = failing.transact.bind(failing);
    failing.transact = (id, work) => transact(id, tx => work({ ...tx, record: async () => { throw new Error('receipt failure'); } }));
    const service = new ConsignmentService(failing);
    const before = await profile(seller);
    const input = await request(seller,
      { type: 'list', selection: { kind: 'stack', itemId: 'copper-coin', quantity: 1 }, unitPrice: '1' });
    const listings = await pool.query('SELECT id FROM moli_client.consignment_listings WHERE seller_id = $1 ORDER BY id', [before.characterId]);
    await expect(service.execute(before.characterId, input)).rejects.toThrow('receipt failure');
    expect(await profile(seller)).toEqual(before);
    expect((await pool.query('SELECT id FROM moli_client.consignment_listings WHERE seller_id = $1 ORDER BY id', [before.characterId])).rows).toEqual(listings.rows);
    expect(await service.lookup(before.characterId, input.requestId)).toEqual({ status: 'unknown' });
    expect(await trade(seller, input)).toMatchObject({ status: 'succeeded' });
  });

  it('waits for an in-flight purchase before reincarnation clears old-life proceeds, preserving the buyer and receipts', async () => {
    const seller = await actor();
    const buyer = await actor();
    await merchant(seller);
    await merchant(buyer);
    const listingId = await list(seller, 3);
    const input = await request(buyer, { type: 'buy', listingId, quantity: 2, unitPrice: '1' });
    const lifecycle = await reincarnate(seller);
    let release!: () => void;
    let signal!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const applied = new Promise<void>(resolve => { signal = resolve; });
    const original = ConsignmentRepository.prototype.transact;
    const spy = vi.spyOn(ConsignmentRepository.prototype, 'transact').mockImplementation(function (this: ConsignmentRepository, id, work) {
      return original.call(this, id, tx => work({ ...tx, apply: async (plan, now) => {
        await tx.apply(plan, now);
        if (id === buyer.session.characterId) { signal(); await hold; }
      } }));
    });
    const buying = trade(buyer, input);
    let resetting: ReturnType<typeof lifecycle.send> | undefined;
    try {
      await Promise.race([applied, buying.then(() => { throw new Error('Purchase finished before acquiring the test lock'); })]);
      resetting = lifecycle.send();
      let blocked = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const waiting = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE '%UPDATE moli_client.consignment_listings%'`);
        if (waiting.rowCount) { blocked = true; break; }
        await delay(25);
      }
      expect(blocked).toBe(true);
    } finally {
      release();
      spy.mockRestore();
    }
    const [bought, reset] = await Promise.all([buying, resetting!]);
    expect(bought).toMatchObject({ status: 'succeeded' });
    expect(reset).toMatchObject({ status: 'committed' });
    expect(await lifecycle.send()).toEqual(reset);
    const after = await profile(seller);
    expect(after.save.character.life.number).toBe('2');
    const store = new ConsignmentRepository(pool, { kind: 'discord', applicationId });
    expect(await store.activeCount(after.characterId)).toBe(0);
    expect(await store.deliveries(after.characterId, 0)).toEqual([]);
    expect((await store.deliveries(buyer.session.characterId, 0))[0].quantity).toBe('2');
    expect((await profile(buyer)).save.character.money).toBe('998');
    expect(await trade(buyer, input)).toEqual(bought);
    expect(await profile(seller)).toEqual(after);
    expect(await trade(buyer, await request(buyer, { type: 'buy', listingId, quantity: 1, unitPrice: '1' })))
      .toMatchObject({ status: 'rejected', error: { code: 'LISTING_UNAVAILABLE' } });
  });
});
