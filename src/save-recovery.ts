import { getCharacterView } from '../core/prototype';
import { checkProgress, MAX_SAVE_BYTES, type CloudProfile } from '../shared/client-save';
import type { LocalSave } from './local-save';

export interface SaveSummary {
  savedAt: number;
  life: string;
  realm: string;
  cultivation: string;
  location: string;
  revision: string;
}
export interface SaveComparison {
  local: SaveSummary | null;
  cloud: SaveSummary;
  localBlocked: string | null;
  cloudBlocked: string | null;
}

export function compareSaves(local: LocalSave | null, cloud: CloudProfile, cloudBlocked: string | null): SaveComparison {
  const summarize = (save: CloudProfile['save'], savedAt: number, revision: string): SaveSummary => {
    const view = getCharacterView(save.character, cloud.serverTime);
    return { savedAt, revision, life: view.life.number, realm: view.realmName,
      cultivation: view.cultivation, location: view.locationName };
  };
  let localBlocked: string | null = null;
  if (!local) localBlocked = '本地存档无法读取，不能采用。';
  else if (local.pendingTrade || local.pendingReincarnation) localBlocked = '请先核对寄售或轮回，再决定是否采用本地进度。';
  else {
    try {
      // The server checks its actual receive time; this preview cannot authorize an upload.
      checkProgress(cloud.save, local.save, cloud.save.character.simulation.clockMs, cloud.serverTime);
      const request = { characterId: local.characterId, baseRevision: cloud.revision,
        requestId: crypto.randomUUID(), save: local.save };
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_SAVE_BYTES) {
        throw new Error('本地存档超过云端接收上限。');
      }
    } catch (error) { localBlocked = error instanceof Error ? error.message : '本地进度未通过校验。'; }
  }
  return {
    local: local ? summarize(local.save, local.wallSavedAt, local.cloudRevision) : null,
    cloud: summarize(cloud.save, cloud.save.character.simulation.clockMs, cloud.revision),
    localBlocked, cloudBlocked,
  };
}
