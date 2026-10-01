import { growthProfile } from './growth-candidate';
import { equipmentFoundation, type EquipmentPath } from './equipment-scenarios';

export const growthPolicies = { none: 0, drops: 0, modest: 2, focused: 6 } as const;
export type GrowthPolicy = keyof typeof growthPolicies;

export function growthFoundation(path: EquipmentPath, policy: GrowthPolicy, seed = 1, zeroDrops = false) {
  return equipmentFoundation(path, seed, true, {
    profile: growthProfile(zeroDrops), consumeGrowth: policy !== 'none',
    growthCraftsPerTier: growthPolicies[policy],
  });
}
