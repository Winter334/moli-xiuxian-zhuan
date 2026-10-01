import { loadContent } from './content';
import { economyCandidate } from './economy-candidate';
import patch from './content/stage-1-combat-candidate.json';

export const combatCandidate = loadContent({
  ...economyCandidate, version: patch.version, rulesVersion: patch.rulesVersion, schemaVersion: patch.schemaVersion,
  settings: { ...economyCandidate.settings, manaSupply: patch.manaSupply },
  actions: [...economyCandidate.actions, ...patch.playerActions],
  equipment: economyCandidate.equipment.map((weapon) => {
    const attack = patch.equipmentAttack[weapon.id as keyof typeof patch.equipmentAttack];
    const stat = weapon.category === 'staff' ? 'magicAttack' : 'attack';
    return attack ? { ...weapon, modifiers: weapon.modifiers.map((m) => m.stat === stat ? { ...m, value: attack } : m) } : weapon;
  }),
  techniques: economyCandidate.techniques.map((technique) => ({
    ...technique, ...patch.techniqueChanges.find((entry) => entry.id === technique.id),
    ...(technique.id === 'flame' ? { modifiers: patch.flameModifiers } : {}),
  })),
  items: economyCandidate.items.map((item) => {
    if (item.id === 'mana-pill') return {
      ...item, buyPrice: patch.manaPill.buyPrice, use: { kind: 'restore', resource: 'mp', amount: patch.manaPill.amount },
    };
    const price = patch.manualPrices[item.id as keyof typeof patch.manualPrices];
    return price ? { ...item, buyPrice: price, sellPrice: '20' } : item;
  }),
  recipes: economyCandidate.recipes.map((recipe) => {
    const cost = patch.forgeCosts[recipe.id as keyof typeof patch.forgeCosts];
    return cost ? {
      ...recipe, stones: cost.stones,
      costs: Object.entries(cost.materials).map(([itemId, quantity]) => ({ itemId, quantity })),
    } : recipe;
  }),
  regions: economyCandidate.regions.map((region) => {
    const stones = patch.firstClearStones[region.id as keyof typeof patch.firstClearStones];
    return stones ? {
      ...region, clear: { ...region.clear!, firstBonus: { stones, cultivation: '0' } },
    } : region;
  }),
});

export function combatProfile() {
  const c = structuredClone(combatCandidate);
  c.version = 'stage-1-combat-common.1';
  c.equipmentQualities!.forEach((quality, index) => { quality.weight = index === 0 ? 1 : 0; });
  return loadContent(c);
}
