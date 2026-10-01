import { growthCandidate } from './growth-candidate';
import candidate from './content/stage-1-monster-candidate.json';
import { allocatedEnemyStats, enemyAllocationSchema, loadContent, type Content } from './content';

const { equipmentChanges, enemyChanges, encounters, ...patch } = candidate;
const weights: Record<string, Record<string, number>> = encounters;
if (Object.keys(weights).some((id) => !growthCandidate.regions.some((entry) => entry.id === id)) ||
    equipmentChanges.some((change) => !growthCandidate.equipment.some((entry) => entry.id === change.id))) {
  throw new Error('怪物候选包含未知区域或装备引用');
}
const enemies = enemyChanges.map(({ baseId, ...change }) => {
  const base = growthCandidate.enemies.find((enemy) => enemy.id === baseId);
  if (!base) throw new Error(`怪物候选包含未知基础怪物：${baseId}`);
  const allocation = enemyAllocationSchema.parse(change.allocation);
  return { ...base, ...change, level: allocation.level, allocation, ...allocatedEnemyStats(growthCandidate.realms, allocation) };
});
if (growthCandidate.enemies.some((enemy) => !enemies.some((entry) => entry.id === enemy.id))) {
  throw new Error('怪物候选不能丢失已有怪物标识');
}
export const monsterCandidate = loadContent({
  ...growthCandidate, ...patch, enemies,
  equipment: growthCandidate.equipment.map((entry) => ({
    ...entry, ...equipmentChanges.find((change) => change.id === entry.id),
  })),
  regions: growthCandidate.regions.map((region) => ({
    ...region, enemies: Object.keys(weights[region.id]), enemyWeights: weights[region.id],
  })),
});

export function monsterProfile(zeroPillDrops = false): Content {
  const c = structuredClone(monsterCandidate);
  c.version = `stage-1-monster-plain${zeroPillDrops ? '-zero-drops' : ''}.1`;
  c.equipmentQualities!.forEach((quality, index) => { quality.weight = index === 0 ? 1 : 0; });
  c.equipment.forEach((entry) => { entry.affixCount = 0; });
  if (zeroPillDrops) {
    const pills = new Set(c.items.filter((item) => item.kind === 'growth').map((item) => item.id));
    c.enemies.forEach((enemy) => enemy.drops.forEach((drop) => {
      if (pills.has(drop.itemId)) drop.chance = 0;
    }));
  }
  return loadContent(c);
}
