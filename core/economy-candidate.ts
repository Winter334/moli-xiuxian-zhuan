import { allocatedEnemyStats, enemyAllocationSchema, loadContent } from './content';
import { investmentCandidate } from './investment-candidate';
import patch from './content/stage-1-economy-candidate.json';

const base = investmentCandidate;
const ids = new Set(patch.enemyChanges.map((enemy) => enemy.id));
if (ids.size !== base.enemies.length || base.enemies.some((enemy) => !ids.has(enemy.id))) {
  throw new Error('资源候选须明确配置每种怪物的产出');
}
const enemies = base.enemies.map((enemy) => {
  const change = patch.enemyChanges.find((entry) => entry.id === enemy.id)!;
  const allocation = enemyAllocationSchema.parse(change.allocation ?? {
    ...enemy.allocation, multipliers: {
      ...enemy.allocation!.multipliers,
      ...(change.attackMultiplier ? { attack: change.attackMultiplier } : {}),
      ...(change.magicAttackMultiplier ? { magicAttack: change.magicAttackMultiplier } : {}),
      ...(change.hpMultiplier ? { maxHp: change.hpMultiplier } : {}),
    },
  });
  return { ...enemy, level: allocation.level, allocation, ...allocatedEnemyStats(base.realms, allocation), drops: change.drops };
});
const items = base.items.map((entry) => {
  const item = { ...entry };
  if (patch.unbuyableMaterials.includes(item.id)) delete item.buyPrice;
  return item;
});
const recipes = base.recipes.map((recipe) => {
  const forgeCosts = patch.forgeCosts[recipe.id as keyof typeof patch.forgeCosts];
  if (forgeCosts) return {
    ...recipe, costs: Object.entries(forgeCosts).map(([itemId, quantity]) => ({ itemId, quantity })),
  };
  const item = items.find((item) => item.id === recipe.outputId);
  if (item?.use?.kind !== 'growth') return recipe;
  const costs = patch.growthCosts[item.use.tierId as keyof typeof patch.growthCosts];
  return {
    ...recipe, stones: costs.stones, costs: [
      { itemId: 'herb', quantity: costs.herb },
      { itemId: item.use.stat === 'defense' ? 'stone-marrow' : 'blood', quantity: costs.primary },
      ...('extra' in costs ? [costs.extra] : []),
    ],
  };
});
export const economyCandidate = loadContent({
  ...base, version: patch.version, rulesVersion: patch.rulesVersion, enemies, items, recipes,
  regions: base.regions.map((region) => ({
    ...region, clear: { ...region.clear, reward: {
      ...region.clear!.reward, stones: patch.clearStones[region.id as keyof typeof patch.clearStones],
    } },
  })),
});

export function economyProfile() {
  const c = structuredClone(economyCandidate);
  c.version = 'stage-1-economy-common.1';
  c.equipmentQualities!.forEach((quality, index) => { quality.weight = index === 0 ? 1 : 0; });
  return loadContent(c);
}
