import { checkProgress, readClientSave, type ClientSave, type SaveUpload } from '../../shared/client-save';
import { ApiError } from '../errors';
import type { CloudSnapshot } from './repository';

export function checkCheckpoint(current: CloudSnapshot, input: Pick<SaveUpload, 'baseRevision' | 'save'>, now: number): ClientSave {
  if (input.baseRevision !== current.revision) {
    throw new ApiError(409, 'SAVE_CONFLICT', '云端已有另一份进度，请先核对保存与交易回执。');
  }
  let previous: ClientSave;
  let next: ClientSave;
  try {
    previous = readClientSave(current.save);
    next = readClientSave(input.save);
  } catch {
    throw new ApiError(409, 'SAVE_REJECTED', '角色数据不符合当前规则，未修改资产或存档。');
  }
  if (previous.tradeRevision !== next.tradeRevision) {
    throw new ApiError(409, 'TRADE_CONFLICT', '交易版本不一致，请先核对交易回执。');
  }
  try { checkProgress(previous, next, current.receivedAt, now); }
  catch (error) { throw new ApiError(409, 'SAVE_REJECTED', error instanceof Error ? error.message : '存档校验失败'); }
  return next;
}
