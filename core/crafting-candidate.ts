import { balanceCandidate } from './balance-candidate';
import candidate from './content/stage-1-crafting-candidate.json';
import { loadContent, type Content } from './content';

// B1 is a mechanics fixture, not the next full balance: A1 dwelling/weapon values
// remain as controls. Neither candidate is imported by the server.
const { regionClears, ...patch } = candidate;
const clears: Record<string, Content['regions'][number]['clear']> = regionClears;
if (Object.keys(clears).some((id) => !balanceCandidate.regions.some((region) => region.id === id)) ||
    balanceCandidate.regions.some((region) => !clears[region.id])) throw new Error('候选区域波次配置不完整');

export const craftingCandidate = loadContent({
  ...balanceCandidate,
  ...patch,
  settings: { ...balanceCandidate.settings, ...patch.settings },
  items: [...balanceCandidate.items, ...patch.items],
  recipes: [...balanceCandidate.recipes, ...patch.recipes],
  enemies: balanceCandidate.enemies.map((enemy) => ({ ...enemy, equipmentDrops: [] })),
  regions: balanceCandidate.regions.map(({ firstClearEquipmentId: _removed, ...region }) => ({
    ...region, clear: clears[region.id],
  })),
});
