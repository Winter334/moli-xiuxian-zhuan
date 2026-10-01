import { loadContent, type Content } from './content';
import { monsterCandidate } from './monster-candidate';
import candidate from './content/stage-1-investment-candidate.json';

const { panelWeapons, ...patch } = candidate;
const equipment: unknown[] = monsterCandidate.equipment.map((entry) => ({
  ...entry, affixPool: [], affixCount: 0,
}));
const recipes = [...monsterCandidate.recipes];
for (const { baseId, ...weapon } of panelWeapons) {
  const base = monsterCandidate.equipment.find((entry) => entry.id === baseId);
  const recipe = recipes.find((entry) => entry.outputKind === 'equipment' && entry.outputId === baseId);
  if (!base || !recipe) throw new Error(`白板候选缺少同档对照：${baseId}`);
  equipment.push({ ...base, ...weapon, effects: [], affixPool: [], affixCount: 0 });
  recipes.push({ ...recipe, id: `forge-${weapon.id}`, name: `${weapon.name}制法`, outputId: weapon.id });
}

export const investmentCandidate = loadContent({ ...monsterCandidate, ...patch, equipment, recipes });
export const panelWeaponIds = {
  sword: 'heavy-bamboo-edge', gauntlet: 'forged-gauntlet', staff: 'plain-jade-staff',
} as const;

// Ordinary quality is a reachability control, not the meaning of a panel-only weapon.
export function investmentProfile(): Content {
  const c = structuredClone(investmentCandidate);
  c.version = 'stage-1-investment-common.1';
  c.equipmentQualities!.forEach((quality, index) => { quality.weight = index === 0 ? 1 : 0; });
  return loadContent(c);
}
