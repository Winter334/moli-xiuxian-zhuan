import { z } from 'zod';
import { countSchema } from '../core/prototype/types';
import { clientSaveSchema, readClientSave, revisionSchema, uploadSchema } from './client-save';

export const reincarnationRequestSchema = uploadSchema;
export type ReincarnationRequest = z.infer<typeof reincarnationRequestSchema>;
const identity = {
  characterId: z.uuid(), requestId: z.uuid(),
  settledAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};
export const reincarnationReceiptSchema = z.discriminatedUnion('status', [
  z.object({
    ...identity, status: z.literal('committed'), fromLife: countSchema,
    revision: revisionSchema, save: clientSaveSchema,
  }).strict(),
  z.object({
    ...identity, status: z.literal('rejected'),
    error: z.object({ code: z.string().min(1), message: z.string().min(1).max(1000) }).strict(),
  }).strict(),
]);
export type ReincarnationReceipt = z.infer<typeof reincarnationReceiptSchema>;
export const reincarnationLookupSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unknown') }).strict(),
  z.object({ status: z.literal('settled'), receipt: reincarnationReceiptSchema }).strict(),
]);

export function validateReincarnationReceipt(request: ReincarnationRequest, receipt: ReincarnationReceipt) {
  if (receipt.characterId !== request.characterId || receipt.requestId !== request.requestId) {
    throw new Error('轮回回执身份不匹配');
  }
  if (receipt.status === 'rejected') return;
  const save = readClientSave(receipt.save);
  const before = request.save.character;
  if (receipt.fromLife !== before.life.number ||
      BigInt(receipt.revision) !== BigInt(request.baseRevision) + 1n ||
      BigInt(save.tradeRevision) !== BigInt(request.save.tradeRevision) + 1n ||
      BigInt(save.character.life.number) !== BigInt(before.life.number) + 1n ||
      save.character.life.startedAt !== Math.max(receipt.settledAt, before.simulation.clockMs) ||
      save.character.simulation.clockMs !== save.character.life.startedAt ||
      save.playedMs !== request.save.playedMs ||
      JSON.stringify(save.character.history) !== JSON.stringify(before.history)) {
    throw new Error('轮回回执与原检查点不匹配');
  }
}
