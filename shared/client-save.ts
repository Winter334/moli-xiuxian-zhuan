import { cappedCultivation } from '../core/prototype/growth';
import { z } from 'zod';
import { readCharacter, storedShops, type CharacterState } from '../core/prototype/character-state';
import { characterSchema } from '../core/prototype/character-state';
import { dec } from '../core/numbers';
import { checkHistoryProgress } from '../core/prototype/history';

export const MAX_FRAME_GAP_MS = 5000;
export const CLOUD_SAVE_INTERVAL_MS = 60_000;
export const MAX_SAVE_BYTES = 512 * 1024;
export const MAX_INVENTORY_INSTANCES = 1000;
export const worldTimeSchema = z.object({
  serverTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export const revisionSchema = z.string().max(19).regex(/^(0|[1-9]\d*)$/)
  .refine(value => BigInt(value) < 9223372036854775807n);
export const clientSaveSchema = z.object({
  format: z.literal('opening-client-2'),
  tradeRevision: revisionSchema,
  character: characterSchema,
  playedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type ClientSave = z.infer<typeof clientSaveSchema>;

export class SaveCapacityError extends Error {}

export function checkSaveCapacity(state: CharacterState) {
  if (Object.keys(state.instances).length > MAX_INVENTORY_INSTANCES) {
    throw new SaveCapacityError(`行囊器物超过${MAX_INVENTORY_INSTANCES}件上限，请先售出或合炼`);
  }
  const inventories = [state, ...storedShops(state).map(shop => shop.stock)];
  if (inventories.some(owner => Object.values(owner.inventory)
      .some(value => BigInt(value) > 1_000_000_000_000n))) {
    throw new SaveCapacityError('单项物品数量超过1万亿的存档上限');
  }
}

export function readClientSave(raw: unknown): ClientSave {
  const save = clientSaveSchema.parse(raw);
  save.character = readCharacter(save.character);
  checkSaveCapacity(save.character);
  return save;
}

export const cloudProfileSchema = z.object({
  characterId: z.uuid(),
  revision: revisionSchema,
  save: clientSaveSchema,
  serverTime: z.number().int().nonnegative(),
}).strict();
export type CloudProfile = z.infer<typeof cloudProfileSchema>;
export const uploadSchema = z.object({
  characterId: z.uuid(),
  requestId: z.uuid(),
  baseRevision: revisionSchema,
  save: clientSaveSchema,
}).strict();
export type SaveUpload = z.infer<typeof uploadSchema>;
export const uploadAckSchema = z.object({
  characterId: z.uuid(),
  requestId: z.uuid(),
  revision: revisionSchema,
  savedAt: z.number().int().nonnegative(),
}).strict();
export type UploadAck = z.infer<typeof uploadAckSchema>;

// These are coarse consistency checks, not a replay or proof of legitimate play.
export function checkProgress(previous: ClientSave, next: ClientSave, receivedAt: number, now: number,
  allowAdministratorChanges = false) {
  if (next.tradeRevision !== previous.tradeRevision) {
    throw new Error('交易版本不一致，请先核对交易回执，本地进度未覆盖云端');
  }
  const before = previous.character;
  const after = next.character;
  if (after.life.number !== before.life.number || after.life.startedAt !== before.life.startedAt) {
    throw new Error('世次不一致，跨世进度只能通过轮回提交');
  }
  if (after.fateId !== before.fateId && !allowAdministratorChanges) {
    throw new Error('本世气运不一致，本地进度未覆盖云端');
  }
  checkHistoryProgress(before.history, after.history, allowAdministratorChanges);
  for (const kind of ['firstVisits', 'firstClears', 'firstRealms', 'firstEncounters'] as const) {
    for (const [id, milestone] of Object.entries(after.history[kind])) {
      if (!before.history[kind][id] && milestone.life !== after.life.number) {
        throw new Error('不能补写前世的首次经历');
      }
    }
  }
  if (after.simulation.clockMs < before.simulation.clockMs ||
      after.simulation.clockMs > now + MAX_FRAME_GAP_MS ||
      next.playedMs < previous.playedMs ||
      next.playedMs - previous.playedMs > Math.max(0, now - Math.min(receivedAt, before.simulation.clockMs)) + MAX_FRAME_GAP_MS) {
    throw new Error('存档计时异常，本地进度未覆盖云端');
  }
  if (BigInt(after.fortuneOffering ?? '0') < BigInt(before.fortuneOffering ?? '0')) throw new Error('纳财养运进度发生回退');
  if (after.level < before.level || after.furnaceTier < before.furnaceTier ||
      BigInt(after.simulation.actionCounts.basicAttack) < BigInt(before.simulation.actionCounts.basicAttack) ||
      (before.foundationRoot !== null && after.foundationRoot !== before.foundationRoot) ||
      before.learnedDivineArts.some(id => !after.learnedDivineArts.includes(id)) ||
      (before.manorAidClaimed && !after.manorAidClaimed) ||
      (before.jadeSeamCompletions !== undefined &&
        (after.jadeSeamCompletions === undefined || after.jadeSeamCompletions < before.jadeSeamCompletions)) ||
      (before.qixiaFragmentCompletions !== undefined &&
        (after.qixiaFragmentCompletions === undefined || after.qixiaFragmentCompletions < before.qixiaFragmentCompletions)) ||
      (before.brokenplainSeamCompletions !== undefined &&
        (after.brokenplainSeamCompletions === undefined || after.brokenplainSeamCompletions < before.brokenplainSeamCompletions)) ||
      (before.qixiaArray !== undefined &&
        (after.qixiaArray === undefined || after.qixiaArray.unlockedMax < before.qixiaArray.unlockedMax)) ||
      (before.lakeInsightClaimed && !after.lakeInsightClaimed) ||
      (before.jiyuanIntroduced && !after.jiyuanIntroduced) ||
      (before.jiyuanMerchantFound && !after.jiyuanMerchantFound) ||
      (before.ruinMeditationOpened && !after.ruinMeditationOpened) ||
      (before.brokenplainIntroduced && !after.brokenplainIntroduced) ||
      (before.arkContractClaimed && !after.arkContractClaimed) ||
      (before.reactor && !after.reactor) ||
      (before.firstJourney !== undefined &&
        (after.firstJourney === undefined || dec(after.firstJourney.progress).lt(before.firstJourney.progress))) ||
      (before.meditationTier !== undefined &&
        (after.meditationTier === undefined || after.meditationTier < before.meditationTier)) ||
      (before.marrowInsight !== undefined &&
        (after.marrowInsight === undefined || dec(after.marrowInsight).lt(before.marrowInsight))) ||
      (after.level === before.level && dec(after.cultivation).lt(cappedCultivation(before.level, before.cultivation))) ||
      Object.entries(before.skills).some(([id, skill]) => {
        if (!skill) return false;
        const current = after.skills[id as keyof typeof after.skills];
        return !current || current.level < skill.level || dec(current.xp).lt(skill.xp);
      }) ||
      Object.entries(before.marrow).some(([id, amount]) => dec(after.marrow[id as keyof typeof after.marrow]).lt(amount)) ||
      Object.entries(before.simulation.clearedGroups)
        .some(([id, count]) => BigInt(after.simulation.clearedGroups[id] ?? '0') < BigInt(count))) {
    throw new Error('成长进度发生回退，本地进度未覆盖云端');
  }
}
