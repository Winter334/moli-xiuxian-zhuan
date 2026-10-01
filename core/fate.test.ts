import { describe, expect, it } from 'vitest';
import { content, loadContent, type Content, type FateEffect } from './content';
import { createRules } from './game';
import { effectiveDrop, effectiveManaCost, fateView } from './fate';
import { dec, random } from './numbers';
import type { GameCommand, GameState } from './types';
import { gameCommandSchema } from '../server/validation';

type Rules = ReturnType<typeof createRules>;
const noEffect: FateEffect = { kind: 'gift-stones', amount: '0' };
function fixture(edit: (c: Content) => void = () => {}) {
  const c = structuredClone(content);
  c.openingTiers = [{ requiredPoints: '0', slots: 2, candidates: 3, draws: 3, designations: 1 }];
  c.fates = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map((id, index) => ({
    id, name: id, rarity: 'common', weight: index + 1, effects: [noEffect],
  }));
  c.settings.starterEquipmentId = null;
  c.settings.starterStones = '1000';
  c.settings.starterItems = { herb: '1000' };
  c.settings.baseMpRegenFraction = '0';
  c.baseStats.mpRegen = '0';
  c.techniques[0].modifiers = [];
  c.techniques[0].effects = [];
  c.techniques[0].practiceBonuses = [];
  c.regions[0].unlock = { level: 0 };
  c.regions[0].enemies = [c.enemies[0].id];
  Object.assign(c.enemies[0], {
    maxHp: '1', hpRegen: '0', defense: '0', magicDefense: '0', attack: '0', effects: [],
    drops: [], equipmentDrops: [], cultivation: '2', stones: '3', attackIntervalMs: 10000,
  });
  edit(c);
  const rules = createRules(c);
  return { c, rules, state: rules.createGame(0, 123456789) };
}
function enter(rules: Rules, state: GameState, ids = state.opening!.candidates.slice(0, 2)) {
  let selected = state;
  ids.forEach((fateId, slot) => {
    selected = rules.applyCommand(selected, { type: 'fate-select', lifeId: state.lifeId, slot, fateId });
  });
  return rules.applyCommand(selected, { type: 'enter-life', lifeId: state.lifeId });
}
function active(effects: FateEffect[], edit: (c: Content) => void = () => {}) {
  const f = fixture((c) => {
    c.fates = c.fates.slice(0, 2);
    c.fates[0].effects = effects;
    edit(c);
  });
  return { ...f, state: enter(f.rules, f.state) };
}
function fight(rules: Rules, state: GameState) {
  const result = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: rules.content.regions[0].id });
  result.rng = 1;
  return result;
}

