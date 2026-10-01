import { craftingCandidate } from './crafting-candidate';
import candidate from './content/stage-1-equipment-candidate.json';
import { loadContent, type Content } from './content';

// B2 leaves the A1 dwelling economy as a control; no profile here reaches the server.
const { manuals, materialDrops, ...patch } = candidate;
const manualIds: Record<string, string> = manuals;
const drops: Record<string, Content['enemies'][number]['drops']> = materialDrops;
if (Object.keys(drops).some((id) => !craftingCandidate.enemies.some((entry) => entry.id === id)) ||
    Object.keys(manualIds).some((id) => !craftingCandidate.techniques.some((entry) => entry.id === id))) {
  throw new Error('装备候选包含未知怪物或功法引用');
}

export const equipmentCandidate = loadContent({
  ...craftingCandidate,
  ...patch,
  effects: [...craftingCandidate.effects, ...patch.effects],
  items: [
    ...craftingCandidate.items.filter((entry) => !patch.items.some((item) => item.id === entry.id)),
    ...patch.items,
  ],
  recipes: [...craftingCandidate.recipes.filter((entry) => !entry.outputKind), ...patch.recipes],
  enemies: craftingCandidate.enemies.map((enemy) => ({
    ...enemy, drops: [...enemy.drops, ...(drops[enemy.id] ?? [])],
  })),
  techniques: craftingCandidate.techniques.map((technique) => manualIds[technique.id] ? {
    ...technique, unlock: { regionId: 'bamboo', kills: '20' }, manualItemId: manualIds[technique.id],
  } : technique),
});

export function equipmentProfile(plainOnly = false): Content {
  if (!plainOnly) return equipmentCandidate;
  const profile = structuredClone(equipmentCandidate);
  profile.version = 'stage-1-equipment-plain-check.1';
  profile.equipmentQualities!.forEach((quality, index) => { quality.weight = index === 0 ? 1 : 0; });
  // A separate lower-bound check must not rely on a fortunate affix either.
  profile.equipment.forEach((entry) => { entry.affixCount = 0; });
  return loadContent(profile);
}
