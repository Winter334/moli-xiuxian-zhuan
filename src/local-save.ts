import { cultivationCarryCap } from '../core/prototype/growth';
import { z } from 'zod';
import { dec } from '../core/numbers';
import {
  clientSaveSchema, MAX_SAVE_BYTES, readClientSave, revisionSchema, uploadSchema, type CloudProfile,
} from '../shared/client-save';
import { checkReservedCapacity, pendingTradeSchema, validateReservation } from './trade-reservation';
import { reincarnationRequestSchema } from '../shared/reincarnation';
import { pendingPvpSchema, PVP_RULES } from '../shared/pvp';
import { readPlayerDuel } from '../core/prototype/simulation';

export const LOCAL_SAVE_KEY = 'moli.client-save.v1';
// Current and pending snapshots plus envelope overhead; leave room for a recovery copy.
export const MAX_LOCAL_SAVE_CHARS = 2 * MAX_SAVE_BYTES + 64 * 1024;
const localSchema = z.object({
  format: z.literal('opening-local-4'),
  characterId: z.uuid(),
  save: clientSaveSchema,
  wallSavedAt: z.number().int().nonnegative(),
  worldClock: z.object({
    timeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    wallMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  localRevision: revisionSchema,
  cloudRevision: revisionSchema,
  uploadedRevision: revisionSchema,
  pending: z.object({ request: uploadSchema, localRevision: revisionSchema }).strict().nullable(),
  pendingTrade: pendingTradeSchema.nullable(),
  pendingReincarnation: reincarnationRequestSchema.nullable(),
  pendingPvp: pendingPvpSchema.nullable().default(null),
  syncConflict: z.string().min(1).max(1000).nullable(),
}).strict();
export type LocalSave = z.infer<typeof localSchema>;
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;
export class LocalSaveReadError extends Error {
  constructor(message: string, readonly recoveryContext: LocalSave | null = null) { super(message); }
}

function readLocalSave(raw: unknown): LocalSave {
  const local = localSchema.parse(raw);
  local.save = readClientSave(local.save);
  if (BigInt(local.uploadedRevision) > BigInt(local.localRevision)) throw new Error('本地存档进度编号不一致');
  if (local.pending) {
    local.pending.request.save = readClientSave(local.pending.request.save);
    if (local.pending.request.characterId !== local.characterId ||
        JSON.stringify(local.pending.request.save.character.life) !== JSON.stringify(local.save.character.life) ||
        local.pending.request.save.character.fateId !== local.save.character.fateId ||
        local.pending.request.baseRevision !== local.cloudRevision ||
        BigInt(local.pending.localRevision) > BigInt(local.localRevision)) throw new Error('待上传存档与本地身份不一致');
  }
  if (local.pendingTrade) {
    const pending = local.pendingTrade;
    pending.request.save = readClientSave(pending.request.save);
    if (local.pending || pending.request.characterId !== local.characterId ||
        JSON.stringify(pending.request.save.character.life) !== JSON.stringify(local.save.character.life) ||
        pending.request.save.character.fateId !== local.save.character.fateId ||
        pending.request.baseRevision !== local.cloudRevision ||
        pending.request.save.tradeRevision !== local.save.tradeRevision ||
        BigInt(pending.localRevision) > BigInt(local.localRevision)) throw new Error('待确认交易与本地检查点不一致');
    validateReservation(pending);
    checkReservedCapacity(local.save.character, pending);
  }
  if (local.pendingReincarnation) {
    const pending = local.pendingReincarnation;
    pending.save = readClientSave(pending.save);
    if (local.pending || local.pendingTrade || pending.characterId !== local.characterId ||
        pending.baseRevision !== local.cloudRevision || JSON.stringify(pending.save) !== JSON.stringify(local.save)) {
      throw new Error('待确认轮回与冻结的本世检查点不一致');
    }
  }
  if (local.pendingPvp && (local.pending || local.pendingTrade || local.pendingReincarnation ||
      local.pendingPvp.baseRevision !== local.cloudRevision)) throw new Error('PVP检查点与本地身份不一致');
  const pending = local.pendingPvp, combat = pending?.combat;
  if (pending && combat) {
    if (pending.role !== 'attacker' || pending.battle?.battleId !== pending.battleId ||
        combat.attacker.clockMs > PVP_RULES.combatLimitMs) throw new Error('PVP战斗与冻结检查点不一致');
    pending.combat = readPlayerDuel(combat);
  }
  return local;
}

async function checksum(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class LocalSaveStore {
  private expected: string | null | undefined;

  constructor(private readonly storage: SaveStorage = {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  }, private readonly key = LOCAL_SAVE_KEY) {}

  async load(): Promise<LocalSave | null> {
    const raw = this.storage.getItem(this.key);
    this.expected = raw;
    if (raw === null) return null;
    if (raw.length > MAX_LOCAL_SAVE_CHARS) throw new LocalSaveReadError('本地存档过大，未覆盖原数据');
    let recoveryContext: LocalSave | null = null;
    try {
      const wrapper = z.object({ data: z.unknown(), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(raw));
      if (await checksum(JSON.stringify(wrapper.data)) !== wrapper.checksum) throw new Error('checksum');
      // Retain identity and pending receipts for recovery, never for gameplay.
      recoveryContext = localSchema.parse(wrapper.data);
      return readLocalSave(recoveryContext);
    } catch { throw new LocalSaveReadError('本地存档校验或版本不匹配，已停止读取，原数据未修改', recoveryContext); }
  }

  async write(input: LocalSave, preserveOriginal = false): Promise<LocalSave> {
    if (this.expected === undefined) throw new Error('必须先读取本地存档');
    const data = readLocalSave(input);
    const raw = JSON.stringify({ data, checksum: await checksum(JSON.stringify(data)) });
    if (raw.length > MAX_LOCAL_SAVE_CHARS) throw new Error('本地存档超过接收上限');
    if (this.storage.getItem(this.key) !== this.expected) throw new Error('本地存档已被另一页面修改，当前页面已暂停');
    try {
      if (preserveOriginal && this.expected !== null) this.storage.setItem(`${this.key}:recovery`, this.expected);
      if (this.expected !== null) {
        let original;
        try { original = JSON.parse(this.expected); } catch { /* Explicit recovery can replace a malformed envelope. */ }
        const previous = original?.data?.save?.character;
        const cap = previous && Number.isInteger(previous.level) ? cultivationCarryCap(previous.level) : null;
        if (cap !== null && typeof previous.cultivation === 'string' &&
            /^\d+(\.\d+)?$/.test(previous.cultivation) && dec(previous.cultivation).gt(cap) && raw !== this.expected) {
          this.storage.setItem(this.key + ':huashen-original:' + original.checksum, this.expected);
        }
      }
      this.storage.setItem(this.key, raw);
    }
    catch { throw new Error('无法保存到此浏览器，已暂停推进；请检查存储权限与空间'); }
    this.expected = raw;
    return data;
  }

}

export function localFromCloud(profile: CloudProfile, wallNow: number): LocalSave {
  return {
    format: 'opening-local-4', characterId: profile.characterId, save: readClientSave(profile.save),
    worldClock: { timeMs: profile.serverTime, wallMs: wallNow },
    // A cloud snapshot can predate this browser's first visit.
    wallSavedAt: Math.max(0, wallNow - Math.max(0, profile.serverTime - profile.save.character.simulation.clockMs)),
    localRevision: '0', cloudRevision: profile.revision, uploadedRevision: '0', pending: null,
    pendingTrade: null, pendingReincarnation: null, pendingPvp: null, syncConflict: null,
  };
}

export function acquireLocalSaveLock(key = LOCAL_SAVE_KEY): Promise<() => void> {
  if (!globalThis.navigator?.locks) return Promise.reject(new Error('此浏览器缺少本地存档锁支持，已停止推进'));
  return new Promise((resolve, reject) => {
    void navigator.locks.request(key, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('另一页面正在运行此角色，请先关闭那一页');
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