describe('persistent innate-fate preparation', () => {
  it('persists the first paid draw and advances preparation time without income or RNG changes', () => {
    const { rules, state } = fixture();
    expect(state.opening!.drawsUsed).toBe(1);
    expect(new Set(state.opening!.candidates).size).toBe(state.opening!.candidates.length);
    expect(state.stones).toBe('0');
    expect(state.inventory).toEqual({});
    const reloaded = JSON.parse(JSON.stringify(state)) as GameState;
    const advanced = rules.advanceGame(reloaded, 86_400_000, 1);
    expect(advanced).toEqual({ ...state, clockMs: 86_400_000 });
    expect(rules.getGameView(advanced).life.opening!.drawsRemaining).toBe(2);
    for (const command of [
      { type: 'activity', kind: 'meditate' }, { type: 'craft', recipeId: 'healing', quantity: 1 },
      { type: 'buy', itemId: 'herb', quantity: 1 }, { type: 'consume', itemId: 'healing-pill', quantity: 1 },
    ] as GameCommand[]) expect(() => rules.applyCommand(advanced, command)).toThrow(/入世/);
    expect(state.clockMs).toBe(0);
  });

  it('keeps selected fates across draws, disallows duplicates and does not archive discarded candidates', () => {
    const { rules, state } = fixture();
    const chosen = state.opening!.candidates[0];
    const selected = rules.applyCommand(state, { type: 'fate-select', lifeId: '1', slot: 0, fateId: chosen });
    expect(() => rules.applyCommand(selected, { type: 'fate-select', lifeId: '1', slot: 1, fateId: chosen })).toThrow(/重复/);
    const drawn = rules.applyCommand(selected, { type: 'fate-draw', lifeId: '1' });
    expect(drawn.opening!.selected).toEqual([chosen, null]);
    expect(drawn.opening!.candidates).not.toContain(chosen);
    const discarded = rules.applyCommand(drawn, { type: 'fate-select', lifeId: '1', slot: 0, fateId: null });
    expect(() => rules.applyCommand(discarded, { type: 'fate-select', lifeId: '1', slot: 0, fateId: chosen })).toThrow(/当前批次/);
    const final = rules.applyCommand(discarded, { type: 'fate-draw', lifeId: '1' });
    expect(() => rules.applyCommand(final, { type: 'fate-draw', lifeId: '1' })).toThrow(/次数/);
    expect(rules.applyCommand(JSON.parse(JSON.stringify(discarded)), { type: 'fate-draw', lifeId: '1' })).toEqual(final);
  });

  it('returns a smaller pool when exclusions leave fewer than one full batch', () => {
    const { rules, state } = fixture((c) => { c.fates = c.fates.slice(0, 2); });
    const selected = rules.applyCommand(state, { type: 'fate-select', lifeId: '1', slot: 0, fateId: state.opening!.candidates[0] });
    const drawn = rules.applyCommand(selected, { type: 'fate-draw', lifeId: '1' });
    expect(drawn.opening!.candidates).toHaveLength(1);
    const filled = rules.applyCommand(drawn, { type: 'fate-select', lifeId: '1', slot: 1, fateId: drawn.opening!.candidates[0] });
    expect(rules.applyCommand(filled, { type: 'enter-life', lifeId: '1' }).phase).toBe('active');
  });

  it('grants only the final gifts once, records entered rather than seen fates, and excludes preparation time', () => {
    const { c, rules, state } = fixture((c) => {
      c.openingTiers[0].candidates = c.fates.length;
      c.fates[0].effects = [{ kind: 'gift-stones', amount: '7' }];
      c.fates[1].effects = [{ kind: 'gift-stones', amount: '11' }];
    });
    const selected = rules.applyCommand(state, { type: 'fate-select', lifeId: '1', slot: 0, fateId: 'alpha' });
    expect(selected.stones).toBe('0');
    expect(() => rules.applyCommand(selected, { type: 'enter-life', lifeId: '1' })).toThrow(/填满/);
    const prepared = rules.advanceGame(selected, 100000);
    const entered = enter(rules, prepared, ['beta', 'gamma']);
    expect(entered.stones).toBe((BigInt(c.settings.starterStones) + 11n).toString());
    expect(entered.history.enteredFates).toEqual(['beta', 'gamma']);
    expect(entered.opening).toBeNull();
    expect(entered.activity.startedAt).toBe(100000);
    expect(entered.totals.activeSeconds).toBe('0');
    expect(() => rules.applyCommand(entered, { type: 'enter-life', lifeId: '1' })).toThrow(/已经入世/);
    expect(() => rules.applyCommand(entered, { type: 'fate-draw', lifeId: '1' })).toThrow(/已经入世/);
    const begun = rules.applyCommand(entered, { type: 'activity', kind: 'meditate' });
    expect(rules.advanceGame(begun, 101000).totals.activeSeconds).toBe('1');
  });

  it('requires designation qualification and spends quota permanently even if the fate is replaced', () => {
    const { rules, state } = fixture();
    expect(() => rules.applyCommand(state, { type: 'fate-designate', lifeId: '1', slot: 0, fateId: 'alpha' })).toThrow(/资格/);
    state.history.enteredFates = ['alpha'];
    const selected = rules.applyCommand(state, { type: 'fate-designate', lifeId: '1', slot: 0, fateId: 'alpha' });
    const cleared = rules.applyCommand(selected, { type: 'fate-select', lifeId: '1', slot: 0, fateId: null });
    expect(cleared.opening!.designationsUsed).toBe(1);
    expect(() => rules.applyCommand(cleared, { type: 'fate-designate', lifeId: '1', slot: 0, fateId: 'alpha' })).toThrow(/次数/);
    expect(() => rules.applyCommand(state, { type: 'fate-draw', lifeId: '2' })).toThrow(/本世/);
    const explicit = fixture((c) => { c.fates[0].designatable = true; });
    expect(explicit.rules.applyCommand(explicit.state,
      { type: 'fate-designate', lifeId: '1', slot: 0, fateId: 'alpha' }).opening!.selected[0]).toBe('alpha');
  });

  it('rejects missing state and invalid definitions instead of patching old saves', () => {
    const { c, rules, state } = fixture();
    for (const field of ['lifeId', 'phase', 'innateFates', 'opening']) {
      const broken = structuredClone(state);
      Reflect.deleteProperty(broken, field);
      expect(() => rules.getGameView(broken)).toThrow();
    }
    for (const edit of [
      (c: Content) => { c.fates = c.fates.slice(0, 1); },
      (c: Content) => { c.fates[0].weight = 0; },
      (c: Content) => { c.fates[0].effects = [{ kind: 'item-drop', itemIds: ['missing'], value: '1' }]; },
      (c: Content) => { c.fates[0].effects = [{ kind: 'purchase-discount', itemIds: ['herb'], value: '0.1' }]; },
    ]) {
      const invalid = structuredClone(c);
      edit(invalid);
      expect(() => loadContent(invalid)).toThrow();
    }
    expect(gameCommandSchema.safeParse({ type: 'enter-life' }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ type: 'fate-select', lifeId: '1', slot: -1, fateId: 'alpha' }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ type: 'enter-life', lifeId: '1' }).success).toBe(true);
  });
});

