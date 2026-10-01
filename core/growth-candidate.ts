import { equipmentCandidate } from './equipment-candidate';
import candidate from './content/stage-1-growth-candidate.json';
import { loadContent, type Content } from './content';

const { pillDrops, ...patch } = candidate;
const drops: Record<string, Content['enemies'][number]['drops']> = pillDrops;
if (Object.keys(drops).some((id) => !equipmentCandidate.enemies.some((entry) => entry.id === id))) {
  throw new Error('属性丹候选包含未知怪物');
}
export const growthCandidate = loadContent({
  ...equipmentCandidate, ...patch,
  items: [...equipmentCandidate.items.filter((item) => !patch.items.some((entry) => entry.id === item.id)), ...patch.items],
  recipes: [...equipmentCandidate.recipes.filter((recipe) => !patch.recipes.some((entry) => entry.id === recipe.id)), ...patch.recipes],
  enemies: equipmentCandidate.enemies.map((enemy) => ({
    ...enemy, drops: [...enemy.drops, ...(drops[enemy.id] ?? [])],
  })),
});

// Conservative ordinary-equipment comparisons; zero drops remain a separate content version.
export function growthProfile(zeroDrops = false): Content {
  const profile = structuredClone(growthCandidate);
  profile.version = `stage-1-growth-plain${zeroDrops ? '-zero-drops' : ''}.1`;
  profile.equipmentQualities!.forEach((entry, index) => { entry.weight = index === 0 ? 1 : 0; });
  profile.equipment.forEach((entry) => { entry.affixCount = 0; });
  if (zeroDrops) {
    const ids = new Set(profile.items.filter((item) => item.kind === 'growth').map((item) => item.id));
    profile.enemies.forEach((enemy) => enemy.drops.forEach((drop) => {
      if (ids.has(drop.itemId)) drop.chance = 0;
    }));
  }
  return loadContent(profile);
}
