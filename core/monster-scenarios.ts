import { monsterProfile } from './monster-candidate';
import { equipmentFoundation, type EquipmentPath } from './equipment-scenarios';
import { growthPolicies, type GrowthPolicy } from './growth-scenarios';

export function monsterFoundation(path: EquipmentPath, policy: GrowthPolicy, seed = 1, zeroPillDrops = false) {
  return equipmentFoundation(path, seed, true, {
    profile: monsterProfile(zeroPillDrops),
    consumeGrowth: policy !== 'none', growthCraftsPerTier: growthPolicies[policy],
  });
}
