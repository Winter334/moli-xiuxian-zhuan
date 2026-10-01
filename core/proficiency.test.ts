import { describe, expect, it } from 'vitest';
import { content, type Content } from './content';
import { createRules } from './game';
import { proficiencyProgress, proficiencyRewards, productionTerms } from './proficiency';
import { dec, random } from './numbers';
import type { GameState } from './types';
import type { ProficiencyId } from '../shared/contracts';

function fixture(edit: (c: Content) => void = () => {}) {
  const c = structuredClone(content);
  c.openingTiers = [{ requiredPoints: '0', slots: 1, candidates: 1, draws: 1, designations: 0 }];
  c.fates = [{ id: 'training-fixture', name: 'Training fixture', rarity: 'common', weight: 1,
    effects: [{ kind: 'gift-stones', amount: '0' }] }];
  c.settings.starterEquipmentId = null;
  c.settings.starterItems = { herb: '1000' };
  c.settings.starterStones = '1000';
  c.settings.baseMpRegenFraction = '0';
  c.baseStats.mpRegen = '0';
  c.proficiencyRules.successBase = '0.5';
  c.proficiencyRules.minimumSuccess = '0.1';
  for (const p of c.proficiencies) {
    p.xpBase = '2';
    p.xpGrowth = '2';
    p.maxLevel = 4;
    p.milestones = [];
    p.perLevel = [];
  }
  c.proficiencies.find((p) => p.id === 'body')!.perLevel = [{ stat: 'attack', mode: 'percent', value: '0.1' }];
  c.techniques[0].modifiers = [];
  c.techniques[0].effects = [];
  c.techniques[0].practiceBonuses = [];
  c.equipmentQualities = [
    { id: 'plain', name: 'Plain', rarity: 'common', weight: 1, statMultiplier: '1', effectMultiplier: '1' },
    { id: 'fine', name: 'Fine', rarity: 'uncommon', weight: 1, statMultiplier: '2', effectMultiplier: '2' },
  ];
  c.recipes = [
    { id: 'trial-pill', name: 'Trial pill', unlock: { level: 0 }, costs: [{ itemId: 'herb', quantity: '2' }],
      stones: '3', outputId: 'healing-pill', outputQuantity: '2', training: { difficulty: 2, xp: '2' } },
    { id: 'trial-forge', name: 'Trial forge', unlock: { level: 0 }, costs: [{ itemId: 'herb', quantity: '2' }],
      stones: '3', outputKind: 'equipment', outputId: 'wood-sword', outputQuantity: '1', training: { difficulty: 2, xp: '2' } },
  ];
  c.regions[0].unlock = { level: 0 };
  c.regions[0].enemies = [c.enemies[0].id];
  Object.assign(c.enemies[0], {
    maxHp: '100000', attack: '0', magicAttack: '0', effects: [], drops: [], equipmentDrops: [], hpRegen: '0',
  });
  edit(c);
  const rules = createRules(c);
  let state = rules.createGame(0, 123456789);
  state = rules.applyCommand(state, { type: 'fate-select', lifeId: state.lifeId, slot: 0, fateId: c.fates[0].id });
  // Preserve the combat/production fixture's seed independently of opening draws.
  state.rng = 123456789;
  state = rules.applyCommand(state, { type: 'enter-life', lifeId: state.lifeId });
  return { c, rules, state };
}

function train(state: GameState, id: ProficiencyId, xp: string) {
  state.proficiencyXp[id] = xp;
  state.history.proficiencyXp[id] = xp;
}

