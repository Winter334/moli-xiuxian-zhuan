import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { config as loadEnv } from 'dotenv';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '../../core/index';
import { content } from '../../core/content';
import type { GameState } from '../../core/types';
import type { GameCommand, GameResponse } from '../../shared/contracts';
import { createApp, SESSION_COOKIE } from '../../server/main';
import { createPool } from '../../server/database';
import { migrate } from '../../server/migrate';
import { GameRepository } from '../../server/repository';
import { requireTestDatabaseUrl } from './database-guard';

loadEnv({ quiet: true });

const headers = { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' };
const initialTime = 1_780_000_000_000;
let now = initialTime;
let databaseUrl: string;
let pool: Pool;
let repository: GameRepository;
let app: Awaited<ReturnType<typeof createApp>>;

function makeApp(extra: Parameters<typeof createApp>[0] = {}) {
  return createApp({ databaseUrl, devAuth: true, nodeEnv: 'test', now: () => now, ...extra });
}

async function session() {
  const response = await app.inject({ method: 'POST', url: '/api/dev/session', headers });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((entry) => entry.name === SESSION_COOKIE)!;
  const token = cookie.value;
  const characterId = await repository.findSession(token);
  expect(characterId).not.toBeNull();
  return { token, characterId: characterId!, cookie: `${SESSION_COOKIE}=${token}`, response };
}

function game(cookie: string) {
  return app.inject({ method: 'GET', url: '/api/game', headers: { ...headers, cookie } });
}

function command(cookie: string, value: GameCommand, requestId = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: '/api/command',
    headers: { ...headers, cookie },
    payload: { requestId, command: value },
  });
}

async function seed(characterId: string, change: (state: GameState) => GameState) {
  const previous = await repository.load(characterId);
  const state = change(structuredClone(previous.state));
  expect((await repository.commit(characterId, previous.revision, state)).committed).toBe(true);
  return state;
}

function advanceFully(state: GameState, target: number): GameState {
  while (state.clockMs < Math.floor(target / 1000) * 1000) state = core.advanceGame(state, target);
  return state;
}

beforeAll(async () => {
  databaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  pool = createPool(databaseUrl);
  const identity = await pool.query<{ database: string; role: string }>(
    'SELECT current_database() AS database, current_user AS role',
  );
  expect(identity.rows[0]).toEqual({ database: 'moli_test', role: 'moli_test' });
  repository = new GameRepository(pool);
  app = await makeApp();
});

beforeEach(async () => {
  now = initialTime;
  // This suite owns only a URL- and server-identity-checked isolated test database.
  await pool.query('DELETE FROM characters');
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (pool) await pool.end();
});

