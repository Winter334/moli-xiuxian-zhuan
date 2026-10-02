import { createHash, randomInt } from 'node:crypto';
import { dec } from '../../core/numbers';
import { SAFE_LOCATIONS } from '../../core/prototype/content';
import { storedShops } from '../../core/prototype/character-state';
import { getPlayerStats } from '../../core/prototype/simulation';
import { applyPvpReceipt, pvpDropCandidates, pvpFighter } from '../../core/prototype/pvp';
import { readClientSave } from '../../shared/client-save';
import {
  PVP_RULES, pvpFinishSchema, pvpJoinSchema, pvpStartSchema, type PvpOutcome,
  type PvpReceipt, type PvpState, type PvpStatus,
} from '../../shared/pvp';
import { ApiError } from '../errors';
import { checkCheckpoint } from './checkpoint';
import type { PvpCheckpoint, PvpPair, PvpPlayer, PvpStore, PvpTransaction, StoredBattle } from './pvp-store';

export interface PvpCoordinator {
  pair(attackerId: string, target: string): PvpPair;
  check(pair: PvpPair): void;
  prepare(pair: PvpPair, battleId: string): void;
  notify(id: string, state: PvpState, battleId?: string): void;
}
const reject = (message: string) => new ApiError(409, 'PVP_UNAVAILABLE', message);
const publicState = ({ battleId: _id, ...state }: PvpPlayer): PvpState => state;
function setPlayer(player: PvpPlayer, patch: Partial<PvpPlayer>): PvpPlayer {
  const next = { ...player, ...patch };
  next.red = next.notoriety >= PVP_RULES.redThreshold;
  next.busy = next.battleId !== null;
  return next;
}
export class PvpService {
  constructor(private readonly store: PvpStore, private readonly coordinator: PvpCoordinator,
    private readonly now = Date.now,
    private readonly choose: (min: number, max?: number) => number = (min, max) => max === undefined ? randomInt(min) : randomInt(min, max)) {}