describe('proficiency and sequential production', () => {
  it('rejects missing or malformed progression instead of filling old saves', () => {
    const { rules, state } = fixture();
    const missing = structuredClone(state);
    Reflect.deleteProperty(missing, 'proficiencyXp');
    expect(() => rules.getGameView(missing)).toThrow();
    const missingHistory = structuredClone(state);
    Reflect.deleteProperty(missingHistory, 'history');
    expect(() => rules.getGameView(missingHistory)).toThrow();
    state.proficiencyXp.body = '-1';
    expect(() => rules.advanceGame(state, 1000)).toThrow();
    const malformed = rules.createGame(0, 1);
    malformed.crafting['trial-pill'] = { attempts: '1', successes: '0' };
    Reflect.set(malformed.crafting['trial-pill'], 'attempts', 1);
    expect(() => rules.getGameView(malformed)).toThrow();
  });

  it.each(['trial-pill', 'trial-forge'])('charges a failed first attempt without generating a product: %s', (recipeId) => {
    const { rules, state } = fixture();
    const after = rules.applyCommand(state, { type: 'craft', recipeId, quantity: 1 });
    expect(after.crafting[recipeId]).toEqual({ attempts: '1', successes: '0' });
    expect(after.stones).toBe('997');
    expect(after.inventory.herb).toBe('998');
    expect(after.inventory['healing-pill'] ?? '0').toBe('0');
    expect(after.equipment).toHaveLength(0);
    expect(after.proficiencyXp[recipeId === 'trial-pill' ? 'alchemy' : 'forging']).toBe('2');
    expect(state.crafting).toEqual({});
  });

  it.each(['trial-pill', 'trial-forge'])('matches batches to sequential attempts across levels: %s', (recipeId) => {
    const { c, rules, state } = fixture();
    const recipe = c.recipes.find((r) => r.id === recipeId)!;
    const before = productionTerms(c, state.proficiencyXp, recipe);
    const batch = rules.applyCommand(state, { type: 'craft', recipeId, quantity: 12 });
    let single = state;
    for (let i = 0; i < 12; i++) single = rules.applyCommand(single, { type: 'craft', recipeId, quantity: 1 });
    expect(batch).toEqual(single);
    expect(dec(productionTerms(c, batch.proficiencyXp, recipe).successChance).gt(before.successChance)).toBe(true);
    expect(batch.crafting[recipeId].attempts).toBe('12');
    expect(BigInt(batch.crafting[recipeId].successes)).toBeGreaterThan(0n);
    expect(BigInt(batch.crafting[recipeId].successes)).toBeLessThan(12n);
  });

  it('rejects unaffordable batches atomically, without rolling or awarding experience', () => {
    const { rules, state } = fixture();
    const before = structuredClone(state);
    expect(() => rules.applyCommand(state, { type: 'craft', recipeId: 'trial-forge', quantity: 1000 })).toThrow();
    expect(state).toEqual(before);
    state.activity.kind = 'dungeon';
    expect(() => rules.applyCommand(state, { type: 'craft', recipeId: 'trial-pill', quantity: 1 })).toThrow();
  });

  it('raises quality odds only for subsequent forging, not stored equipment', () => {
    const { rules, state } = fixture();
    const before = rules.getGameView(state).recipes.find((r) => r.id === 'trial-forge')!.qualities![1].probability;
    const trained = rules.applyCommand(state, { type: 'craft', recipeId: 'trial-forge', quantity: 12 });
    const snapshot = structuredClone(trained.equipment[0].quality);
    const after = rules.getGameView(trained).recipes.find((r) => r.id === 'trial-forge')!.qualities![1].probability;
    expect(dec(after).gt(before)).toBe(true);
    const later = rules.applyCommand(trained, { type: 'craft', recipeId: 'trial-forge', quantity: 12 });
    expect(later.equipment[0].quality).toEqual(snapshot);
  });

  it('derives capped levels and milestone percentages once, without claim commands', () => {
    const { c } = fixture();
    const definition = c.proficiencies.find((p) => p.id === 'body')!;
    definition.milestones = [{ level: 2, name: 'Milestone', successBonus: '0',
      modifiers: [{ stat: 'attack', mode: 'percent', value: '0.2' }] }];
    expect(proficiencyProgress(definition, '6').level).toBe(2);
    const reward = proficiencyRewards(definition, '6');
    expect(reward.modifiers.map((m) => m.value)).toEqual(['0.2', '0.2']);
    expect(proficiencyRewards(definition, '6')).toEqual(reward);
    expect(proficiencyProgress(definition, '30')).toEqual({ level: 4, nextLevelXp: null });
  });

  it('awards once per action rather than per hit, and keeps offline advancement identical', () => {
    const { c, rules, state } = fixture((c) => {
      c.actions.find((a) => a.id === c.settings.baseActionId)!.hits = 3;
    });
    const start = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id });
    const oneAction = rules.advanceGame(start, 2000);
    expect(oneAction.proficiencyXp.body).toBe('1');
    const bulk = rules.advanceGame(start, 20000);
    let ticks = start;
    for (let time = 1000; time <= 20000; time += 1000) ticks = rules.advanceGame(ticks, time);
    expect(bulk).toEqual(ticks);
    expect(dec(rules.getPlayerStats(bulk).attack).gt(rules.getPlayerStats(start).attack)).toBe(true);
    const idle = rules.applyCommand(bulk, { type: 'activity', kind: 'idle' });
    expect(rules.advanceGame(idle, 21000).proficiencyXp).toEqual(idle.proficiencyXp);
  });

  it('trains real spells but not mana-starved fallback actions', () => {
    const cast = fixture((c) => {
      c.techniques[0].actionId = 'spark';
      c.actions.find((a) => a.id === 'spark')!.mpCost = '1';
    });
    const start = cast.rules.applyCommand(cast.state, { type: 'activity', kind: 'dungeon', targetId: cast.c.regions[0].id });
    expect(cast.rules.advanceGame(start, 2000).proficiencyXp.spell).toBe('1');
    const empty = fixture((c) => {
      c.techniques[0].actionId = 'spark';
      c.actions.find((a) => a.id === 'spark')!.mpCost = '999';
    });
    const fallback = empty.rules.applyCommand(empty.state, { type: 'activity', kind: 'dungeon', targetId: empty.c.regions[0].id });
    const end = empty.rules.advanceGame(fallback, 2000);
    expect(end.proficiencyXp.spell).toBe('0');
    expect(end.proficiencyXp.body).toBe('1');
  });

  it('retains learned weapon proficiency while disabling its rewards after changing category', () => {
    const { c, rules, state } = fixture((c) => {
      Object.assign(c.equipment.find((e) => e.id === 'wood-sword')!, { modifiers: [], effects: [], affixCount: 0 });
    });
    let trained = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id });
    trained = rules.advanceGame(trained, 20000);
    trained = rules.applyCommand(trained, { type: 'activity', kind: 'idle' });
    trained = rules.applyCommand(trained, { type: 'craft', recipeId: 'trial-forge', quantity: 12 });
    const before = rules.getPlayerStats(trained);
    const equipped = rules.applyCommand(trained, { type: 'equip', slot: 'weapon', instanceId: trained.equipment[0].instanceId });
    expect(equipped.proficiencyXp.body).toBe(trained.proficiencyXp.body);
    expect(dec(rules.getPlayerStats(equipped).attack).lt(before.attack)).toBe(true);
    expect(rules.getGameView(equipped).proficiencies.find((p) => p.id === 'body')!.active).toBe(false);
  });

  it('consumes magic-defense growth independently with identical batch and single results', () => {
    const { rules, state } = fixture((c) => {
      c.items.push({ id: 'ward-pill', name: 'Ward', kind: 'growth', unlock: { level: 0 },
        use: { kind: 'growth', stat: 'magicDefense', amount: '0.5', scale: '1' } });
      c.settings.starterItems['ward-pill'] = '4';
    });
    const batch = rules.applyCommand(state, { type: 'consume', itemId: 'ward-pill', quantity: 4 });
    let single = state;
    for (let i = 0; i < 4; i++) single = rules.applyCommand(single, { type: 'consume', itemId: 'ward-pill', quantity: 1 });
    expect(batch).toEqual(single);
    expect(batch.player.pillDefense).toBe(state.player.pillDefense);
    expect(batch.player.pillMagicAttack).toBe(state.player.pillMagicAttack);
    expect(dec(batch.player.pillMagicDefense).gt(0)).toBe(true);
    expect(batch.proficiencyXp).toEqual(state.proficiencyXp);
  });

  it('uses enemy realm experience independently of player realm and recipe XP independently of proficiency', () => {
    const { c, rules, state } = fixture((c) => { c.enemies[0].level = 4; });
    const experienced = structuredClone(state);
    experienced.level = 12;
    const actionXp = [state, experienced].map((start) => rules.advanceGame(
      rules.applyCommand(start, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id }), 2000,
    ).proficiencyXp.body);
    expect(actionXp[0]).toBe(actionXp[1]);
    expect(actionXp[0]).toBe(dec(c.proficiencyRules.combatXpPerAction).mul(c.proficiencyRules.realmXpMultipliers[4]).toFixed());
    const recipe = c.recipes[0];
    const before = productionTerms(c, state.proficiencyXp, recipe);
    train(state, 'alchemy', '30');
    const after = productionTerms(c, state.proficiencyXp, recipe);
    expect([before.successXp, before.failureXp, after.successXp, after.failureXp]).toEqual(Array(4).fill(recipe.training.xp));
  });

  it('charges only real spells, casts the charged spell with no mana, and does not charge itself', () => {
    const { c, rules, state } = fixture((c) => {
      c.techniques[0].actionId = 'spark';
      Object.assign(c.actions.find((a) => a.id === 'spark')!, { mpCost: '2', hits: 3 });
      c.enemies[0].magicDefense = '0';
      c.proficiencies.find((p) => p.id === 'spell')!.milestones = [
        { level: 1, name: 'Surge', modifiers: [], successBonus: '0',
          ability: { kind: 'spell-surge', casts: 2, powerBonus: '1' } },
      ];
    });
    train(state, 'spell', '2');
    state.player.mp = '4';
    const start = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id });
    const ready = rules.advanceGame(start, 4000);
    expect(ready.player.mp).toBe('0');
    expect(ready.proficiencyCombat.spellCasts).toBe(2);
    const empowered = rules.advanceGame(ready, 6000);
    expect(empowered.player.mp).toBe('0');
    expect(empowered.proficiencyCombat.spellCasts).toBe(0);
    expect(dec(empowered.proficiencyXp.spell).minus(ready.proficiencyXp.spell).toFixed()).toBe('1');
    const normal = structuredClone(ready);
    normal.player.mp = '2';
    normal.proficiencyCombat.spellCasts = 0;
    const ordinary = rules.advanceGame(normal, 6000);
    const baseDamage = dec(normal.battle!.hp).minus(ordinary.battle!.hp);
    expect(baseDamage.gt(0)).toBe(true);
    expect(dec(ready.battle!.hp).minus(empowered.battle!.hp).toFixed()).toBe(baseDamage.mul(2).toFixed());
    const fallback = rules.advanceGame(empowered, 8000);
    expect(fallback.proficiencyXp.spell).toBe(empowered.proficiencyXp.spell);
    expect(fallback.proficiencyCombat.spellCasts).toBe(0);
    let ticks = start;
    for (let time = 1000; time <= 8000; time += 1000) ticks = rules.advanceGame(ticks, time);
    expect(fallback).toEqual(ticks);
  });

  it('carries spell charge to the next encounter but clears it when leaving or losing', () => {
    const { c, rules, state } = fixture((c) => {
      c.techniques[0].actionId = 'spark';
      c.actions.find((a) => a.id === 'spark')!.hits = 3;
      c.proficiencies.find((p) => p.id === 'spell')!.milestones = [
        { level: 1, name: 'Surge', modifiers: [], successBonus: '0',
          ability: { kind: 'spell-surge', casts: 2, powerBonus: '1' } },
      ];
    });
    train(state, 'spell', '2');
    const start = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id });
    start.battle!.hp = '1';
    start.proficiencyCombat.spellCasts = 1;
    const next = rules.advanceGame(start, 2000);
    expect(next.totals.kills).toBe('1');
    expect(next.proficiencyCombat.spellCasts).toBe(2);
    expect(rules.applyCommand(next, { type: 'activity', kind: 'idle' }).proficiencyCombat.spellCasts).toBe(0);
    next.player.hp = '0';
    expect(rules.advanceGame(next, 3000).proficiencyCombat.spellCasts).toBe(0);
  });

  it('sword follow-up is a hit, not a second training or action-effect settlement', () => {
    const { c, rules, state } = fixture((c) => {
      c.settings.starterEquipmentId = 'wood-sword';
      c.effects.push({ id: 'action-mana', name: 'Action mana', kind: 'restore', resource: 'mp', trigger: 'action', amount: '1' });
      c.techniques[0].effects = ['action-mana'];
      c.proficiencies.find((p) => p.id === 'sword')!.milestones = [
        { level: 1, name: 'Follow-up', modifiers: [], successBonus: '0',
          ability: { kind: 'sword-followup', everyActions: 2, coefficient: '1' } },
      ];
    });
    train(state, 'sword', '2');
    state.player.mp = '0';
    const start = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id });
    const end = rules.advanceGame(start, 4000);
    expect(end.journal.filter((entry) => entry.text === '连势追击')).toHaveLength(1);
    expect(end.proficiencyXp.sword).toBe('4');
    expect(end.history.proficiencyXp.sword).toBe('4');
    expect(end.player.mp).toBe('2');
    expect(end.techniqueXp[c.settings.starterTechniqueId]).toBe(dec(c.settings.combatPracticePerAction).mul(2).toFixed());
  });

  it('body ward triggers between hits only once per encounter, and never revives lethal damage', () => {
    const make = (attack: string) => fixture((c) => {
      Object.assign(c.enemies[0], { attack, agility: '100000', attackIntervalMs: 1000 });
      c.actions.find((a) => a.id === c.settings.baseActionId)!.hits = 3;
      c.proficiencies.find((p) => p.id === 'body')!.milestones = [
        { level: 1, name: 'Ward', modifiers: [], successBonus: '0',
          ability: { kind: 'body-ward', hpThreshold: '0.5', maxHpFraction: '0.2' } },
      ];
    });
    const { c, rules, state } = make('17');
    train(state, 'body', '2');
    state.player.hp = '70';
    const start = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id });
    const hit = rules.advanceGame(start, 1000);
    expect(hit.player.hp).toBe('40');
    expect(hit.player.shield).toBe('5');
    expect(hit.proficiencyCombat.bodyWardUsed).toBe(true);
    hit.player.shield = '0';
    hit.battle!.nextActionMs = 10000;
    const again = rules.advanceGame(hit, 2000);
    expect(again.player.shield).toBe('0');
    const idle = rules.applyCommand(again, { type: 'activity', kind: 'idle' });
    expect(idle.proficiencyCombat.bodyWardUsed).toBe(false);
    const restart = rules.applyCommand(idle, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id });
    expect(restart.player.shield).toBe('20');
    const lethal = make('1000');
    train(lethal.state, 'body', '2');
    const lost = lethal.rules.advanceGame(lethal.rules.applyCommand(lethal.state,
      { type: 'activity', kind: 'dungeon', targetId: lethal.c.regions[0].id }), 1000);
    expect(lost.player.hp).toBe('0');
    expect(lost.activity.kind).toBe('idle');
    expect(lost.journal.some((entry) => entry.text === '护体生效')).toBe(false);
  });

  it('does not activate sword or body abilities with a staff', () => {
    const { c, rules, state } = fixture((c) => {
      c.settings.starterEquipmentId = 'jade-staff';
      c.equipment.find((e) => e.id === 'jade-staff')!.effects = [];
      c.equipment.find((e) => e.id === 'jade-staff')!.affixCount = 0;
      c.proficiencies.find((p) => p.id === 'sword')!.milestones = [
        { level: 1, name: 'Follow-up', modifiers: [], successBonus: '0',
          ability: { kind: 'sword-followup', everyActions: 1, coefficient: '1' } },
      ];
      c.proficiencies.find((p) => p.id === 'body')!.milestones = [
        { level: 1, name: 'Ward', modifiers: [], successBonus: '0',
          ability: { kind: 'body-ward', hpThreshold: '0.5', maxHpFraction: '0.2' } },
      ];
    });
    train(state, 'sword', '2');
    train(state, 'body', '2');
    state.player.hp = '1';
    const end = rules.advanceGame(rules.applyCommand(state,
      { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id }), 4000);
    expect(end.proficiencyCombat).toEqual({ swordActions: 0, spellCasts: 0, bodyWardUsed: false });
    expect(end.player.shield).toBe('0');
    expect(end.proficiencyXp.sword).toBe('2');
  });

  it('rolls quality twice but creates one item, one set of affixes, and one XP award', () => {
    const { rules, state } = fixture((c) => {
      c.proficiencyRules.qualityWeightPerLevel = '0';
      c.recipes[1].training.difficulty = 1;
      Object.assign(c.equipment.find((e) => e.id === 'wood-sword')!, { affixPool: ['keen', 'steady'], affixCount: 1 });
      c.proficiencies.find((p) => p.id === 'forging')!.milestones = [
        { level: 1, name: 'Craft', modifiers: [], successBonus: '0', ability: { kind: 'quality-reroll' } },
      ];
    });
    train(state, 'forging', '2');
    const draws = structuredClone(state);
    const quality = Math.max(random(draws), random(draws)) >= 0.5 ? 'fine' : 'plain';
    random(draws);
    random(draws);
    const end = rules.applyCommand(state, { type: 'craft', recipeId: 'trial-forge', quantity: 1 });
    expect(end.equipment).toHaveLength(1);
    expect(end.equipment[0].quality!.id).toBe(quality);
    expect(end.equipment[0].affixes).toHaveLength(1);
    expect(end.rng).toBe(draws.rng);
    expect(end.proficiencyXp.forging).toBe('4');
    expect(end.crafting['trial-forge']).toEqual({ attempts: '1', successes: '1' });
    const view = rules.getGameView(state).recipes.find((r) => r.id === 'trial-forge')!;
    expect(view.production.qualityRolls).toBe(2);
    expect(view.qualities!.map((q) => q.probability)).toEqual(['0.25', '0.75']);
    const batch = rules.applyCommand(state, { type: 'craft', recipeId: 'trial-forge', quantity: 2 });
    expect(batch).toEqual(rules.applyCommand(end, { type: 'craft', recipeId: 'trial-forge', quantity: 1 }));
  });

  it('extra pills neither recurse nor award extra XP, and are never given on failure', () => {
    const make = (difficulty: number) => fixture((c) => {
      c.proficiencyRules.alchemyExtraChancePerLevel = '0.5';
      Object.assign(c.recipes[0], { extraOutputEligible: true, training: { difficulty, xp: '2' } });
    });
    const { rules, state } = make(2);
    train(state, 'alchemy', '6');
    const end = rules.applyCommand(state, { type: 'craft', recipeId: 'trial-pill', quantity: 1 });
    expect(end.inventory['healing-pill']).toBe('4');
    expect(end.proficiencyXp.alchemy).toBe('8');
    expect(end.crafting['trial-pill']).toEqual({ attempts: '1', successes: '1' });
    const batch = rules.applyCommand(state, { type: 'craft', recipeId: 'trial-pill', quantity: 2 });
    expect(batch).toEqual(rules.applyCommand(end, { type: 'craft', recipeId: 'trial-pill', quantity: 1 }));
    const failed = make(100);
    train(failed.state, 'alchemy', '6');
    const noProduct = failed.rules.applyCommand(failed.state, { type: 'craft', recipeId: 'trial-pill', quantity: 1 });
    expect(noProduct.inventory['healing-pill'] ?? '0').toBe('0');
    expect(noProduct.proficiencyXp.alchemy).toBe('8');
    expect(noProduct.crafting['trial-pill']).toEqual({ attempts: '1', successes: '0' });
  });

  it('learns milestone recipes on valid XP gain and preserves knowledge separately from current crafting eligibility', () => {
    const { rules, state } = fixture((c) => {
      c.proficiencies.find((p) => p.id === 'alchemy')!.milestones = [
        { level: 1, name: 'Knowledge', modifiers: [], successBonus: '0' },
      ];
      c.recipes.push({ ...c.recipes[0], id: 'special-pill', alchemyLevel: 1 });
    });
    const before = structuredClone(state);
    expect(() => rules.applyCommand(state, { type: 'craft', recipeId: 'special-pill', quantity: 1 })).toThrow();
    expect(state).toEqual(before);
    const learned = rules.applyCommand(state, { type: 'craft', recipeId: 'trial-pill', quantity: 1 });
    expect(learned.history.learnedRecipes).toEqual(['special-pill']);
    expect(rules.getGameView(learned).recipes.find((r) => r.id === 'special-pill')!.unlocked).toBe(true);
    const freshLife = structuredClone(learned);
    freshLife.proficiencyXp.alchemy = '0';
    const view = rules.getGameView(freshLife).recipes.find((r) => r.id === 'special-pill')!;
    expect(view.learning).toEqual({ learned: true, requiredAlchemyLevel: 1 });
    expect(view.unlocked).toBe(false);
    expect(() => rules.applyCommand(freshLife, { type: 'craft', recipeId: 'special-pill', quantity: 1 })).toThrow();
    const retrained = rules.applyCommand(freshLife, { type: 'craft', recipeId: 'trial-pill', quantity: 1 });
    expect(retrained.history.learnedRecipes).toEqual(['special-pill']);
    expect(retrained.history.proficiencyXp.alchemy).toBe('2');
    expect(retrained.journal.filter((entry) => entry.text === '领悟Trial pill')).toHaveLength(1);
  });
});
