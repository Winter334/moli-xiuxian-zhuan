import { allocatedEnemyStats, enemyAllocationSchema, loadContent } from './content';
import { techniqueCandidate } from './technique-candidate';
import patch from './content/stage-1-loadout-candidate.json';

const enemies = structuredClone(techniqueCandidate.enemies);
for (const change of patch.enemyDropChanges) {
  const enemy = enemies.find((entry) => entry.id === change.id);
  if (!enemy) throw new Error(`掉落调整引用未知怪物：${change.id}`);
  enemy.drops = structuredClone(change.drops);
}
for (const change of patch.enemyAllocationChanges) {
  const enemy = enemies.find((entry) => entry.id === change.id);
  if (!enemy) throw new Error(`属性调整引用未知怪物：${change.id}`);
  const allocation = enemyAllocationSchema.parse(change.allocation);
  Object.assign(enemy, { level: allocation.level, allocation, ...allocatedEnemyStats(techniqueCandidate.realms, allocation) });
}

export const loadoutCandidate = loadContent({
  ...techniqueCandidate, version: patch.version, rulesVersion: patch.rulesVersion, enemies,
  foundationMethods: techniqueCandidate.foundationMethods.map((method) => ({
    ...method, extraCosts: patch.foundationCosts[method.id],
  })),
  fates: techniqueCandidate.fates.map((fate) => ({
    ...fate, effects: fate.effects.map((effect) => effect.kind === 'item-drop'
      ? { ...effect, itemIds: patch.fateMaterialItems } : effect),
  })),
  equipment: [...techniqueCandidate.equipment, ...patch.equipment],
  recipes: [...techniqueCandidate.recipes, ...patch.recipes].map((recipe) => ({
    ...recipe, extraOutputEligible: recipe.outputKind !== 'equipment' &&
      [...techniqueCandidate.items, ...patch.items].some((item) =>
        item.id === recipe.outputId && (item.kind === 'recovery' || item.kind === 'growth')),
  })),
  actions: [...techniqueCandidate.actions, ...patch.actions],
  techniques: [...techniqueCandidate.techniques, ...patch.techniques],
  items: [...techniqueCandidate.items, ...patch.items],
});

export function loadoutProfile() {
  const c = structuredClone(loadoutCandidate);
  c.version = 'stage-1-loadout-common.11';
  c.equipmentQualities!.forEach((quality, index) => { quality.weight = index === 0 ? 1 : 0; });
  return loadContent(c);
}