  async overview(id: string) {
    const meta = await this.store.player(id);
    if (meta.battleId) await this.status(id, meta.battleId);
    const current = await this.store.player(id);
    return { state: publicState(current), battleId: current.battleId, serverTime: this.now() };
  }
  async mode(id: string, enabled: boolean): Promise<PvpState> {
    const result = await this.store.transact([id], async tx => {
      const player = tx.players.get(id)!;
      if (player.enabled === enabled) return publicState(player);
      if (player.busy) throw reject('战斗正在核对，暂不能切换模式。');
      if (!enabled && player.red) throw reject('红名期间不能关闭PVP，须被其他修士击败。');
      if (this.now() < player.modeAfter) throw reject('模式切换尚在冷却。');
      const next = setPlayer(player, { enabled, modeAfter: this.now() + PVP_RULES.modeCooldownMs });
      await tx.writePlayer(id, next);
      return publicState(next);
    });
    this.coordinator.notify(id, result);
    return result;
  }
  private response(battle: StoredBattle, id: string): PvpStatus {
    if (id !== battle.attackerId && id !== battle.defenderId) throw new ApiError(403, 'PVP_IDENTITY', '无权查看此战斗。');
    if (battle.phase === 'finished') return { status: 'finished', receipt: battle.receipts.find(r => r.characterId === id)! };
    if (battle.phase === 'active') return { status: 'active', battle: id === battle.attackerId ? battle.battle : null };
    return { status: 'pending', expiresAt: battle.expiresAt };
  }
  private receipt(battle: StoredBattle, id: string, checkpoint: PvpCheckpoint, message: string): PvpReceipt {
    const save = checkpoint.save;
    return {
      battleId: battle.id, characterId: id, status: 'cancelled', baseRevision: checkpoint.baseRevision,
      revision: checkpoint.baseRevision, tradeRevision: save.tradeRevision, life: save.character.life.number,
      checkpointClockMs: save.character.simulation.clockMs, playedMs: save.playedMs, settledAt: this.now(),
      opponent: id === battle.attackerId ? battle.pair?.defenderName ?? '对方' : battle.pair?.attackerName ?? '对方',
      won: false, hp: save.character.simulation.player.hp, lost: null, gained: null,
      state: { enabled: false, notoriety: 0, red: false, busy: false, modeAfter: 0, attackAfter: 0, protectedUntil: 0 },
      message, requiresRecovery: false,
    };
  }
  private async cancel(tx: PvpTransaction, battle: StoredBattle, message: string, recoveryId?: string) {
    battle.phase = 'finished';
    for (const id of [battle.attackerId, battle.defenderId].filter((value): value is string => Boolean(value))) {
      const checkpoint = id === battle.attackerId ? battle.attacker : battle.defender ?? {
        baseRevision: tx.snapshots.get(id)!.revision, save: readClientSave(tx.snapshots.get(id)!.save),
      };
      const meta = tx.players.get(id)!;
      const next = meta.battleId === battle.id ? setPlayer(meta, { battleId: null }) : meta;
      const receipt = this.receipt(battle, id, checkpoint, message);
      receipt.state = publicState(next); receipt.requiresRecovery = id === recoveryId;
      battle.receipts.push(receipt);
      await tx.writePlayer(id, next);
    }
    await tx.writeBattle(battle);
  }
  private requireCombat(checkpoint: PvpCheckpoint, location: string) {
    const character = checkpoint.save.character;
    if (character.locationId !== location || Object.hasOwn(SAFE_LOCATIONS, location)) throw reject('安全区或不同地点不能袭击。');
    if (dec(character.simulation.player.hp).lte(0)) throw reject('气血已尽，不能参与袭击。');
  }
  async start(id: string, raw: unknown): Promise<PvpStatus> {
    const input = pvpStartSchema.parse(raw);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const old = await this.store.battle(input.battleId);
    if (old) {
      if (old.attackerId !== id || old.hash !== hash) throw reject('战斗编号已用于另一份请求。');
      return this.status(id, old.id);
    }
    let pair: PvpPair | null = null, reason: string | null = null;
    try { pair = this.coordinator.pair(id, input.target); }
    catch (error) { reason = error instanceof ApiError ? error.message : '对方不在线。'; }
    const result = await this.store.transact(pair ? [id, pair.defenderId] : [id], async tx => {
      const existing = await tx.battle(input.battleId);
      if (existing) {
        if (existing.attackerId !== id || existing.hash !== hash) throw reject('战斗编号已用于另一份请求。');
        return this.response(existing, id);
      }
      const battle: StoredBattle = {
        id: input.battleId, attackerId: id, defenderId: pair?.defenderId ?? null, target: input.target, hash, pair,
        attacker: { baseRevision: input.baseRevision, save: input.save }, defender: null,
        phase: 'preparing', expiresAt: this.now() + PVP_RULES.preparationMs, battle: null, outcome: null, receipts: [],
      };
      try {
        battle.attacker.save = checkCheckpoint(tx.snapshots.get(id)!, input, this.now());
        if (reason || !pair) throw reject(reason ?? '对方不在线。');
        this.coordinator.check(pair);
        this.requireCombat(battle.attacker, pair.locationId);
        const attacker = tx.players.get(id)!, defender = tx.players.get(pair.defenderId)!;
        if (!attacker.enabled || !defender.enabled) throw reject('双方必须开启PVP模式。');
        if (attacker.busy || defender.busy) throw reject('有修士正在战斗核对中。');
        if (this.now() < attacker.attackAfter) throw reject('袭击尚在冷却。');
        if (this.now() < attacker.protectedUntil || this.now() < defender.protectedUntil) throw reject('败退保护期间不能袭击或受袭。');
        await tx.writeBattle(battle);
        await tx.writePlayer(id, setPlayer(attacker, { battleId: battle.id }));
        await tx.writePlayer(pair.defenderId, setPlayer(defender, { battleId: battle.id }));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        await this.cancel(tx, battle, error.message, ['SAVE_CONFLICT', 'TRADE_CONFLICT', 'SAVE_REJECTED'].includes(error.code) ? id : undefined);
      }
      return this.response(battle, id);
    });
    if (result.status === 'pending' && pair) this.coordinator.prepare(pair, input.battleId);
    await this.notifyBattle(input.battleId);
    return result;
  }
  async join(id: string, raw: unknown): Promise<PvpStatus> {
    const input = pvpJoinSchema.parse(raw);
    return this.withBattle(id, input.battleId, async (tx, battle) => {
      if (id !== battle.defenderId) throw reject('只有被袭击者可以提交防卫检查点。');
      if (battle.phase !== 'preparing') return;
      if (this.now() >= battle.expiresAt) { await this.cancel(tx, battle, '对方未及时响应，袭击未成立。'); return; }
      battle.defender = { baseRevision: input.baseRevision, save: input.save };
      try {
        battle.defender.save = checkCheckpoint(tx.snapshots.get(id)!, input, this.now());
        this.coordinator.check(battle.pair!);
        this.requireCombat(battle.defender, battle.pair!.locationId);
        const attacker = tx.players.get(battle.attackerId)!, defender = tx.players.get(id)!;
        if (!attacker.enabled || !defender.enabled || attacker.battleId !== battle.id || defender.battleId !== battle.id) throw reject('PVP状态已变化。');
        for (const [own, other, meta] of [
          [battle.attacker, battle.defender, defender], [battle.defender, battle.attacker, attacker],
        ] as const) {
          const state = own.save.character;
          const count = [state, ...storedShops(state).map(s => s.stock)].reduce((n, owner) => n + Object.keys(owner.instances).length, 0);
          if (meta.red && pvpDropCandidates(other.save.character).length && count >= 1000) throw reject('行囊器物已满，无法接收红名掉落。');
        }
        battle.phase = 'active';
        battle.expiresAt = this.now() + PVP_RULES.settlementMs;
        battle.battle = {
          battleId: battle.id, expiresAt: battle.expiresAt, seed: this.choose(1, 0x1_0000_0000),
          attacker: pvpFighter(battle.attacker.save.character, battle.pair!.attackerName, battle.pair!.attackerAvatar),
          defender: pvpFighter(battle.defender.save.character, battle.pair!.defenderName, battle.pair!.defenderAvatar),
        };
        await tx.writePlayer(battle.attackerId, setPlayer(attacker, { attackAfter: this.now() + PVP_RULES.attackCooldownMs }));
        await tx.writeBattle(battle);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        await this.cancel(tx, battle, error.message, ['SAVE_CONFLICT', 'TRADE_CONFLICT', 'SAVE_REJECTED'].includes(error.code) ? id : undefined);
      }
    });
  }
  async finish(id: string, raw: unknown) {
    const input = pvpFinishSchema.parse(raw);
    return this.withBattle(id, input.battleId, async (tx, battle) => {
      if (id !== battle.attackerId) throw reject('只有攻击者可以提交推演结果。');
      if (battle.phase === 'finished') return;
      if (battle.phase !== 'active') throw reject('对方尚未准备好。');
      if (this.now() >= battle.expiresAt) { await this.expire(tx, battle); return; }
      const result = input.outcome, winnerHp = result.winner === 'attacker' ? result.attackerHp : result.defenderHp;
      if (dec(winnerHp).lte(0) || (result.winner === 'attacker' ? result.defenderHp : result.attackerHp) !== '0' ||
          (result.timedOut && (result.winner !== 'defender' || result.elapsedMs !== PVP_RULES.combatLimitMs)) ||
          dec(result.attackerHp).gt(getPlayerStats(battle.attacker.save.character.simulation).maxHp) ||
          dec(result.defenderHp).gt(getPlayerStats(battle.defender!.save.character.simulation).maxHp)) {
        throw reject('战斗结果的气血或胜负不一致，请核对原战斗。');
      }
      await this.settle(tx, battle, result);
    });
  }
  private async settle(tx: PvpTransaction, battle: StoredBattle, outcome: PvpOutcome) {
    const winnerId = outcome.winner === 'attacker' ? battle.attackerId : battle.defenderId!;
    const loserId = outcome.winner === 'attacker' ? battle.defenderId! : battle.attackerId;
    const loserCheckpoint = loserId === battle.attackerId ? battle.attacker : battle.defender!;
    const loserRed = tx.players.get(loserId)!.red;
    const candidates = loserRed ? pvpDropCandidates(loserCheckpoint.save.character) : [];
    const lost = candidates.length ? candidates[this.choose(candidates.length)] : null;
    for (const id of [battle.attackerId, battle.defenderId!]) {
      const checkpoint = id === battle.attackerId ? battle.attacker : battle.defender!;
      if (tx.snapshots.get(id)!.revision !== checkpoint.baseRevision) throw new Error('Reserved PVP revision changed');
      const meta = tx.players.get(id)!;
      const notoriety = id === loserId ? 0 : id === battle.attackerId && !loserRed
        ? Math.min(1_000_000, meta.notoriety + PVP_RULES.notorietyPerWin) : meta.notoriety;
      const next = setPlayer(meta, { battleId: null, notoriety,
        protectedUntil: id === loserId ? this.now() + PVP_RULES.defeatProtectionMs : meta.protectedUntil });
      const receipt = this.receipt(battle, id, checkpoint,
        id === winnerId ? `你击败了${id === battle.attackerId ? battle.pair!.defenderName : battle.pair!.attackerName}。`
          : `你被${id === battle.attackerId ? battle.pair!.defenderName : battle.pair!.attackerName}击败，败退至安全点。`);
      Object.assign(receipt, {
        status: 'settled', won: id === winnerId, revision: String(BigInt(checkpoint.baseRevision) + 1n),
        tradeRevision: String(BigInt(checkpoint.save.tradeRevision) + 1n),
        hp: id === battle.attackerId ? outcome.attackerHp : outcome.defenderHp,
        lost: id === loserId ? lost : null, gained: id === winnerId ? lost?.instance ?? null : null, state: publicState(next),
      });
      const save = readClientSave({ ...checkpoint.save, tradeRevision: receipt.tradeRevision,
        character: applyPvpReceipt(checkpoint.save.character, receipt) });
      await tx.writeSave(id, save, this.now());
      await tx.writePlayer(id, next);
      battle.receipts.push(receipt);
    }
    battle.phase = 'finished'; battle.outcome = outcome;
    await tx.writeBattle(battle);
  }
  private async expire(tx: PvpTransaction, battle: StoredBattle) {
    if (battle.phase === 'preparing') await this.cancel(tx, battle, '对方未及时响应，袭击未成立。');
    else if (battle.phase === 'active') await this.settle(tx, battle, {
      winner: 'defender', attackerHp: '0', defenderHp: battle.defender!.save.character.simulation.player.hp,
      elapsedMs: PVP_RULES.combatLimitMs, timedOut: true,
    });
  }
  private async withBattle(id: string, battleId: string, work: (tx: PvpTransaction, battle: StoredBattle) => Promise<void>): Promise<PvpStatus> {
    const original = await this.store.battle(battleId);
    if (!original) return { status: 'unknown' };
    this.response(original, id);
    const result = await this.store.transact([original.attackerId, ...(original.defenderId ? [original.defenderId] : [])], async tx => {
      const battle = (await tx.battle(battleId))!;
      await work(tx, battle);
      return this.response(battle, id);
    });
    await this.notifyBattle(battleId);
    return result;
  }
  status(id: string, battleId: string): Promise<PvpStatus> {
    return this.withBattle(id, battleId, async (tx, battle) => {
      if (battle.phase !== 'finished' && this.now() >= battle.expiresAt) await this.expire(tx, battle);
    });
  }
  private async notifyBattle(battleId: string) {
    const battle = await this.store.battle(battleId);
    if (!battle) return;
    for (const id of [battle.attackerId, battle.defenderId].filter((id): id is string => Boolean(id))) {
      this.coordinator.notify(id, publicState(await this.store.player(id)), battleId);
    }
  }
  async sweep() {
    for (const id of await this.store.expired(this.now())) {
      const battle = await this.store.battle(id);
      if (battle) await this.status(battle.attackerId, id);
    }
  }
}
