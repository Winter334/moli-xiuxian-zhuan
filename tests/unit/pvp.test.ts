import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkpoint, pvpFixture } from '../helpers/pvp';
import { executeCharacterCommand } from '../../core/prototype/character';
import { REGIONS, SAFE_LOCATIONS } from '../../core/prototype/content';
import { executeDebugCommand } from '../../core/prototype/debug';
import { advancePvpBattle, pvpFighter, pvpOutcome, startPvpBattle } from '../../core/prototype/pvp';
import { readPlayerDuel } from '../../core/prototype/simulation';
import { addInstance } from '../../core/prototype/character-state';
import type { SimulationEvent } from '../../core/prototype/types';
import { PVP_RULES } from '../../shared/pvp';
import { checkCheckpoint } from '../../server/client/checkpoint';
import { PvpService } from '../../server/client/pvp';
import { pvpOverviewSchema, pvpStatusSchema } from '../../shared/pvp';
import { MAX_INVENTORY_INSTANCES } from '../../shared/client-save';

const win = { winner: 'attacker' as const, attackerHp: '1', defenderHp: '0', elapsedMs: 1000, timedOut: false };
describe('PVP settlement contracts', () => {
  it.each([MAX_INVENTORY_INSTANCES - 1, MAX_INVENTORY_INSTANCES])(
    'reserves red drops using player capacity with %i held instances, excluding shop stock', async held => {
      const f = pvpFixture();
      const state = f.attacker.save.character;
      state.shop.dayIndex = 0;
      for (let index = 0; index < MAX_INVENTORY_INSTANCES; index++) {
        addInstance(state, state.shop.instances, 'old-wood-hilt', 100);
      }
      for (let index = 0; index < held; index++) addInstance(state, state.instances, 'old-wood-hilt', 100);
      f.store.red(f.defenderId);
      const start = f.start();
      await f.service.start(f.attackerId, start);
      const joined = await f.service.join(f.defenderId, { ...f.defender, battleId: start.battleId });
      if (held === MAX_INVENTORY_INSTANCES) {
        expect(joined).toMatchObject({ status: 'finished', receipt: { status: 'cancelled', message: '行囊器物已满，无法接收红名掉落。' } });
        expect(f.store.snapshots.get(f.attackerId)!.revision).toBe('0');
      } else {
        expect(joined.status).toBe('active');
        expect(await f.service.finish(f.attackerId, { battleId: start.battleId, outcome: win }))
          .toMatchObject({ status: 'finished', receipt: { status: 'settled', gained: { itemId: 'wood-hilt-sword' } } });
        const save = f.store.snapshots.get(f.attackerId)!.save as typeof f.attacker.save;
        expect(Object.keys(save.character.instances)).toHaveLength(MAX_INVENTORY_INSTANCES);
        expect(save.character.shop.instances).toEqual(state.shop.instances);
      }
    });

  it('requires both modes, matching location, life and non-safe territory without accepting an unresponsive target as defeated', async () => {
    const f = pvpFixture();
    f.store.players.get(f.defenderId)!.enabled = false;
    const rejected = await f.service.start(f.attackerId, f.start());
    expect(rejected).toMatchObject({ status: 'finished', receipt: { status: 'cancelled' } });
    expect(f.store.snapshots.get(f.defenderId)!.revision).toBe('0');
    f.store.players.get(f.defenderId)!.enabled = true;
    f.pair.locationId = 'qingshi-village';
    const safe = structuredClone(f.start()); safe.save.character.locationId = 'qingshi-village';
    safe.save.character.simulation.mode = 'rest';
    expect(await f.service.start(f.attackerId, safe)).toMatchObject({ status: 'finished', receipt: { status: 'cancelled' } });
    f.pair.locationId = 'village-outskirts';
    f.attacker.save.character.locationId = 'village-outskirts';
    const waiting = f.start();
    expect(await f.service.start(f.attackerId, waiting)).toMatchObject({ status: 'pending' });
    f.time(PVP_RULES.preparationMs + 1);
    await f.service.sweep();
    expect(await f.service.status(f.attackerId, waiting.battleId)).toMatchObject({ status: 'finished', receipt: { status: 'cancelled' } });
    expect((await f.service.overview(f.defenderId)).state.busy).toBe(false);
    expect(f.store.snapshots.get(f.attackerId)!.revision).toBe('0');
  });
  it('settles once, only transfers worn red equipment, preserves bag assets, and rejects old asset revisions', async () => {
    const f = pvpFixture();
    const regionId = Object.keys(REGIONS).find(id => !SAFE_LOCATIONS[REGIONS[id].parent].meditation &&
      Object.values(SAFE_LOCATIONS).some(location => location.meditation &&
        location.prerequisite === REGIONS[id].prerequisite))!;
    for (const [id, checkpoint] of [[f.attackerId, f.attacker], [f.defenderId, f.defender]] as const) {
      const opened = executeDebugCommand(checkpoint.save.character, { type: 'region', regionId, operation: 'open' });
      checkpoint.save.character = executeCharacterCommand(opened, { type: 'arrive', regionId });
      f.store.seed(id, checkpoint.save);
    }
    f.pair.locationId = regionId;
    f.store.red(f.defenderId);
    const start = f.start();
    await f.service.start(f.attackerId, start);
    await f.service.join(f.defenderId, { ...f.defender, battleId: start.battleId });
    const result = await f.service.finish(f.attackerId, { battleId: start.battleId, outcome: win });
    expect(pvpStatusSchema.parse(result)).toMatchObject({ status: 'finished', receipt: { status: 'settled',
      gained: { itemId: 'wood-hilt-sword', quality: 123 }, state: { notoriety: 0 } } });
    const loser = f.store.snapshots.get(f.defenderId)!.save as typeof f.defender.save;
    const winner = f.store.snapshots.get(f.attackerId)!.save as typeof f.attacker.save;
    expect(loser.character.simulation.player.hp).toBe('0');
    expect(SAFE_LOCATIONS[loser.character.locationId]).toMatchObject({
      meditation: true, prerequisite: REGIONS[regionId].prerequisite,
    });
    expect(loser.character.locationId).not.toBe(REGIONS[regionId].parent);
    expect(loser.character.simulation.mode).toBe('rest');
    expect(loser.character.equipment.weapon).toBeNull();
    expect(Object.values(loser.character.instances)).toEqual([{ itemId: 'wood-hilt-sword', quality: 222 }]);
    expect(Object.values(winner.character.instances)).toEqual([{ itemId: 'wood-hilt-sword', quality: 123 }]);
    expect(loser.character.inventory).toEqual(f.defender.save.character.inventory);
    expect(loser.character.money).toBe(f.defender.save.character.money);
    expect(loser.character.skills).toEqual(f.defender.save.character.skills);
    expect(await f.service.finish(f.attackerId, { battleId: start.battleId, outcome: win })).toEqual(result);
    expect(await f.service.start(f.attackerId, start)).toEqual(result);
    expect(f.store.snapshots.get(f.attackerId)!.revision).toBe('1');
    expect(() => checkCheckpoint(f.store.snapshots.get(f.attackerId)!, {
      baseRevision: '1', save: f.attacker.save,
    }, 0)).toThrow('交易版本');
    await expect(f.service.status(randomUUID(), start.battleId)).rejects.toThrow('无权');
  });
  it('makes proactive wins notorious, locks red mode, and clears red only through a PVP loss even on attacker timeout', async () => {
    const f = pvpFixture();
    f.store.players.get(f.attackerId)!.notoriety = PVP_RULES.redThreshold - PVP_RULES.notorietyPerWin;
    const start = f.start();
    await f.service.start(f.attackerId, start);
    await f.service.join(f.defenderId, { ...f.defender, battleId: start.battleId });
    await f.service.finish(f.attackerId, { battleId: start.battleId, outcome: win });
    expect((await f.service.overview(f.attackerId)).state.red).toBe(true);
    await expect(f.service.mode(f.attackerId, false)).rejects.toThrow('红名');
    const next = pvpFixture(false);
    next.attacker.save = checkpoint(true).save;
    next.store.seed(next.attackerId, next.attacker.save);
    next.store.red(next.attackerId);
    const attack = next.start();
    await next.service.start(next.attackerId, attack);
    await next.service.join(next.defenderId, { ...next.defender, battleId: attack.battleId });
    next.time(PVP_RULES.settlementMs + 1);
    const restarted = new PvpService(
      next.store, next.coordinator, () => PVP_RULES.settlementMs + 1);
    await restarted.sweep();
    const result = await restarted.status(next.attackerId, attack.battleId);
    expect(result).toMatchObject({ status: 'finished', receipt: { won: false, hp: '0',
      lost: { uid: next.attacker.save.character.equipment.weapon }, state: { red: false, notoriety: 0 } } });
    expect(await restarted.status(next.defenderId, attack.battleId)).toMatchObject({
      status: 'finished', receipt: { won: true, gained: {
        ...next.attacker.save.character.instances[next.attacker.save.character.equipment.weapon!],
      } },
    });
    const loser = next.store.snapshots.get(next.attackerId)!.save as typeof next.attacker.save;
    expect(loser.character.equipment.weapon).toBeNull();
    expect(Object.values(loser.character.instances)).toEqual([{ itemId: 'wood-hilt-sword', quality: 222 }]);
    expect((await restarted.overview(next.defenderId)).state.notoriety).toBe(0);
    pvpOverviewSchema.parse(await restarted.overview(next.attackerId));
  });
  it('rolls both saves and receipts back on storage failure and prevents concurrent reservations and mismatched reports', async () => {
    const f = pvpFixture();
    f.store.red(f.defenderId);
    const start = f.start();
    await f.service.start(f.attackerId, start);
    const overlap = await f.service.start(f.attackerId, f.start());
    expect(overlap).toMatchObject({ status: 'finished', receipt: { status: 'cancelled' } });
    expect(f.store.players.get(f.attackerId)!.battleId).toBe(start.battleId);
    await f.service.join(f.defenderId, { ...f.defender, battleId: start.battleId });
    await expect(f.service.finish(f.defenderId, { battleId: start.battleId, outcome: win })).rejects.toThrow('攻击者');
    await expect(f.service.finish(f.attackerId, { battleId: start.battleId, outcome: { ...win, defenderHp: '1' } })).rejects.toThrow('气血');
    f.store.failWrite = true;
    await expect(f.service.finish(f.attackerId, { battleId: start.battleId, outcome: win })).rejects.toThrow('storage failed');
    expect(f.store.snapshots.get(f.attackerId)!.revision).toBe('0');
    expect(f.store.battles.get(start.battleId)!.phase).toBe('active');
    expect(f.store.battles.get(start.battleId)!.receipts).toHaveLength(0);
    f.store.failWrite = false;
    await f.service.finish(f.attackerId, { battleId: start.battleId, outcome: win });
    expect(f.store.snapshots.get(f.defenderId)!.revision).toBe('1');
  });
  it('runs shared combat identically across slices and reloaded checkpoints without PVE rewards or growth', () => {
    const f = pvpFixture();
    const attacker = pvpFighter(f.attacker.save.character, '甲'), defender = pvpFighter(f.defender.save.character, '乙');
    attacker.effects = [{ id: 'hp-test', remainingMs: 500, source: { id: 'hp-test', multiplier: { maxHp: '2' } } }];
    attacker.hp = '75';
    const battle = { battleId: randomUUID(), seed: 19, expiresAt: 1000, attacker, defender };
    const copy = structuredClone(battle);
    const initial = startPvpBattle(battle);
    const result = advancePvpBattle(initial, PVP_RULES.combatLimitMs);
    let sliced = initial;
    const events: SimulationEvent[] = [];
    for (let target = 250; target <= PVP_RULES.combatLimitMs && sliced.attacker.battle; target += 250) {
      const next = advancePvpBattle(readPlayerDuel(JSON.parse(JSON.stringify(sliced))), target);
      sliced = next.state; events.push(...next.events);
    }
    expect(sliced).toEqual(result.state);
    expect(events).toEqual(result.events);
    expect(battle).toEqual(copy);
    expect(pvpOutcome(battle, initial)).toBeNull();
    expect(pvpOutcome(battle, sliced)).not.toBeNull();
    expect(events.some(event => event.kind === 'enemy-defeated' || event.kind === 'group-cleared')).toBe(false);
    expect(events.some(event => event.kind === 'strike' && event.side === 'player')).toBe(true);
    expect(events.some(event => event.kind === 'strike' && event.side === 'enemy')).toBe(true);
    expect(sliced.attacker.clearedGroups).toEqual({});
    expect(sliced.defender.clearedGroups).toEqual({});
    expect(f.attacker.save.character.simulation.actionCounts.basicAttack).toBe('0');
    expect(f.attacker.save).toEqual(f.store.snapshots.get(f.attackerId)!.save);
  });
  it('uses player segments and defensive caps on both sides and stops on lethal effect pulses', () => {
    const f = pvpFixture(false);
    const attacker = pvpFighter(f.attacker.save.character, '甲'), defender = structuredClone(attacker);
    for (const fighter of [attacker, defender]) {
      fighter.hp = '1000';
      fighter.base = { ...fighter.base, maxHp: '1000', attack: '1000', defense: '0', hpRegen: '0', attackSpeed: '1' };
      fighter.sources = [{
        id: 'duel-contract',
        combat: { attackCoefficients: ['1', '1'], damageTakenCap: { threshold: '0.01', value: '0.005' } },
        modifiers: [{ target: 'damage.taken', operation: 'multiply', value: '0.5' }],
      }];
    }
    const battle = { battleId: randomUUID(), seed: 19, expiresAt: PVP_RULES.settlementMs, attacker, defender };
    const first = advancePvpBattle(startPvpBattle(battle), 1000);
    const strikes = first.events.filter(event => event.kind === 'strike');
    expect(strikes.filter(event => event.side === 'player')).toHaveLength(2);
    expect(strikes.filter(event => event.side === 'enemy')).toHaveLength(2);
    expect(strikes.filter(event => event.hit).length).toBeGreaterThan(0);
    expect(strikes.every(event => event.damage === (event.hit ? '2.5' : '0'))).toBe(true);
    const timeout = advancePvpBattle(startPvpBattle(battle), PVP_RULES.combatLimitMs);
    expect(pvpOutcome(battle, timeout.state)).toMatchObject({
      winner: 'defender', attackerHp: '0', elapsedMs: PVP_RULES.combatLimitMs, timedOut: true,
    });
    for (const side of ['attacker', 'defender'] as const) {
      const poisoned = structuredClone(battle);
      poisoned[side].effects = [{ id: 'cost', remainingMs: 5000, source: { id: 'cost', flat: { hpRegen: '-10000' } } }];
      const result = advancePvpBattle(startPvpBattle(poisoned), 1000);
      expect(result.state.attacker.battle).toBeNull();
      expect(result.state.defender.battle).toBeNull();
      expect(result.state[side].player.hp).toBe('0');
      expect(pvpOutcome(poisoned, result.state)?.winner).toBe(side === 'attacker' ? 'defender' : 'attacker');
    }
  });
});
