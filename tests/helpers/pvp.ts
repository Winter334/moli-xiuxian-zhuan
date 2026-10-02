import { randomUUID } from 'node:crypto';
import { createCharacter, addInstance, readCharacter, synchronizeCharacter } from '../../core/prototype/character-state';
import { EMPTY_PVP, PVP_RULES } from '../../shared/pvp';
import { readClientSave, type ClientSave } from '../../shared/client-save';
import type { PvpCheckpoint, PvpPair, PvpPlayer, PvpStore, PvpTransaction, StoredBattle } from '../../server/client/pvp-store';
import type { CloudSnapshot } from '../../server/client/repository';
import { PvpService, type PvpCoordinator } from '../../server/client/pvp';
import { ApiError } from '../../server/errors';

export function checkpoint(equipped = false): PvpCheckpoint {
  const state = createCharacter(0, 19);
  state.locationId = 'village-outskirts';
  state.simulation.mode = 'idle';
  if (equipped) {
    state.equipment.weapon = addInstance(state, state.instances, 'wood-hilt-sword', 123);
    addInstance(state, state.instances, 'wood-hilt-sword', 222);
    synchronizeCharacter(state);
  }
  return { baseRevision: '0', save: {
    format: 'opening-client-2', tradeRevision: '0', playedMs: 0, character: readCharacter(state),
  } };
}
export class MemoryPvp implements PvpStore {
  snapshots = new Map<string, CloudSnapshot>();
  players = new Map<string, PvpPlayer>();
  battles = new Map<string, StoredBattle>();
  failWrite = false;
  private queue: Promise<unknown> = Promise.resolve();
  async battle(id: string) { return structuredClone(this.battles.get(id) ?? null); }
  async player(id: string) { return structuredClone(this.players.get(id)!); }
  async expired(now: number) { return [...this.battles.values()].filter(b => b.phase !== 'finished' && b.expiresAt <= now).map(b => b.id); }
  transact<T>(ids: string[], work: (tx: PvpTransaction) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const snapshots = structuredClone(this.snapshots), players = structuredClone(this.players), battles = structuredClone(this.battles);
      const result = await work({
        snapshots: new Map(ids.map(id => [id, snapshots.get(id)!])),
        players: new Map(ids.map(id => [id, players.get(id)!])),
        battle: async id => structuredClone(battles.get(id) ?? null),
        writeBattle: async battle => { battles.set(battle.id, structuredClone(battle)); },
        writePlayer: async (id, player) => { players.set(id, structuredClone(player)); },
        writeSave: async (id, save, now) => {
          if (this.failWrite) throw new Error('storage failed');
          const old = snapshots.get(id)!;
          snapshots.set(id, { save: readClientSave(save), revision: String(BigInt(old.revision) + 1n),
            receivedAt: now, lastRequestId: null, lastPayloadHash: null });
        },
      });
      this.snapshots = snapshots; this.players = players; this.battles = battles;
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  seed(id: string, save: ClientSave) {
    this.snapshots.set(id, { save, revision: '0', receivedAt: 0, lastRequestId: null, lastPayloadHash: null });
    this.players.set(id, { ...EMPTY_PVP, enabled: true, battleId: null });
  }
  red(id: string) { Object.assign(this.players.get(id)!, { red: true, notoriety: PVP_RULES.redThreshold }); }
}
export function pvpFixture(equipped = true) {
  const attackerId = randomUUID(), defenderId = randomUUID(), target = 'a'.repeat(32);
  const store = new MemoryPvp(), attacker = checkpoint(), defender = checkpoint(equipped);
  store.seed(attackerId, attacker.save); store.seed(defenderId, defender.save);
  let now = 0, online = true;
  const pair: PvpPair = { attackerId, defenderId, attackerName: '甲', defenderName: '乙',
    locationId: 'village-outskirts', attackerSession: randomUUID(), defenderSession: randomUUID() };
  const coordinator: PvpCoordinator = {
    pair: () => { if (!online) throw new ApiError(409, 'PLAYER_UNAVAILABLE', '对方已离开'); return { ...pair }; },
    check: () => { if (!online) throw new ApiError(409, 'PLAYER_UNAVAILABLE', '对方已离开'); },
    prepare: () => {}, notify: () => {},
  };
  const service = new PvpService(store, coordinator, () => now, (min, max) => max === undefined ? 0 : min);
  const start = (battleId = randomUUID()) => ({ ...attacker, battleId, target });
  return { store, service, attackerId, defenderId, target, attacker, defender, pair, coordinator, start,
    time: (value: number) => { now = value; }, offline: () => { online = false; } };
}