describe('fate effects share ordinary settlement', () => {
  it('combines signed attributes in the same pool, respects actual weapon conditions, and fills final entry caps', () => {
    const { c, rules, state } = active([
      { kind: 'stat', modifier: { stat: 'maxHp', mode: 'percent', value: '-0.2' } },
      { kind: 'stat', modifier: { stat: 'maxHp', mode: 'percent', value: '0.3' } },
      { kind: 'stat', modifier: { stat: 'maxMp', mode: 'percent', value: '0.5' } },
      { kind: 'stat', when: 'sword', modifier: { stat: 'attack', mode: 'percent', value: '0.3' } },
      { kind: 'stat', when: 'body', modifier: { stat: 'attack', mode: 'percent', value: '0.2' } },
    ], (c) => { c.settings.baseMpRegenFraction = '0.1'; });
    const stats = rules.getPlayerStats(state);
    expect(stats.maxHp).toBe(dec(c.realms[0].maxHp).mul('1.1').toFixed());
    expect(state.player.hp).toBe(stats.maxHp);
    expect(state.player.mp).toBe(stats.maxMp);
    expect(stats.mpRegen).toBe(dec(stats.maxMp).mul('0.1').toFixed());
    expect(stats.attack).toBe(dec(c.realms[0].attack).mul('1.2').toFixed());
    state.equipment.push({ instanceId: 'test-sword', definitionId: 'wood-sword', contentVersion: c.version, affixes: [] });
    const equipped = rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: 'test-sword' });
    const weaponFlat = c.equipment.find((e) => e.id === 'wood-sword')!.modifiers.find((m) => m.stat === 'attack')!.value;
    expect(rules.getPlayerStats(equipped).attack).toBe(dec(c.realms[0].attack).plus(weaponFlat).mul('1.3').toFixed());
    expect(fateView(c, c.fates[0]).effects[0]).toContain('-20%');
    expect(fateView(c, c.fates[0]).effects[0]).not.toContain('+-');
  });

  it('adds meditation and study efficiency to dwelling bonuses, without cross-awarding other XP', () => {
    const { c, rules, state } = active([
      { kind: 'experience', target: 'meditation', value: '0.3' },
      { kind: 'experience', target: 'technique', value: '0.4' },
    ], (c) => {
      c.dwelling = { tiers: [{ id: 'home', name: 'Home', meditationBonus: '0.2', practiceBonus: '0.1',
        requiredGathering: 0, stones: '0', costs: [] }], gathering: [], study: [] };
    });
    const meditate = rules.advanceGame(rules.applyCommand(state, { type: 'activity', kind: 'meditate' }), 1000);
    expect(meditate.cultivation).toBe(dec(c.realms[0].meditation).mul('1.5').toFixed());
    expect(meditate.proficiencyXp).toEqual(state.proficiencyXp);
    const study = rules.advanceGame(rules.applyCommand(state,
      { type: 'activity', kind: 'practice', targetId: c.settings.starterTechniqueId }), 1000);
    expect(study.techniqueXp[c.settings.starterTechniqueId]).toBe(dec(c.settings.practicePerSecond).mul('1.5').toFixed());
    expect(study.cultivation).toBe('0');
  });

  it('uses effective mana for affordability and payment, leaves enemies unchanged, and keeps surge free', () => {
    const { c, rules, state } = active([
      { kind: 'mana-cost', value: '-0.2' }, { kind: 'mana-cost', value: '0.1' },
      { kind: 'experience', target: 'spell', value: '0.5' },
    ], (c) => {
      c.techniques[0].actionId = 'spark';
      Object.assign(c.actions.find((a) => a.id === 'spark')!, { mpCost: '10', hits: 3 });
      c.enemies[0].maxHp = '100000';
      c.enemies[0].actionId = 'spark';
    });
    state.player.mp = '9';
    const start = fight(rules, state);
    const end = rules.advanceGame(start, 2000);
    expect(end.player.mp).toBe('0');
    expect(end.proficiencyXp.spell).toBe(dec(c.proficiencyRules.combatXpPerAction)
      .mul(c.proficiencyRules.realmXpMultipliers[c.enemies[0].level]).mul('1.5').toFixed());
    expect(rules.getGameView(start).player.action.mpCost).toBe('9');
    expect(rules.getGameView(start).battle!.action.mpCost).toBe('10');
    expect(effectiveManaCost(c, state, '0')).toBe('0');
    const fallback = rules.advanceGame(end, 4000);
    expect(fallback.proficiencyXp.spell).toBe(end.proficiencyXp.spell);
    const p = c.proficiencies.find((p) => p.id === 'spell')!;
    const cost = dec(p.xpBase).mul(dec(p.xpGrowth).pow(3).minus(1)).div(dec(p.xpGrowth).minus(1)).toFixed();
    end.proficiencyXp.spell = end.history.proficiencyXp.spell = cost;
    const surge = p.milestones.find((m) => m.ability?.kind === 'spell-surge')!.ability!;
    if (surge.kind !== 'spell-surge') throw new Error('Missing fixture ability');
    end.proficiencyCombat.spellCasts = surge.casts;
    expect(rules.getGameView(end).player.action.mpCost).toBe('0');
    expect(rules.advanceGame(end, 4000).proficiencyCombat.spellCasts).toBe(0);
  });

  it('applies mana penalties before fallback and does not let stacked ordinary discounts grant free actions', () => {
    const { c, rules, state } = active([{ kind: 'mana-cost', value: '0.5' }], (c) => {
      c.techniques[0].actionId = 'spark';
      c.actions.find((a) => a.id === 'spark')!.mpCost = '10';
      c.enemies[0].maxHp = '100000';
    });
    state.player.mp = '10';
    const end = rules.advanceGame(fight(rules, state), 2000);
    expect(end.player.mp).toBe('10');
    expect(end.proficiencyXp.spell).toBe('0');
    c.fates[0].effects = [{ kind: 'mana-cost', value: '-0.8' }, { kind: 'mana-cost', value: '-0.8' }];
    expect(dec(effectiveManaCost(c, state, '10')).gt(0)).toBe(true);
  });

  it('awards boosted full production XP on both outcomes, with identical batch and single attempts', () => {
    const { c, rules, state } = active([
      { kind: 'experience', target: 'alchemy', value: '0.2' },
      { kind: 'experience', target: 'alchemy', value: '0.3' },
      { kind: 'production-success', target: 'alchemy', value: '0.1' },
      { kind: 'luck', value: '9' },
    ], (c) => {
      c.proficiencyRules.successBase = '0.5';
      c.proficiencyRules.minimumSuccess = '0.1';
      c.recipes = [{ id: 'test-pill', name: 'Test pill', costs: [{ itemId: 'herb', quantity: '1' }],
        stones: '2', outputId: 'healing-pill', outputQuantity: '1', unlock: { level: 0 }, training: { difficulty: 1, xp: '2' } }];
    });
    const view = rules.getGameView(state).recipes[0].production;
    expect(view.successChance).toBe('0.6');
    expect(view.successXp).toBe('3');
    expect(view.failureXp).toBe('3');
    const failed = structuredClone(state);
    failed.rng = 123456789;
    const attempt = rules.applyCommand(failed, { type: 'craft', recipeId: c.recipes[0].id, quantity: 1 });
    expect(attempt.crafting[c.recipes[0].id].successes).toBe('0');
    expect(attempt.proficiencyXp.alchemy).toBe('3');
    const successful = structuredClone(state);
    successful.rng = 1;
    expect(rules.applyCommand(successful, { type: 'craft', recipeId: c.recipes[0].id, quantity: 1 })
      .proficiencyXp.alchemy).toBe('3');
    const batch = rules.applyCommand(state, { type: 'craft', recipeId: c.recipes[0].id, quantity: 9 });
    let single = state;
    for (let i = 0; i < 9; i++) single = rules.applyCommand(single, { type: 'craft', recipeId: c.recipes[0].id, quantity: 1 });
    expect(batch).toEqual(single);
    expect(batch.proficiencyXp.forging).toBe('0');
  });

  it('restores a fraction of final mana only once per real kill, not once per hit', () => {
    const { rules, state } = active([
      { kind: 'stat', modifier: { stat: 'maxMp', mode: 'percent', value: '0.5' } },
      { kind: 'combat', effect: { id: 'kill-mana', name: 'Kill mana', trigger: 'kill',
        kind: 'restore-percent', resource: 'mp', amount: '0.1' } },
    ], (c) => {
      c.techniques[0].actionId = 'spark';
      Object.assign(c.actions.find((a) => a.id === 'spark')!, { hits: 3, mpCost: '0' });
      c.proficiencies.find((p) => p.id === 'spell')!.xpBase = '1';
    });
    state.player.mp = '0';
    const start = fight(rules, state);
    expect(rules.advanceGame(start, 1000).player.mp).toBe('0');
    const end = rules.advanceGame(start, 2000);
    expect(end.totals.kills).toBe('1');
    expect(dec(rules.getPlayerStats(end).maxMp).gt(rules.getPlayerStats(start).maxMp)).toBe(true);
    expect(end.player.mp).toBe(dec(rules.getPlayerStats(end).maxMp).mul('0.1').toFixed());
  });

  it('combines targeted drops and luck additively, honors exclusions and caps, and uses the displayed odds', () => {
    const { c, rules, state } = active([
      { kind: 'luck', value: '0.5' }, { kind: 'item-drop', itemIds: ['herb'], value: '0.25' },
    ], (c) => {
      c.enemies[0].drops = [
        { itemId: 'herb', quantity: '2', chance: 0.2 },
        { itemId: 'ore', quantity: '3', chance: 0.5, luckExcludedReason: 'Special drop' },
        { itemId: 'essence', quantity: '1', chance: 0.9 },
        { itemId: 'healing-pill', quantity: '1', chance: 1 },
      ];
      c.enemies[0].equipmentDrops = [{ equipmentId: 'wood-sword', chance: 0 }];
      c.regions[0].firstClearEquipmentId = 'wood-sword';
    });
    const start = fight(rules, state);
    const view = rules.getGameView(start).regions[0].enemies[0].drops;
    expect(view.map((drop) => drop.effectiveChance)).toEqual(['0.35', '0.5', '1', '1', '0']);
    expect(view.map((drop) => drop.luckEligible)).toEqual([true, false, true, false, false]);
    const oracle = { rng: start.rng };
    random(oracle); random(oracle);
    const expected = c.enemies[0].drops.map((drop, i) => dec(random(oracle)).lt(view[i].effectiveChance) ? drop.quantity : '0');
    const end = rules.advanceGame(start, 2000);
    c.enemies[0].drops.forEach((drop, i) => {
      expect(dec(end.inventory[drop.itemId] ?? '0').minus(start.inventory[drop.itemId] ?? '0').toFixed()).toBe(expected[i]);
    });
    expect(end.equipment).toHaveLength(1);
    expect(end.stones).toBe(dec(start.stones).plus(c.enemies[0].stones).toFixed());
    expect(effectiveDrop(c, state, { chance: 0.5 }).effectiveChance).toBe('0.75');
    expect(effectiveDrop(c, state, { chance: 0.2, itemId: 'herb', luckExcludedReason: 'Special' }).effectiveChance).toBe('0.25');
    expect(effectiveDrop(c, state, { chance: 0, itemId: 'herb' }).effectiveChance).toBe('0');
  });

  it('rounds discounted unit prices before multiplying and never sells below the repurchase price', () => {
    const { c, rules, state } = active([
      { kind: 'purchase-discount', itemIds: ['healing-pill'], value: '0.25' },
    ], (c) => {
      Object.assign(c.items.find((item) => item.id === 'healing-pill')!, { buyPrice: '11', sellPrice: '2' });
    });
    expect(rules.getGameView(state).inventory.find((item) => item.id === 'healing-pill')!.buyPrice).toBe('9');
    const bought = rules.applyCommand(state, { type: 'buy', itemId: 'healing-pill', quantity: 3 });
    expect(dec(state.stones).minus(bought.stones).toFixed()).toBe('27');
    expect(rules.getGameView(state).inventory.find((item) => item.id === 'herb')!.buyPrice)
      .toBe(c.items.find((item) => item.id === 'herb')!.buyPrice);
    const floor = active([{ kind: 'purchase-discount', itemIds: ['healing-pill'], value: '1' }]);
    const price = floor.rules.getGameView(floor.state).inventory.find((item) => item.id === 'healing-pill')!;
    expect(dec(price.buyPrice!).gte(price.sellPrice!)).toBe(true);
    expect(dec(price.buyPrice!).gte(1)).toBe(true);
  });

  it('boosts only ordinary battle cultivation and actual action XP, and matches online to offline', () => {
    const { c, rules, state } = active([
      { kind: 'experience', target: 'combat-cultivation', value: '0.5' },
      { kind: 'experience', target: 'body', value: '0.5' },
      { kind: 'experience', target: 'spell', value: '0.5' },
      { kind: 'experience', target: 'technique', value: '0.5' },
    ], (c) => {
      delete c.regions[0].firstClearEquipmentId;
      c.regions[0].clear = { waves: 1, reward: { stones: '1', cultivation: '2' },
        firstBonus: { stones: '1', cultivation: '4' } };
    });
    const start = fight(rules, state);
    const kill = rules.advanceGame(start, 2000);
    expect(kill.cultivation).toBe('10');
    expect(kill.proficiencyXp.body).toBe(dec(c.proficiencyRules.combatXpPerAction)
      .mul(c.proficiencyRules.realmXpMultipliers[c.enemies[0].level]).mul('1.5').toFixed());
    expect(kill.proficiencyXp.spell).toBe('0');
    expect(kill.techniqueXp[c.settings.starterTechniqueId]).toBe(dec(c.settings.combatPracticePerAction).mul('1.5').toFixed());
    const bulk = rules.advanceGame(start, 20000);
    let steps = start;
    for (let ms = 1000; ms <= 20000; ms += 1000) steps = rules.advanceGame(steps, ms);
    expect(bulk).toEqual(steps);
  });
});
