import { describe, expect, it } from 'vitest';
import { createRules } from './game';
import { content, loadContent, type Content } from './content';
import { craftingCandidate } from './crafting-candidate';
import { equipmentCandidate, equipmentProfile } from './equipment-candidate';
import { equipmentFoundation, equipmentPaths } from './equipment-scenarios';
import { gameCommandSchema } from '../server/validation';
import { dec } from './numbers';
import type { GameState } from './types';

function forcedQuality(id: string) {
  const c = structuredClone(equipmentCandidate);
  c.equipmentQualities!.forEach((entry) => { entry.weight = entry.id === id ? 1 : 0; });
  return c;
}
// Injected resources are only for unit fixtures; scenario tests below use real commands.
function funded(rules = createRules(equipmentCandidate)) {
  const state = rules.createGame(0, 42);
  state.stones = '1000000';
  for (const item of rules.content.items) state.inventory[item.id] = '10000';
  for (const region of rules.content.regions) state.regionKills[region.id] = '20';
  return state;
}

describe('equipment profile isolation and configuration', () => {
  it('rejects cross-profile saves without implicit conversion', () => {
    const b2 = createRules(equipmentCandidate);
    const fresh = b2.createGame(0);
    expect(fresh.schemaVersion).toBe(equipmentCandidate.schemaVersion);
    expect(fresh.learnedTechniques).toEqual(['breathing']);
    for (const config of [content, craftingCandidate]) {
      const old = createRules(config);
      expect(old.createGame(0).learnedTechniques).toBeUndefined();
      expect(() => b2.advanceGame(old.createGame(0), 1000)).toThrow(/版本/);
      expect(() => old.getGameView(fresh)).toThrow(/版本/);
    }
  });
  it('rejects invalid grades, empty weights, unsafe multipliers and missing manuals', () => {
    const mutations = [
      (c: Content) => { Object.assign(c, { schemaVersion: 2 }); },
      (c: Content) => { c.equipmentQualities![0].statMultiplier = '2'; },
      (c: Content) => { c.equipmentQualities![1].id = 'plain'; },
      (c: Content) => { c.equipmentQualities![1].rarity = 'common'; },
      (c: Content) => { c.equipmentQualities![1].statMultiplier = '0.5'; },
      (c: Content) => { c.equipmentQualities![1].effectMultiplier = '0.5'; },
      (c: Content) => { c.equipmentQualities![2].statMultiplier = '999'; },
      (c: Content) => { c.equipmentQualities!.forEach((quality) => { quality.weight = 0; }); },
      (c: Content) => { c.equipmentQualities![0].weight = -1; },
      (c: Content) => { delete c.techniques[1].manualItemId; },
      (c: Content) => { c.techniques[1].manualItemId = 'herb'; },
      (c: Content) => { c.techniques[0].manualItemId = 'verdant-manual'; },
      (c: Content) => { c.techniques[2].manualItemId = 'verdant-manual'; },
      (c: Content) => { delete c.techniqueAcquisition; },
    ];
    for (const mutate of mutations) {
      const c = structuredClone(equipmentCandidate);
      mutate(c);
      expect(() => loadContent(c)).toThrow();
    }
  });
  it('rejects missing snapshots or learned state instead of inventing saved assets', () => {
    const rules = createRules(equipmentCandidate);
    const state = rules.applyCommand(funded(rules), { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    const broken = structuredClone(state);
    delete broken.equipment[0].quality;
    expect(() => rules.getGameView(broken)).toThrow(/品质快照/);
    const missing = structuredClone(state);
    delete missing.learnedTechniques;
    expect(() => rules.advanceGame(missing, 1000)).toThrow(/已学功法/);
    const illegal = structuredClone(state);
    illegal.techniqueId = 'flame';
    expect(() => rules.advanceGame(illegal, 1000)).toThrow(/已学功法/);
    illegal.techniqueId = 'breathing';
    illegal.learnedTechniques!.push('breathing');
    expect(() => rules.getGameView(illegal)).toThrow(/已学功法/);
  });
  it('covers nine weapons and reachable phase materials without finished gear drops', () => {
    expect(equipmentCandidate.equipment).toHaveLength(9);
    for (const category of Object.keys(equipmentPaths)) {
      expect(equipmentCandidate.equipment.filter((entry) => entry.category === category)).toHaveLength(3);
    }
    for (const itemId of ['dense-ore', 'heartwood']) {
      expect(equipmentCandidate.items.find((entry) => entry.id === itemId)?.buyPrice).toBeUndefined();
      expect(equipmentCandidate.enemies.some((enemy) => enemy.drops.some((drop) => drop.itemId === itemId && drop.chance === 1))).toBe(true);
    }
    expect(equipmentCandidate.enemies.every((enemy) => enemy.equipmentDrops.length === 0)).toBe(true);
  });
});

describe('persisted quality has actual shared combat effects', () => {
  it.each([
    ['plain', '18', '1', 'common'],
    ['fine', '23.4', '1.15', 'uncommon'],
    ['superior', '29.7', '1.3', 'rare'],
  ])('applies %s once to base stats/effects and uses that grade in the view', (id, attack, mana, rarity) => {
    const c = forcedQuality(id);
    c.equipment.find((entry) => entry.id === 'iron-sword')!.affixCount = 0;
    const rules = createRules(c);
    let state = rules.applyCommand(funded(rules), { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    state = rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: state.equipment[0].instanceId });
    const snapshot = state.equipment[0].quality!;
    expect(snapshot.modifiers.find((entry) => entry.stat === 'attack')!.value).toBe(attack);
    expect(snapshot.effects[0].amount).toBe(mana);
    expect(rules.getPlayerStats(state).attack).toBe(dec(attack).plus(10).toFixed());
    const view = rules.getGameView(state).equipment[0];
    expect(view.rarity).toBe(rarity);
    expect(view.quality?.id).toBe(id);
    expect(view.stats).toContainEqual({ label: '物攻', value: `+${attack}` });
    expect(view.effects[0]).toContain(mana);
  });
  it('uses the slower effect multiplier for regeneration, not the main stat multiplier', () => {
    const rules = createRules(forcedQuality('superior'));
    const state = rules.applyCommand(funded(rules), { type: 'craft', recipeId: 'forge-jade-staff', quantity: 1 });
    const quality = state.equipment[0].quality!;
    expect(quality.modifiers.find((entry) => entry.stat === 'mpRegen')?.value).toBe('1.3');
    expect(quality.modifiers.find((entry) => entry.stat === 'magicAttack')?.value).toBe('56.1');
    expect(quality.modifiers.some((entry) => entry.stat === 'attack')).toBe(false);
    expect(quality.effects[0].amount).toBe('2.6');
  });
  it('actually restores the snapshotted amount per hit, without changing the shared effect template', () => {
    const c = forcedQuality('superior');
    c.equipment.find((entry) => entry.id === 'iron-sword')!.affixCount = 0;
    c.baseStats.mpRegen = '0';
    c.settings.baseMpRegenFraction = '0';
    c.baseStats.critChance = '0';
    c.techniques[0].effects = [];
    c.regions[0].enemies = ['hill-wolf'];
    Object.assign(c.enemies[0], { maxHp: '10000', defense: '0', attack: '0', effects: [] });
    const rules = createRules(c);
    let state = rules.applyCommand(funded(rules), { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    state = rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: state.equipment[0].instanceId });
    state.player.mp = '0';
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    state.rng = 1;
    const after = rules.advanceGame(state, 2000);
    expect(after.player.mp).toBe('1.3');
    expect(after.battle!.hp).toBe('9960.3');
    expect(rules.content.effects.find((entry) => entry.id === 'hit-mana')?.amount).toBe('1');
  });
  it('freezes base values, effects, grade and affixes through save/load and changed generation definitions', () => {
    const c = forcedQuality('fine');
    const rules = createRules(c);
    let state = rules.applyCommand(funded(rules), { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    state = rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: state.equipment[0].instanceId });
    const before = rules.getGameView(state);
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    c.equipment.find((entry) => entry.id === 'iron-sword')!.modifiers[0].value = '999';
    c.effects.find((entry) => entry.id === 'hit-mana')!.amount = '999';
    c.equipmentQualities![1].name = 'Changed generation label';
    c.equipmentQualities![1].statMultiplier = '1.4';
    c.affixes.forEach((entry) => { entry.min = '99'; entry.max = '99'; });
    const changed = createRules(c);
    expect(changed.getGameView(saved).equipment).toEqual(before.equipment);
    expect(changed.getPlayerStats(saved)).toEqual(rules.getPlayerStats(state));
    expect(saved.equipment).toEqual(state.equipment);
    expect(saved.rng).toBe(state.rng);
  });
  it('does not let view consumers mutate saved snapshots', () => {
    const rules = createRules(equipmentCandidate);
    const state = rules.applyCommand(funded(rules), { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    const before = structuredClone(state);
    const view = rules.getGameView(state);
    view.equipment[0].quality!.name = 'Changed';
    view.equipment[0].stats[0].value = '999';
    view.recipes.find((entry) => entry.outputKind)!.qualities![0].statMultiplier = '999';
    expect(state).toEqual(before);
    expect(rules.content.equipmentQualities![0].statMultiplier).toBe('1');
  });
  it('has batch/sequential parity for grades, scaled affixes, costs and RNG', () => {
    const rules = createRules(equipmentCandidate);
    const start = funded(rules);
    const batch = rules.applyCommand(start, { type: 'craft', recipeId: 'forge-iron-sword', quantity: 100 });
    let sequential = start;
    for (let i = 0; i < 100; i++) sequential = rules.applyCommand(sequential, { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    expect(batch).toEqual(sequential);
    expect(new Set(batch.equipment.map((entry) => entry.quality!.id)).size).toBe(3);
    for (const entry of batch.equipment) {
      const quality = rules.content.equipmentQualities!.find((quality) => quality.id === entry.quality!.id)!;
      const affix = entry.affixes[0];
      const definition = rules.content.affixes.find((definition) => definition.id === affix.definitionId)!;
      const multiplier = definition.kind === 'effect' ? quality.effectMultiplier : quality.statMultiplier;
      expect(dec(affix.value).gte(dec(definition.min).mul(multiplier))).toBe(true);
      expect(dec(affix.value).lte(dec(definition.max).mul(multiplier))).toBe(true);
    }
  });
  it('failed forging cannot spend RNG, material, cash or reserve an instance ID', () => {
    const rules = createRules(equipmentCandidate);
    const start = funded(rules);
    start.inventory['spirit-bamboo'] = '0';
    const before = structuredClone(start);
    expect(() => rules.applyCommand(start, { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 })).toThrow(/数量不足/);
    expect(start).toEqual(before);
  });
  it('preserves online/offline identity with a learned technique and quality-scaled equipment', () => {
    const rules = createRules(equipmentCandidate);
    let state = rules.applyCommand(funded(rules), { type: 'craft', recipeId: 'forge-jade-staff', quantity: 1 });
    state = rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: state.equipment[0].instanceId });
    state = rules.applyCommand(state, { type: 'learn-technique', techniqueId: 'flame' });
    state = rules.applyCommand(state, { type: 'technique', techniqueId: 'flame' });
    state = rules.applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 0.5 });
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const whole = rules.advanceGame(state, 600_999);
    let split = state;
    while (split.clockMs < 600_000) split = rules.advanceGame(JSON.parse(JSON.stringify(split)), 600_999, 7);
    expect(split).toEqual(whole);
  });
});

describe('explicit technique acquisition', () => {
  it('requires discovery then a real manual; holding it alone does not unlock practice or operation', () => {
    const rules = createRules(equipmentCandidate);
    let state = rules.createGame(0);
    state.inventory['flame-manual'] = '1';
    expect(() => rules.applyCommand(state, { type: 'learn-technique', techniqueId: 'flame' })).toThrow(/开放/);
    state.regionKills.bamboo = '20';
    expect(() => rules.applyCommand(state, { type: 'technique', techniqueId: 'flame' })).toThrow(/学会/);
    expect(() => rules.applyCommand(state, { type: 'activity', kind: 'practice', targetId: 'flame' })).toThrow(/学会/);
    const before = structuredClone(state);
    state = rules.applyCommand(state, { type: 'learn-technique', techniqueId: 'flame' });
    expect(state.inventory['flame-manual']).toBe('0');
    expect(state.learnedTechniques).toEqual(['breathing', 'flame']);
    expect(state.techniqueId).toBe('breathing');
    expect(state.techniqueXp.flame).toBe('0');
    expect(state.clockMs).toBe(before.clockMs);
    expect(state.rng).toBe(before.rng);
    const active = rules.applyCommand(state, { type: 'technique', techniqueId: 'flame' });
    expect(rules.getGameView(active).techniques.find((entry) => entry.id === 'flame')?.learning).toMatchObject({ discovered: true, learned: true, owned: '0' });
  });
  it('charges real book prices and makes duplicate learning an atomic rejection', () => {
    const rules = createRules(equipmentCandidate);
    const start = funded(rules);
    start.inventory['flame-manual'] = '0';
    const bought = rules.applyCommand(start, { type: 'buy', itemId: 'flame-manual', quantity: 2 });
    expect(BigInt(start.stones) - BigInt(bought.stones)).toBe(480n);
    const learned = rules.applyCommand(bought, { type: 'learn-technique', techniqueId: 'flame' });
    const before = structuredClone(learned);
    expect(() => rules.applyCommand(learned, { type: 'learn-technique', techniqueId: 'flame' })).toThrow(/已经学会/);
    expect(learned).toEqual(before);
    expect(learned.inventory['flame-manual']).toBe('1');
    const sold = rules.applyCommand(learned, { type: 'sell', itemId: 'flame-manual', quantity: 1 });
    expect(BigInt(sold.stones) - BigInt(start.stones)).toBe(-420n);
  });
  it('rejects missing books, combat learning, unknown techniques and legacy-profile learning', () => {
    const rules = createRules(equipmentCandidate);
    const start = funded(rules);
    start.inventory['flame-manual'] = '0';
    const before = structuredClone(start);
    expect(() => rules.applyCommand(start, { type: 'learn-technique', techniqueId: 'flame' })).toThrow(/数量不足/);
    expect(start).toEqual(before);
    expect(() => rules.applyCommand(start, { type: 'learn-technique', techniqueId: 'missing' })).toThrow(/不存在/);
    const fighting = rules.applyCommand(funded(rules), { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    expect(() => rules.applyCommand(fighting, { type: 'learn-technique', techniqueId: 'flame' })).toThrow(/脱战/);
    const legacy = createRules();
    expect(() => legacy.applyCommand(legacy.createGame(0), { type: 'learn-technique', techniqueId: 'flame' })).toThrow(/未开放/);
    expect(gameCommandSchema.parse({ type: 'learn-technique', techniqueId: 'flame' })).toEqual({ type: 'learn-technique', techniqueId: 'flame' });
    expect(() => gameCommandSchema.parse({ type: 'learn-technique', techniqueId: 'flame', free: true })).toThrow();
  });
});

describe('ordinary equipment self-sufficiency floor', () => {
  it('uses a separate version with all common quality and no helpful affix lottery', () => {
    const profile = equipmentProfile(true);
    expect(profile.version).not.toBe(equipmentCandidate.version);
    expect(profile.equipmentQualities!.map((entry) => entry.weight)).toEqual([1, 0, 0]);
    expect(profile.equipment.every((entry) => entry.affixCount === 0)).toBe(true);
    expect(equipmentCandidate.equipment.find((entry) => entry.id === 'iron-sword')?.affixCount).toBe(1);
  });
  it.each(['sword', 'gauntlet', 'staff'] as const)('reaches foundation with two %s replacements and real paid acquisition', (path) => {
    const result = equipmentFoundation(path, 1, true);
    expect(result.state.level).toBe(13);
    expect(result.state.equipment).toHaveLength(3);
    expect(result.upgrades.map((entry) => entry.quality)).toEqual(['plain', 'plain', 'plain']);
    expect(result.upgrades.map((entry) => entry.definitionId)).toEqual(equipmentPaths[path].weapons);
    expect(result.state.learnedTechniques).toEqual(['breathing', equipmentPaths[path].technique]);
    expect(BigInt(result.ledger.manualStones)).toBeGreaterThan(0n);
    expect(result.state.dwelling).toEqual({ tier: 0, gathering: 0, study: 0 });
    expect(Object.values(result.seconds).reduce((sum, value) => sum + value, 0)).toBe(result.foundationSeconds);
    const clearStones = result.content.regions.reduce((sum, region) => sum +
      BigInt(result.state.regionKills[region.id] ?? '0') / BigInt(region.clear!.waves) * BigInt(region.clear!.reward.stones), 0n);
    expect(BigInt(result.state.stones)).toBe(30n + clearStones + BigInt(result.ledger.saleStones) -
      BigInt(result.ledger.purchaseStones) - BigInt(result.ledger.forgingStones) - BigInt(result.ledger.pillCraftStones));
    expect(result.ledger.forgingMaterials['dense-ore']).toBe('8');
    expect(result.ledger.forgingMaterials.heartwood).toBe('8');
    expect(result.state.inventory['foundation-pill']).toBe('0');
  }, 30_000);
  it('retains the insufficient-supply failure rather than auto-resuming or injecting pills', () => {
    expect(() => equipmentFoundation('sword', 1, true, { ruinsSupply: 8, latePreparationLevel: 8 })).toThrow(/战败/);
  }, 30_000);
});
