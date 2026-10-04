import { createHash, randomInt } from 'node:crypto';
import { createCharacter } from '../../core/prototype';
import {
  checkProgress, readClientSave, uploadSchema, type CloudProfile, type UploadAck,
} from '../../shared/client-save';
import { ApiError } from '../errors';
import type { CloudStore } from './repository';

export const MIN_UPLOAD_INTERVAL_MS = 10_000;

export class ClientSaveService {
  constructor(readonly store: CloudStore, private readonly now: () => number = Date.now) {}

  async createSession() {
    const now = this.now();
    return this.store.createSession({
      format: 'opening-client-2', tradeRevision: '0', character: createCharacter(now, randomInt(1, 0x1_0000_0000)), playedMs: 0,
    }, now);
  }

  async getProfile(characterId: string): Promise<CloudProfile> {
    const snapshot = await this.store.load(characterId);
    return { characterId, revision: snapshot.revision, save: readClientSave(snapshot.save), serverTime: this.now() };
  }

  async upload(characterId: string, raw: unknown, authorizeAdministratorChanges?: () => Promise<boolean>): Promise<UploadAck> {
    const input = uploadSchema.parse(raw);
    if (input.characterId !== characterId) throw new ApiError(409, 'IDENTITY_CONFLICT', '云端身份与本地角色不一致，未覆盖任何存档。');
    try { input.save = readClientSave(input.save); }
    catch { throw new ApiError(422, 'SAVE_REJECTED', '角色数据不符合当前规则，云存档未修改。'); }
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const now = this.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await this.store.load(characterId);
      if (current.lastRequestId === input.requestId) {
        if (current.lastPayloadHash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '同一上传编号的内容发生变化，未覆盖云存档。');
        return { characterId, requestId: input.requestId, revision: current.revision, savedAt: current.receivedAt };
      }
      if (input.baseRevision !== current.revision) {
        throw new ApiError(409, 'SAVE_CONFLICT', '云端已有另一份进度，本地存档保留，已停止自动上传。');
      }
      if (current.lastRequestId !== null && now - current.receivedAt < MIN_UPLOAD_INTERVAL_MS) {
        throw new ApiError(429, 'SAVE_RATE_LIMIT', '上传过于频繁，本地进度已保留，稍后再试。');
      }
      try {
        const previous = readClientSave(current.save);
        const requiresAdministrator = previous.character.fateId !== input.save.character.fateId ||
          previous.character.history.testAssisted && !input.save.character.history.testAssisted;
        const allowAdministratorChanges = requiresAdministrator && Boolean(await authorizeAdministratorChanges?.());
        checkProgress(previous, input.save, current.receivedAt, now, allowAdministratorChanges);
      } catch (error) {
        throw new ApiError(422, 'SAVE_REJECTED', error instanceof Error ? error.message : '存档校验失败');
      }
      if (await this.store.commit(characterId, current.revision, input.save, now, input.requestId, hash)) {
        return { characterId, requestId: input.requestId, revision: String(BigInt(current.revision) + 1n), savedAt: now };
      }
    }
    throw new ApiError(409, 'SAVE_CONFLICT', '云端进度发生变化，本地存档保留，已停止自动上传。');
  }
}
