import { getCharacterView } from '../core/prototype';
import { checkProgress, CLOUD_RESUME_TOLERANCE_MS, type ClientSave, type CloudProfile } from '../shared/client-save';
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
  cloudBlocked: string | null;
}

export function sameClientSave(local: ClientSave, cloud: ClientSave): boolean {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, ordered(entry)]));
    }
    return value;
  };
  return JSON.stringify(ordered(local)) === JSON.stringify(ordered(cloud));
}

export function matchesCloudCheckpoint(local: LocalSave, profile: CloudProfile): boolean {
  const cloud = profile.save;
  if (local.characterId !== profile.characterId || local.syncConflict || local.pendingTrade ||
      local.pendingReincarnation || local.pendingPvp) return false;
  if (sameClientSave(local.save, cloud)) return true;
  const clockGap = local.save.character.simulation.clockMs - cloud.character.simulation.clockMs;
  const playedGap = local.save.playedMs - cloud.playedMs;
  if (local.cloudRevision !== profile.revision || local.pending ||
      clockGap < 0 || clockGap > CLOUD_RESUME_TOLERANCE_MS ||
      playedGap < 0 || playedGap > CLOUD_RESUME_TOLERANCE_MS) return false;
  try {
    checkProgress(cloud, local.save, cloud.character.simulation.clockMs, profile.serverTime);
    return true;
  } catch { return false; }
}

export function compareSaves(local: LocalSave | null, cloud: CloudProfile, cloudBlocked: string | null): SaveComparison {
  const summarize = (save: CloudProfile['save'], savedAt: number, revision: string): SaveSummary => {
    const view = getCharacterView(save.character, cloud.serverTime);
    return { savedAt, revision, life: view.life.number, realm: view.realmName,
      cultivation: view.cultivation, location: view.locationName };
  };
  return {
    local: local ? summarize(local.save, local.wallSavedAt, local.cloudRevision) : null,
    cloud: summarize(cloud.save, cloud.save.character.simulation.clockMs, cloud.revision),
    cloudBlocked,
  };
}
