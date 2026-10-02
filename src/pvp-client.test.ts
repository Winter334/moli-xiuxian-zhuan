import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameClient } from './game-client';
import { LocalSaveStore, localFromCloud, type SaveStorage } from './local-save';
import { pvpFixture } from '../tests/helpers/pvp';
import { ApiError } from '../server/errors';
import { sameClientSave } from './save-recovery';
import { PVP_RULES } from '../shared/pvp';
import type { CloudProfile } from '../shared/client-save';

const clients: GameClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.stop()); });
async function setup() {
  const f = pvpFixture();
  f.store.red(f.defenderId);
  let now = 0, loseFinish = false;
  const games = new Map<string, GameClient>();
  const profile = (id: string): CloudProfile => {
    const row = f.store.snapshots.get(id)!;
    return { characterId: id, revision: row.revision, save: row.save as CloudProfile['save'], serverTime: now };
  };
  f.coordinator.notify = (id, state) => games.get(id)?.updatePvpState(state);
  const device = async (id: string, existing?: Map<string, string>) => {
    const values = existing ?? new Map<string, string>();
    let broken = false;
    const storage: SaveStorage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { if (broken) throw new Error('storage full'); values.set(key, value); },
    };
    if (!existing) {
      const store = new LocalSaveStore(storage);
      await store.load(); await store.write(localFromCloud(profile(id), now));
    }
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const path = String(url), body = init?.body ? JSON.parse(String(init.body)) : undefined;
      try {
        let data: unknown;
        if (path === '/api/client/save') data = profile(id);
        else if (path === '/api/client/pvp') data = await f.service.overview(id);
        else if (path === '/api/client/pvp/start') data = await f.service.start(id, body);
        else if (path === '/api/client/pvp/join') data = await f.service.join(id, body);
        else if (path === '/api/client/pvp/finish') {
          data = await f.service.finish(id, body);
          if (loseFinish) { loseFinish = false; throw new Error('lost reply'); }
        } else if (path.startsWith('/api/client/pvp/')) data = await f.service.status(id, path.split('/').at(-1)!);
        else throw new Error(`unexpected ${path}`);
        return new Response(JSON.stringify(data));
      } catch (error) {
        if (error instanceof ApiError) return new Response(JSON.stringify({ message: error.message }), { status: error.statusCode });
        throw error;
      }
    });
    const client = new GameClient({ fetcher, store: new LocalSaveStore(storage), expectedCharacterId: id,
      requireCloudBaseline: true, wallNow: () => now, monotonicNow: () => now, acquireLock: async () => () => {} });
    clients.push(client); games.set(id, client);
    await client.initialize();
    return { client, values, fetcher, broken: (value: boolean) => { broken = value; },
      read: () => new LocalSaveStore(storage).load() };
  };
  const attacker = await device(f.attackerId), defender = await device(f.defenderId);
  return { f, attacker, defender, device,
    now: () => now, time: (value: number) => { now = value; f.time(value); }, loseFinish: () => { loseFinish = true; } };
}
async function fight(s: Awaited<ReturnType<typeof setup>>) {
  await s.attacker.client.reconcilePvp();
  for (let elapsed = 0; elapsed <= PVP_RULES.combatLimitMs && s.attacker.client.getSnapshot().pvpCombat?.state.attacker.battle; elapsed += 1000) {
    s.time(s.now() + 1000);
    await s.attacker.client.tick();
  }
}
describe('persistent PVP client checkpoints', () => {
  it('persists before sending, computes only on attacker ticks, then applies server settlement once without defender combat UI', async () => {
    const s = await setup();
    await s.attacker.client.attackPlayer(s.f.target);
    const pending = (await s.attacker.read())!.pendingPvp!;
    expect(pending.role).toBe('attacker');
    await s.defender.client.preparePvpDefense(pending.battleId);
    const before = (await s.defender.read())!.save;
    s.time(5000);
    await s.defender.client.tick();
    expect(await s.defender.client.command({ type: 'withdraw' })).toBe(false);
    await s.defender.client.sync();
    expect((await s.defender.read())!.save).toEqual(before);
    expect(await s.attacker.client.reconcilePvp()).toBe(false);
    expect(s.attacker.client.getSnapshot().pvpCombat).not.toBeNull();
    expect((await s.attacker.read())!.pendingPvp!.outcome).toBeNull();
    expect(s.attacker.fetcher.mock.calls.some(([url]) => url === '/api/client/pvp/finish')).toBe(false);
    expect(s.defender.client.getSnapshot().pvpCombat).toBeNull();
    await fight(s);
    expect(s.attacker.client.getSnapshot().pvpPending).toBe(false);
    expect(await s.defender.client.reconcilePvp()).toBe(true);
    for (const [id, device] of [[s.f.attackerId, s.attacker], [s.f.defenderId, s.defender]] as const) {
      const local = (await device.read())!;
      expect(local.pendingPvp).toBeNull();
      expect(sameClientSave(local.save, s.f.store.snapshots.get(id)!.save as typeof local.save)).toBe(true);
      expect(local.cloudRevision).toBe('1');
      expect(local.save.tradeRevision).toBe('1');
    }
    expect(s.attacker.client.getSnapshot().pvpCombat).toBeNull();
    expect(s.defender.client.getSnapshot().pvpCombat).toBeNull();
    const original = (await s.defender.read())!.save;
    expect(await s.defender.client.reconcilePvp()).toBe(false);
    expect((await s.defender.read())!.save).toEqual(original);
  });
  it('recovers a settled but lost response after reopening without unfreezing or uploading an old checkpoint', async () => {
    const s = await setup();
    await s.attacker.client.attackPlayer(s.f.target);
    const pending = (await s.attacker.read())!.pendingPvp!;
    await s.defender.client.preparePvpDefense(pending.battleId);
    s.loseFinish();
    await fight(s);
    expect(s.attacker.client.getSnapshot().pvpPending).toBe(true);
    expect((await s.attacker.read())!.pendingPvp!.outcome).not.toBeNull();
    s.attacker.client.stop();
    s.time(s.now() + 8000);
    const reopened = await s.device(s.f.attackerId, s.attacker.values);
    expect(reopened.client.getSnapshot().pvpPending).toBe(true);
    expect(await reopened.client.reconcilePvp()).toBe(true);
    expect(reopened.client.getSnapshot()).toMatchObject({ pvpPending: false, onlineReady: true, onlineMessage: null });
    expect(reopened.fetcher.mock.calls.some(([url]) => url === '/api/client/pvp/finish')).toBe(false);
    expect(s.f.store.snapshots.get(s.f.attackerId)!.revision).toBe('1');
  });
  it('resumes a saved duel without advancing closed or suspended time and can withdraw through the same settlement', async () => {
    const s = await setup();
    await s.attacker.client.attackPlayer(s.f.target);
    const pending = (await s.attacker.read())!.pendingPvp!;
    await s.defender.client.preparePvpDefense(pending.battleId);
    await s.attacker.client.reconcilePvp();
    s.time(1000);
    await s.attacker.client.tick();
    const checkpoint = (await s.attacker.read())!.pendingPvp!.combat!;
    expect(checkpoint.attacker.clockMs).toBe(1000);
    s.attacker.client.stop();
    s.time(20_000);
    const reopened = await s.device(s.f.attackerId, s.attacker.values);
    expect(reopened.client.getSnapshot().pvpCombat!.state).toEqual(checkpoint);
    expect(reopened.client.getSnapshot().pvpCombat!.frame.events).toEqual([]);
    s.time(21_000);
    await reopened.client.tick();
    expect((await reopened.read())!.pendingPvp!.combat!.attacker.clockMs).toBe(2000);
    s.time(40_000);
    await reopened.client.tick();
    expect((await reopened.read())!.pendingPvp!.combat!.attacker.clockMs).toBe(2000);
    expect(reopened.client.getSnapshot().pvpCombat!.paused).toBe(true);
    expect(await reopened.client.withdrawPvp()).toBe(true);
    expect((await reopened.read())!.pendingPvp).toBeNull();
    expect(reopened.client.getSnapshot().response!.game.hp).toBe('0');
    expect(reopened.client.getSnapshot().response!.game.locationId).toBe('qingshi-village');
  });
  it('does not send when the checkpoint cannot be persisted, and cancels preparation without restoring from cloud', async () => {
    const s = await setup();
    s.attacker.broken(true);
    await s.attacker.client.attackPlayer(s.f.target);
    expect(s.attacker.client.getSnapshot().blocked).toBe(true);
    expect(s.f.store.battles.size).toBe(0);
    const next = await setup();
    const original = (await next.attacker.read())!.save;
    await next.attacker.client.attackPlayer(next.f.target);
    next.time(PVP_RULES.preparationMs + 1);
    await next.attacker.client.reconcilePvp();
    expect((await next.attacker.read())!.pendingPvp).toBeNull();
    expect((await next.attacker.read())!.save).toEqual(original);
    expect(next.f.store.snapshots.get(next.f.attackerId)!.revision).toBe('0');
  });
  it('reads old local-format-4 saves with no PVP field without rejecting or resetting the character', async () => {
    const s = await setup();
    const key = [...s.attacker.values.keys()][0], wrapper = JSON.parse(s.attacker.values.get(key)!);
    delete wrapper.data.pendingPvp;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(wrapper.data)));
    wrapper.checksum = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    s.attacker.values.set(key, JSON.stringify(wrapper));
    const reopened = await s.device(s.f.attackerId, s.attacker.values);
    expect((await reopened.read())!.pendingPvp).toBeNull();
    expect(reopened.client.getSnapshot().response!.characterId).toBe(s.f.attackerId);
    expect(reopened.client.getSnapshot().blocked).toBe(false);
  });
});