describe('local PostgreSQL API', () => {
  it('does not disguise unexpected rule failures as permanent command rejections', async () => {
    const { cookie, characterId } = await session();
    const before = await repository.load(characterId);
    const spy = vi.spyOn(core, 'applyCommand').mockImplementation(() => {
      throw new Error('internal diagnostic must not be returned');
    });
    try {
      const response = await command(cookie, { type: 'buy', itemId: 'herb', quantity: 1 });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: 'INTERNAL_ERROR', message: 'The request could not be completed.',
      });
      expect(await repository.load(characterId)).toEqual(before);
      expect((await pool.query('SELECT count(*)::text AS count FROM command_requests')).rows[0].count).toBe('0');
    } finally {
      spy.mockRestore();
    }
  });

  it('checks the real database and creates/reuses an HTTPOnly same-site identity', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health', headers });
    expect(health.json()).toMatchObject({ ok: true, database: 'ok' });
    const first = await session();
    expect(first.response.headers['set-cookie']).toContain('HttpOnly');
    expect(first.response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(first.response.headers['set-cookie']).toContain('Path=/api');
    const again = await app.inject({
      method: 'POST', url: '/api/dev/session', headers: { ...headers, cookie: first.cookie },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.response.json());
    expect((await pool.query('SELECT count(*)::text AS count FROM characters')).rows[0].count).toBe('1');
    expect((await pool.query('SELECT token_hash FROM dev_sessions')).rows[0].token_hash).not.toBe(first.token);
    expect(first.characterId).not.toBe(first.token);
  });

  it('keeps every asset out of the character JSON and stores instances without rerolling', async () => {
    const { characterId, cookie } = await session();
    const before = await repository.load(characterId);
    expect(before.state.equipment.length).toBeGreaterThan(0);
    const raw = await pool.query('SELECT state FROM characters WHERE id = $1', [characterId]);
    for (const key of ['stones', 'inventory', 'equipment']) expect(raw.rows[0].state).not.toHaveProperty(key);
    const equipment = await pool.query('SELECT instance_id, definition_id, instance FROM equipment_instances WHERE character_id = $1', [characterId]);
    expect(equipment.rows).toHaveLength(before.state.equipment.length);
    expect(equipment.rows[0].instance).not.toHaveProperty('instanceId');
    await game(cookie);
    expect((await repository.load(characterId)).state.equipment).toEqual(before.state.equipment);
  });

  it('reconnects through a new app/pool and awards offline growth exactly once', async () => {
    const { cookie, characterId } = await session();
    expect((await command(cookie, { type: 'activity', kind: 'meditate' })).statusCode).toBe(200);
    const saved = await repository.load(characterId);
    now += 37_875;
    const expected = advanceFully(saved.state, now);
    await app.close();
    app = await makeApp();
    const first = await game(cookie);
    expect(first.statusCode).toBe(200);
    expect(first.json<GameResponse>().game).toEqual(core.getGameView(expected));
    const afterFirst = await repository.load(characterId);
    await app.close();
    app = await makeApp();
    const second = await game(cookie);
    expect(second.json()).toEqual(first.json());
    expect(await repository.load(characterId)).toEqual(afterFirst);
    expect(afterFirst.state.totals.cultivationGained).not.toBe(saved.state.totals.cultivationGained);
  });

  it('preserves generated affixes and RNG across a combat save and restart', async () => {
    const { cookie, characterId } = await session();
    await seed(characterId, (state) => ({ ...state, rng: 7 }));
    await command(cookie, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    now += 30_000;
    expect((await game(cookie)).statusCode).toBe(200);
    const saved = await repository.load(characterId);
    expect(saved.state.equipment.some((item) => item.affixes.length > 0)).toBe(true);
    await app.close();
    app = await makeApp();
    expect((await game(cookie)).statusCode).toBe(200);
    expect(await repository.load(characterId)).toEqual(saved);
  });

  it('replays the first command response even after time and state have changed', async () => {
    const { cookie, characterId } = await session();
    const requestId = randomUUID();
    const buy: GameCommand = { type: 'buy', itemId: 'healing-pill', quantity: 1 };
    const first = await command(cookie, buy, requestId);
    expect(first.statusCode).toBe(200);
    now += 15_000;
    await game(cookie);
    const snapshot = await repository.load(characterId);
    const replay = await command(cookie, buy, requestId);
    expect(replay.json()).toEqual(first.json());
    expect(await repository.load(characterId)).toEqual(snapshot);
    expect((await pool.query('SELECT count(*)::text AS count FROM command_requests')).rows[0].count).toBe('1');
  });

  it('accepts reordered object fields as the same command but rejects a changed payload', async () => {
    const { cookie, characterId } = await session();
    const requestId = randomUUID();
    const first = await command(cookie, { type: 'buy', itemId: 'herb', quantity: 1 }, requestId);
    const reordered = await command(cookie, { quantity: 1, itemId: 'herb', type: 'buy' }, requestId);
    expect(reordered.json()).toEqual(first.json());
    const before = await repository.load(characterId);
    const changed = await command(cookie, { type: 'buy', itemId: 'herb', quantity: 2 }, requestId);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe('IDEMPOTENCY_CONFLICT');
    expect(await repository.load(characterId)).toEqual(before);
  });

  it('deduplicates simultaneous requests across two app instances', async () => {
    const { cookie, characterId } = await session();
    const other = await makeApp();
    try {
      const requestId = randomUUID();
      const value: GameCommand = { type: 'buy', itemId: 'herb', quantity: 1 };
      const [a, b] = await Promise.all([
        command(cookie, value, requestId),
        other.inject({ method: 'POST', url: '/api/command', headers: { ...headers, cookie }, payload: { requestId, command: value } }),
      ]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.json()).toEqual(b.json());
      const saved = await repository.load(characterId);
      expect(saved.state.stones).toBe('27');
      expect(saved.state.inventory.herb).toBe('7');
      expect(saved.revision).toBe('1');
    } finally {
      await other.close();
    }
  });

  it('does not overspend on concurrent purchases', async () => {
    const { cookie, characterId } = await session();
    const responses = await Promise.all([
      command(cookie, { type: 'buy', itemId: 'healing-pill', quantity: 2 }),
      command(cookie, { type: 'buy', itemId: 'healing-pill', quantity: 2 }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 422]);
    const saved = await repository.load(characterId);
    expect(saved.state.stones).toBe('14');
    expect(saved.state.inventory['healing-pill']).toBe('7');
    expect(saved.revision).toBe('1');
  });

  it('cannot both sell and consume the last item', async () => {
    const { cookie, characterId } = await session();
    const original = await seed(characterId, (state) => {
      state.inventory['healing-pill'] = '1';
      state.player.hp = '1';
      return state;
    });
    const responses = await Promise.all([
      command(cookie, { type: 'sell', itemId: 'healing-pill', quantity: 1 }),
      command(cookie, { type: 'consume', itemId: 'healing-pill', quantity: 1 }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 422]);
    const saved = await repository.load(characterId);
    const winner: GameCommand = responses[0].statusCode === 200
      ? { type: 'sell', itemId: 'healing-pill', quantity: 1 }
      : { type: 'consume', itemId: 'healing-pill', quantity: 1 };
    expect(saved.state).toEqual(core.applyCommand(original, winner));
  });

  it('catches up real combat and supply consumption before buying new medicine', async () => {
    const { cookie, characterId } = await session();
    const original = await seed(characterId, (state) => {
      state = core.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
      state.inventory['healing-pill'] = '0';
      state.supply.enabled = true;
      state.supply.hpThreshold = 1;
      state.player.hp = '1';
      return state;
    });
    now += 20_000;
    const advanced = advanceFully(original, now);
    const expected = core.applyCommand(advanced, { type: 'buy', itemId: 'healing-pill', quantity: 1 });
    const response = await command(cookie, { type: 'buy', itemId: 'healing-pill', quantity: 1 });
    expect(response.statusCode).toBe(200);
    expect((await repository.load(characterId)).state).toEqual(expected);
    expect(expected.inventory['healing-pill']).toBe('1');
    expect(expected.totals.pillsUsed).toBe(original.totals.pillsUsed);
  });

  it('serializes offline catch-up and another command without duplicated income or loss', async () => {
    const { cookie, characterId } = await session();
    await command(cookie, { type: 'activity', kind: 'meditate' });
    const original = (await repository.load(characterId)).state;
    now += 80_000;
    const expected = core.applyCommand(advanceFully(original, now), { type: 'buy', itemId: 'herb', quantity: 1 });
    const responses = await Promise.all([
      game(cookie),
      command(cookie, { type: 'buy', itemId: 'herb', quantity: 1 }),
      game(cookie),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    expect((await repository.load(characterId)).state).toEqual(expected);
  });

  it('rolls back state, assets, revision and receipt after a late PostgreSQL failure', async () => {
    const { cookie, characterId } = await session();
    await command(cookie, { type: 'activity', kind: 'meditate' });
    const before = await repository.load(characterId);
    const requestId = randomUUID();
    now += 8_000;
    await pool.query(`
      CREATE FUNCTION integration_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'postgres://private-do-not-leak'; END $$;
      CREATE TRIGGER integration_reject_receipt BEFORE INSERT ON command_requests
      FOR EACH ROW EXECUTE FUNCTION integration_reject_receipt()
    `);
    try {
      const response = await command(cookie, { type: 'buy', itemId: 'herb', quantity: 1 }, requestId);
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toMatch(/postgres|private-do-not-leak|moli_local_only|moli_test_only/i);
      expect(await repository.load(characterId)).toEqual(before);
      expect((await pool.query('SELECT 1 FROM command_requests WHERE request_id = $1', [requestId])).rowCount).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER integration_reject_receipt ON command_requests');
      await pool.query('DROP FUNCTION integration_reject_receipt()');
    }
    expect((await command(cookie, { type: 'buy', itemId: 'herb', quantity: 1 }, requestId)).statusCode).toBe(200);
  });

  it('keeps a domain rejection idempotent and changes no game data', async () => {
    const { cookie, characterId } = await session();
    await command(cookie, { type: 'activity', kind: 'meditate' });
    const before = await repository.load(characterId);
    now += 5_000;
    const requestId = randomUUID();
    const value: GameCommand = { type: 'buy', itemId: 'healing-pill', quantity: 100 };
    const response = await command(cookie, value, requestId);
    expect(response.statusCode).toBe(422);
    expect(await repository.load(characterId)).toEqual(before);
    await seed(characterId, (state) => ({ ...state, stones: '100000' }));
    const funded = await repository.load(characterId);
    const replay = await command(cookie, value, requestId);
    expect(replay.statusCode).toBe(422);
    expect(replay.json()).toEqual(response.json());
    expect(await repository.load(characterId)).toEqual(funded);
  });

  it('does not partially pay for crafting when a later required material is missing', async () => {
    const { cookie, characterId } = await session();
    await seed(characterId, (state) => {
      state.regionKills.bamboo = '5';
      state.inventory.herb = '3';
      state.inventory.ore = '0';
      return state;
    });
    const before = await repository.load(characterId);
    const response = await command(cookie, { type: 'craft', recipeId: 'attack', quantity: 1 });
    expect(response.statusCode).toBe(422);
    expect(await repository.load(characterId)).toEqual(before);
  });

  it('rejects embedding assets in character JSON or copying ownership into equipment JSON', async () => {
    const { characterId } = await session();
    await expect(pool.query(
      "UPDATE characters SET state = state || '{\"stones\":\"999\"}'::jsonb WHERE id = $1",
      [characterId],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(
      "UPDATE equipment_instances SET instance = instance || '{\"characterId\":\"other\"}'::jsonb WHERE character_id = $1",
      [characterId],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('round-trips decimal integer strings and BIGINT revisions beyond Number precision', async () => {
    const { cookie, characterId } = await session();
    const huge = '12345678901234567890123456789012345678901234567890';
    await seed(characterId, (state) => ({ ...state, stones: huge, inventory: { ...state.inventory, herb: huge } }));
    await pool.query('UPDATE characters SET revision = $1::bigint WHERE id = $2', ['9007199254740993', characterId]);
    const response = await command(cookie, { type: 'buy', itemId: 'herb', quantity: 1 });
    expect(response.statusCode).toBe(200);
    expect(response.json<GameResponse>().revision).toBe('9007199254740994');
    expect(response.json<GameResponse>().game.stones).toBe((BigInt(huge) - 3n).toString());
    const saved = await repository.load(characterId);
    expect(saved.state.stones).toBe((BigInt(huge) - 3n).toString());
    expect(saved.state.inventory.herb).toBe((BigInt(huge) + 1n).toString());
    await app.close();
    app = await makeApp();
    expect((await game(cookie)).json()).toEqual(response.json());
  });

  it.each(['-1', '1.5', 'NaN', 'Infinity', '-Infinity'])('rejects invalid NUMERIC assets at the database boundary: %s', async (value) => {
    const { characterId } = await session();
    await expect(pool.query('UPDATE characters SET stones = $1::numeric WHERE id = $2', [value, characterId]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('UPDATE inventory SET quantity = $1::numeric WHERE character_id = $2', [value, characterId]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it.each(['contentVersion', 'rulesVersion', 'schemaVersion'])('refuses incompatible %s without changing the save', async (key) => {
    const { cookie, characterId } = await session();
    await pool.query('UPDATE characters SET state = jsonb_set(state, $1::text[], $2::jsonb) WHERE id = $3', [
      [key], JSON.stringify(key === 'schemaVersion' ? 999 : 'incompatible'), characterId,
    ]);
    const before = await repository.load(characterId);
    now += 30_000;
    for (const response of [await game(cookie), await command(cookie, { type: 'activity', kind: 'meditate' })]) {
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('SAVE_VERSION_MISMATCH');
    }
    expect(await repository.load(characterId)).toEqual(before);
    expect((await pool.query('SELECT 1 FROM command_requests')).rowCount).toBe(0);
  });

  it('preserves existing saves and records migrations only once on repeated startup', async () => {
    const { characterId } = await session();
    const before = await repository.load(characterId);
    await Promise.all([migrate(pool), migrate(pool)]);
    expect(await repository.load(characterId)).toEqual(before);
    const migrations = await pool.query('SELECT name, checksum FROM schema_migrations');
    expect(migrations.rows).toHaveLength(1);
    expect(migrations.rows[0]).toMatchObject({ name: '001_initial.sql', checksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it('rejects a stale revision without touching any persisted asset', async () => {
    const { characterId } = await session();
    const initial = await repository.load(characterId);
    const bought = core.applyCommand(initial.state, { type: 'buy', itemId: 'herb', quantity: 1 });
    expect((await repository.commit(characterId, initial.revision, bought)).committed).toBe(true);
    expect((await repository.commit(characterId, initial.revision, initial.state)).committed).toBe(false);
    expect((await repository.load(characterId)).state).toEqual(bought);
  });

  it('bounds CAS retries under repeated real revision changes', async () => {
    const { cookie, characterId } = await session();
    const before = await repository.load(characterId);
    const actualCommit = GameRepository.prototype.commit;
    const spy = vi.spyOn(GameRepository.prototype, 'commit').mockImplementation(
      async function(this: GameRepository, ...args: Parameters<GameRepository['commit']>) {
        const current = await this.load(args[0]);
        await actualCommit.call(this, args[0], current.revision, current.state);
        return actualCommit.apply(this, args);
      },
    );
    try {
      const response = await command(cookie, { type: 'buy', itemId: 'herb', quantity: 1 });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('STATE_CONFLICT');
      expect(spy).toHaveBeenCalledTimes(5);
      expect((await repository.load(characterId)).state).toEqual(before.state);
      expect((await pool.query('SELECT 1 FROM command_requests')).rowCount).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('yields between real simulation chunks and holds no transaction during catch-up', async () => {
    const { cookie } = await session();
    await command(cookie, { type: 'activity', kind: 'meditate' });
    await app.close();
    app = await makeApp({ maxTicksPerChunk: 1 });
    now += 600_000;
    let firstChunk!: () => void;
    const entered = new Promise<void>((resolve) => { firstChunk = resolve; });
    const actualAdvance = core.advanceGame;
    const spy = vi.spyOn(core, 'advanceGame').mockImplementation((...args) => {
      firstChunk();
      return actualAdvance(...args);
    });
    let complete = false;
    const recovery = game(cookie).then((result) => { complete = true; return result; });
    try {
      await Promise.race([
        entered,
        recovery.then(() => { throw new Error('Recovery finished without entering a simulation chunk.'); }),
      ]);
      const health = await app.inject({ method: 'GET', url: '/api/health', headers });
      expect(health.statusCode).toBe(200);
      expect(complete).toBe(false);
      const transactions = await pool.query(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = 'moli-local' AND state = 'idle in transaction'",
      );
      expect(transactions.rows[0].count).toBe('0');
      expect((await recovery).statusCode).toBe(200);
      expect(spy.mock.calls.length).toBeGreaterThan(1);
    } finally {
      await recovery;
      spy.mockRestore();
      await app.close();
      app = await makeApp();
    }
  });

  it('requires authentication and ignores client-provided character identities', async () => {
    const { cookie, characterId } = await session();
    const before = await repository.load(characterId);
    expect((await app.inject({ method: 'GET', url: `/api/game?characterId=${characterId}`, headers })).statusCode).toBe(401);
    expect((await game(`${SESSION_COOKIE}=${characterId}`)).statusCode).toBe(401);
    expect((await command('', { type: 'buy', itemId: 'herb', quantity: 1 })).statusCode).toBe(401);
    const bad = await app.inject({
      method: 'POST', url: '/api/command', headers: { ...headers, cookie },
      payload: { requestId: randomUUID(), characterId, command: { type: 'buy', itemId: 'herb', quantity: 1 } },
    });
    expect(bad.statusCode).toBe(400);
    expect(await repository.load(characterId)).toEqual(before);
  });

  it('requires explicit developer authentication and fails closed in production', async () => {
    const disabled = await makeApp({ devAuth: false });
    try {
      const response = await disabled.inject({ method: 'POST', url: '/api/dev/session', headers });
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe('AUTH_NOT_CONFIGURED');
    } finally {
      await disabled.close();
    }
    await expect(makeApp({ devAuth: true, nodeEnv: 'production' })).rejects.toThrow(/Production authentication/);
    await expect(makeApp({ devAuth: false, nodeEnv: 'production' })).rejects.toThrow(/Production authentication/);
  });

  it.each(['', 'false', 'TRUE', '1'])('does not interpret DEV_AUTH=%s as an explicit true', async (value) => {
    vi.stubEnv('DEV_AUTH', value);
    let disabled: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      disabled = await createApp({ databaseUrl, nodeEnv: 'test' });
      const response = await disabled.inject({ method: 'POST', url: '/api/dev/session', headers });
      expect(response.statusCode).toBe(503);
    } finally {
      if (disabled) await disabled.close();
      vi.unstubAllEnvs();
    }
  });

  it('reports an unavailable database without disclosing connection details', async () => {
    const brokenPool = createPool(databaseUrl);
    const instance = await createApp({ pool: brokenPool, devAuth: true, nodeEnv: 'test' });
    try {
      await brokenPool.end();
      const health = await instance.inject({ method: 'GET', url: '/api/health', headers });
      expect(health.statusCode).toBe(503);
      expect(health.json()).toMatchObject({ ok: false, database: 'unavailable' });
      expect(health.body).not.toMatch(/postgres|moli_test_only|54329/);
      const identity = await instance.inject({ method: 'POST', url: '/api/dev/session', headers });
      expect(identity.statusCode).toBe(500);
      expect(identity.body).not.toMatch(/postgres|moli_test_only|54329/);
    } finally {
      await instance.close();
    }
  });

  it.each([
    { origin: 'https://attacker.invalid' },
    { origin: 'null' },
    { origin: 'http://127.0.0.1:5173' },
    { host: 'attacker.invalid', origin: 'http://attacker.invalid' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: '' },
    { host: 'localhost@attacker.invalid', origin: 'http://attacker.invalid' },
  ])('rejects cross-origin or forged-host writes: %j', async (overrides) => {
    const { cookie, characterId } = await session();
    const before = await repository.load(characterId);
    for (const url of ['/api/dev/session', '/api/command']) {
      const response = await app.inject({
        method: 'POST', url, headers: { ...headers, cookie, ...overrides },
        payload: { requestId: randomUUID(), command: { type: 'buy', itemId: 'herb', quantity: 1 } },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(await repository.load(characterId)).toEqual(before);
  });

  it('accepts a same-origin Vite proxy without trusting forwarded headers', async () => {
    const { cookie } = await session();
    const response = await app.inject({
      method: 'POST', url: '/api/command',
      headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', cookie },
      payload: { requestId: randomUUID(), command: { type: 'activity', kind: 'meditate' } },
    });
    expect(response.statusCode).toBe(200);
    const forged = await app.inject({
      method: 'POST', url: '/api/command',
      headers: { ...headers, cookie, origin: 'https://attacker.invalid', 'x-forwarded-host': 'attacker.invalid' },
      payload: { requestId: randomUUID(), command: { type: 'activity', kind: 'idle' } },
    });
    expect(forged.statusCode).toBe(403);
  });

  it.each([0, -1, 1.2, 1001, '1'])('rejects invalid command quantities without coercion: %s', async (quantity) => {
    const { cookie, characterId } = await session();
    const before = await repository.load(characterId);
    const response = await app.inject({
      method: 'POST', url: '/api/command', headers: { ...headers, cookie },
      payload: { requestId: randomUUID(), command: { type: 'buy', itemId: 'herb', quantity } },
    });
    expect(response.statusCode).toBe(400);
    expect(await repository.load(characterId)).toEqual(before);
  });

  it('does not allow another identity to replay a private command response', async () => {
    const first = await session();
    const second = await session();
    const requestId = randomUUID();
    const bought = await command(first.cookie, { type: 'buy', itemId: 'herb', quantity: 1 }, requestId);
    const other = await command(second.cookie, { type: 'buy', itemId: 'healing-pill', quantity: 1 }, requestId);
    expect(bought.statusCode).toBe(200);
    expect(other.statusCode).toBe(200);
    expect(other.json<GameResponse>().game.stones).toBe('22');
    expect(bought.json<GameResponse>().game.stones).toBe('27');
    expect(content.settings.starterStones).toBe('30');
    await yieldToEventLoop();
  });
});
