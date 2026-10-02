import type { Pool, PoolClient } from 'pg';
import type { ClientSave } from '../../shared/client-save';
import type { PvpBattleInfo, PvpOutcome, PvpReceipt, PvpState } from '../../shared/pvp';
import { EMPTY_PVP, PVP_RULES } from '../../shared/pvp';
import { inTransaction } from '../database';
import { ApiError } from '../errors';
import type { CloudSnapshot } from './repository';

export interface PvpPair {
  attackerId: string; defenderId: string; attackerName: string; defenderName: string;
  locationId: string; attackerSession: string; defenderSession: string;
  attackerAvatar?: string | null; defenderAvatar?: string | null;
}
export interface PvpCheckpoint { baseRevision: string; save: ClientSave }
export interface StoredBattle {
  id: string; attackerId: string; defenderId: string | null; target: string; hash: string;
  pair: PvpPair | null; attacker: PvpCheckpoint; defender: PvpCheckpoint | null;
  phase: 'preparing' | 'active' | 'finished'; expiresAt: number;
  battle: PvpBattleInfo | null; outcome: PvpOutcome | null; receipts: PvpReceipt[];
}
export interface PvpPlayer extends PvpState { battleId: string | null }
export interface PvpTransaction {
  snapshots: Map<string, CloudSnapshot>; players: Map<string, PvpPlayer>;
  battle(id: string): Promise<StoredBattle | null>;
  writeBattle(battle: StoredBattle): Promise<void>;
  writePlayer(id: string, player: PvpPlayer): Promise<void>;
  writeSave(id: string, save: ClientSave, now: number): Promise<void>;
}
export interface PvpStore {
  transact<T>(ids: string[], work: (tx: PvpTransaction) => Promise<T>): Promise<T>;
  battle(id: string): Promise<StoredBattle | null>;
  player(id: string): Promise<PvpPlayer>;
  expired(now: number): Promise<string[]>;
}
type Queryable = Pick<PoolClient, 'query'>;
const playerColumns = `enabled, notoriety, mode_after::float8 AS "modeAfter",
  attack_after::float8 AS "attackAfter", protected_until::float8 AS "protectedUntil",
  active_battle_id AS "battleId"`;
function player(row?: Partial<PvpPlayer>): PvpPlayer {
  const result = { ...EMPTY_PVP, battleId: null, ...row };
  return { ...result, red: result.notoriety >= PVP_RULES.redThreshold, busy: result.battleId !== null };
}
async function readBattle(db: Queryable, id: string) {
  const rows = await db.query<{ state: StoredBattle }>('SELECT state FROM moli_client.pvp_battles WHERE id = $1', [id]);
  return rows.rows[0]?.state ?? null;
}
export async function requireNoPvp(db: Queryable, id: string) {
  const rows = await db.query('SELECT 1 FROM moli_client.pvp_players WHERE character_id = $1 AND active_battle_id IS NOT NULL', [id]);
  if (rows.rowCount) throw new ApiError(423, 'PVP_BUSY', '袭击正在核对，请先等待战斗结果。');
}
export class PvpRepository implements PvpStore {
  constructor(private readonly pool: Pool) {}
  battle(id: string) { return readBattle(this.pool, id); }
  async player(id: string) {
    const rows = await this.pool.query<PvpPlayer>(`SELECT ${playerColumns} FROM moli_client.pvp_players WHERE character_id = $1`, [id]);
    return player(rows.rows[0]);
  }
  async expired(now: number) {
    const rows = await this.pool.query<{ id: string }>(
      'SELECT id FROM moli_client.pvp_battles WHERE NOT finished AND expires_at <= $1 ORDER BY expires_at LIMIT 100', [now]);
    return rows.rows.map(row => row.id);
  }
  async transact<T>(ids: string[], work: (tx: PvpTransaction) => Promise<T>): Promise<T> {
    return inTransaction(this.pool, async db => {
      const snapshots = new Map<string, CloudSnapshot>(), players = new Map<string, PvpPlayer>();
      // All asset writers lock characters first; pairs use a stable order.
      for (const id of [...new Set(ids)].sort()) {
        const rows = await db.query<CloudSnapshot>(`SELECT save, revision::text, received_at::float8 AS "receivedAt",
          last_request_id AS "lastRequestId", last_payload_hash AS "lastPayloadHash"
          FROM moli_client.characters WHERE id = $1 FOR NO KEY UPDATE`, [id]);
        if (!rows.rows[0]) throw new ApiError(401, 'UNAUTHENTICATED', '角色身份已失效。');
        snapshots.set(id, rows.rows[0]);
        await db.query('INSERT INTO moli_client.pvp_players(character_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
        const meta = await db.query<PvpPlayer>(`SELECT ${playerColumns} FROM moli_client.pvp_players WHERE character_id = $1`, [id]);
        players.set(id, player(meta.rows[0]));
      }
      return work({
        snapshots, players, battle: id => readBattle(db, id),
        writeBattle: async battle => {
          const result = await db.query(`INSERT INTO moli_client.pvp_battles(id, attacker_id, defender_id, state, expires_at, finished)
            VALUES ($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(id) DO UPDATE SET state = EXCLUDED.state,
            expires_at = EXCLUDED.expires_at, finished = EXCLUDED.finished
            WHERE moli_client.pvp_battles.attacker_id = EXCLUDED.attacker_id`,
          [battle.id, battle.attackerId, battle.defenderId, JSON.stringify(battle), battle.expiresAt, battle.phase === 'finished']);
          if (result.rowCount !== 1) throw new ApiError(409, 'PVP_IDENTITY', '战斗编号已被占用。');
        },
        writePlayer: async (id, value) => {
          await db.query(`UPDATE moli_client.pvp_players SET enabled=$2, notoriety=$3, mode_after=$4,
            attack_after=$5, protected_until=$6, active_battle_id=$7 WHERE character_id=$1`,
          [id, value.enabled, value.notoriety, value.modeAfter, value.attackAfter, value.protectedUntil, value.battleId]);
        },
        writeSave: async (id, save, now) => {
          const updated = await db.query(`UPDATE moli_client.characters SET save=$2::jsonb, revision=revision+1,
            received_at=$3, last_request_id=NULL, last_payload_hash=NULL WHERE id=$1 AND revision=$4::bigint`,
          [id, JSON.stringify(save), now, snapshots.get(id)!.revision]);
          if (updated.rowCount !== 1) throw new Error('Locked PVP checkpoint changed');
        },
      });
    });
  }
}
