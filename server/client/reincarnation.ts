import { createHash, randomInt } from 'node:crypto';
import { reincarnateCharacter } from '../../core/prototype/reincarnation';
import { readClientSave, revisionSchema } from '../../shared/client-save';
import { reincarnationRequestSchema, type ReincarnationReceipt } from '../../shared/reincarnation';
import { ApiError } from '../errors';
import { checkCheckpoint } from './checkpoint';
import type { ReincarnationStore } from './reincarnation-store';

export class ReincarnationService {
  constructor(
    private readonly store: ReincarnationStore,
    private readonly now: () => number = Date.now,
    private readonly seed: () => number = () => randomInt(1, 0x1_0000_0000),
  ) {}

  async execute(characterId: string, raw: unknown): Promise<ReincarnationReceipt> {
    const input = reincarnationRequestSchema.parse(raw);
    if (input.characterId !== characterId) throw new ApiError(409, 'IDENTITY_CONFLICT', '轮回身份与当前角色不一致。');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.store.transact(characterId, async tx => {
      const previous = await tx.receipt(input.requestId);
      if (previous) {
        if (previous.hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '轮回编号对应的原请求已改变。');
        return previous.receipt;
      }
      const now = this.now();
      let ending;
      try { ending = checkCheckpoint(tx.snapshot, input, now); }
      catch (error) {
        if (!(error instanceof ApiError)) throw error;
        const rejected: ReincarnationReceipt = {
          status: 'rejected', characterId, requestId: input.requestId, settledAt: now,
          error: { code: error.code, message: error.message },
        };
        await tx.record(hash, rejected);
        return rejected;
      }
      const save = readClientSave({
        ...ending,
        tradeRevision: revisionSchema.parse(String(BigInt(ending.tradeRevision) + 1n)),
        character: reincarnateCharacter(ending.character, now, this.seed()),
      });
      const receipt: ReincarnationReceipt = {
        status: 'committed', characterId, requestId: input.requestId, settledAt: now,
        fromLife: ending.character.life.number,
        revision: revisionSchema.parse(String(BigInt(tx.snapshot.revision) + 1n)), save,
      };
      await tx.replaceLife(save, now);
      await tx.record(hash, receipt);
      return receipt;
    });
  }

  async lookup(characterId: string, requestId: string) {
    const stored = await this.store.receipt(characterId, requestId);
    return stored ? { status: 'settled' as const, receipt: stored.receipt } : { status: 'unknown' as const };
  }
}
