import { describe, expect, it } from 'vitest';
import { content, loadContent, type Content } from './content';
import { createRules } from './game';
import { foundationCosts } from './foundation';
import { drawFates } from './fate';
import { proficiencyCap, proficiencyTrainingGain } from './proficiency';
import { dec } from './numbers';
import type { GameState } from './types';
import { gameCommandSchema } from '../server/validation';

type Rules = ReturnType<typeof createRules>;
function enter(rules: Rules, state: GameState) {
  const candidates = [...state.opening!.candidates];
  let next = state;
  for (let slot = 0; slot < state.opening!.selected.length; slot++) {
    next = rules.applyCommand(next, { type: 'fate-select', lifeId: state.lifeId, slot, fateId: candidates[slot] });
  }
  return rules.applyCommand(next, { type: 'enter-life', lifeId: next.lifeId });
}

function fixture(edit: (c: Content) => void = () => {}) {
  const c = structuredClone(content);
  c.openingTiers = [
    { requiredPoints: '0', slots: 1, candidates: 3, draws: 1, designations: 0 },
    { requiredPoints: '10', slots: 2, candidates: 3, draws: 2, designations: 0 },
    { requiredPoints: '30', slots: 2, candidates: 3, draws: 2, designations: 1 },
  ];
  c.fates = ['alpha', 'beta', 'gamma'].map((id) => ({
    id, name: id, rarity: 'common', weight: 1, effects: [{ kind: 'gift-stones', amount: '7' }],
  }));
  c.reincarnation = {
    minimumLevel: 2, retrainingBonus: '0.5',
    realmRewards: [{ level: 2, points: '3' }, { level: 4, points: '7' }, { level: 13, points: '11' }],
    explorationNodes: [
      { id: 'region-node', name: 'Region node', points: '2', target: { kind: 'region', regionId: 'bamboo', wins: '2' } },
      { id: 'challenge-node', name: 'Challenge node', points: '3', target: { kind: 'challenge', challengeId: c.challenges[0].id, wins: '1' } },
    ],
  };
  c.dwelling = {
    tiers: [
      { id: 'base', name: 'Base', meditationBonus: '0', practiceBonus: '0', requiredGathering: 0, stones: '0', costs: [] },
      { id: 'upper', name: 'Upper', meditationBonus: '0.1', practiceBonus: '0.1', requiredGathering: 0, stones: '1', costs: [{ itemId: 'herb', quantity: '1' }] },
    ], gathering: [], study: [],
  };
  c.techniqueAcquisition = 'manuals';
  c.techniques = [c.techniques[0], { ...c.techniques[1], id: 'learned', manualItemId: 'learned-book', unlock: { level: 2 } }];
  c.items.push({ id: 'learned-book', name: 'Book', kind: 'manual', unlock: { level: 2 }, buyPrice: '1' });
  c.techniques[0].effects = [];
  c.techniques[0].practiceBonuses = [];
  c.settings.starterEquipmentId = 'wood-sword';
  c.settings.starterStones = '20';
  c.settings.starterItems = { herb: '20' };
  c.settings.baseMpRegenFraction = '0';
  c.baseStats.mpRegen = '0';
  c.regions[0].enemies = [c.enemies[0].id];
  Object.assign(c.enemies[0], { maxHp: '100000', attack: '0', effects: [], hpRegen: '0' });
  edit(c);
  const rules = createRules(c);
  return { c, rules, state: enter(rules, rules.createGame(0, 1)) };
}

function founded(rules: Rules, state: GameState) {
  const prepared = structuredClone(state);
  prepared.level = 12;
  prepared.cultivation = rules.content.realms[12].required;
  for (const cost of foundationCosts(rules.content, rules.content.foundationMethods.find((m) => m.id === 'heaven')!)) {
    prepared.inventory[cost.itemId] = cost.quantity;
  }
  prepared.rng = 1;
  return rules.applyCommand(prepared, { type: 'breakthrough', lifeId: prepared.lifeId, methodId: 'heaven' });
}
const rebirth = (rules: Rules, state: GameState) =>
  rules.applyCommand(state, { type: 'reincarnate', lifeId: state.lifeId });

describe('reincarnation settlement and next-life boundaries', () => {
  it('requires actual foundation history, minimum current-life progress and an explicit current life', () => {
    const { c, rules, state } = fixture();
    state.level = 12;
    const before = structuredClone(state);
    expect(rules.getGameView(state).reincarnation.reward.total).toBe('0');
    expect(() => rebirth(rules, state)).toThrow(/筑基/);
    expect(state).toEqual(before);
    expect(gameCommandSchema.safeParse({ type: 'reincarnate' }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ type: 'reincarnate', lifeId: '1', reward: '999' }).success).toBe(false);
    const first = founded(rules, state);
    const pending = rebirth(rules, first);
    expect(() => rebirth(rules, pending)).toThrow(/入世/);
    const next = enter(rules, pending);
    next.level = c.reincarnation.minimumLevel - 1;
    next.regionKills.bamboo = '1000';
    const locked = structuredClone(next);
    expect(() => rebirth(rules, next)).toThrow(/达到/);
    expect(next).toEqual(locked);
    next.level++;
    expect(rules.getGameView(next).reincarnation.ready).toBe(true);
    expect(() => rules.applyCommand(next, { type: 'reincarnate', lifeId: '1' })).toThrow(/本世/);
  });

  it('previews without stopping combat, spending RNG, granting points or exposing mutable records', () => {
    const { rules, state } = fixture();
    const first = founded(rules, state);
    const next = enter(rules, rebirth(rules, first));
    next.level = 4;
    const fighting = rules.applyCommand(next, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const before = structuredClone(fighting);
    const view = rules.getGameView(fighting).reincarnation;
    expect(view.ready).toBe(true);
    expect(view.reward.total).toBe('7');
    view.lastSettlement!.explorationNodes.push('mutated');
    view.history.visitedRegions.push('mutated');
    expect(rules.getGameView(fighting).reincarnation.lastSettlement).toEqual(before.history.reincarnation.lastSettlement);
    expect(fighting).toEqual(before);
    const reset = rebirth(rules, fighting);
    expect(reset.battle).toBeNull();
    expect(reset.activity.kind).toBe('idle');
    expect(reset.history.visitedRegions).toContain('bamboo');
  });

  it('resets assets and strength but preserves knowledge, records, preferences and global instance identity', () => {
    const { c, rules, state } = fixture();
    const first = founded(rules, state);
    first.stones = '999';
    first.inventory.herb = '999';
    first.regionKills.bamboo = '2';
    first.challengeWins[c.challenges[0].id] = '1';
    first.learnedTechniques!.push('learned');
    first.techniqueId = 'learned';
    first.techniqueXp.learned = '50';
    first.proficiencyXp.alchemy = '20';
    first.history.proficiencyXp.alchemy = '20';
    first.history.learnedRecipes = ['healing-refinement'];
    first.dwelling!.tier = 1;
    first.reserve = '50';
    first.player.pillAttack = '100';
    first.player.shield = '20';
    first.proficiencyCombat = { swordActions: 2, spellCasts: 2, bodyWardUsed: true };
    first.crafting.healing = { attempts: '2', successes: '1' };
    first.supply = { enabled: true, hpThreshold: 0.7, readyAt: 100000 };
    first.totals.kills = '3';
    const before = structuredClone(first);
    const pending = rebirth(rules, first);
    expect(first).toEqual(before);
    expect(pending.lifeId).toBe('2');
    expect(pending.stones).toBe('0');
    expect(pending.inventory).toEqual({});
    expect(pending.equipment).toEqual([]);
    expect(Object.values(pending.loadout).every((value) => value === null)).toBe(true);
    expect([pending.level, pending.cultivation, pending.reserve]).toEqual([0, '0', '0']);
    expect(pending.foundation).toEqual({ methodId: null, attempts: '0', lastAttempt: null });
    expect(pending.innateFates).toEqual([]);
    expect(Object.values(pending.proficiencyXp).every((xp) => xp === '0')).toBe(true);
    expect(Object.values(pending.techniqueXp).every((xp) => xp === '0')).toBe(true);
    expect(pending.player.pillAttack).toBe('0');
    expect(pending.player.shield).toBe('0');
    expect(pending.dwelling).toEqual({ tier: 0, gathering: 0, study: 0 });
    expect(pending.crafting).toEqual({});
    expect(pending.regionKills).toEqual({});
    expect(pending.challengeWins).toEqual({});
    expect(pending.totals.kills).toBe('0');
    expect(pending.proficiencyCombat).toEqual({ swordActions: 0, spellCasts: 0, bodyWardUsed: false });
    expect(pending.history.proficiencyXp).toEqual(first.history.proficiencyXp);
    expect(pending.history.achievements).toEqual(first.history.achievements);
    expect(pending.history.learnedRecipes).toEqual(first.history.learnedRecipes);
    expect(pending.history.highestLevel).toBe(13);
    expect(pending.history.highestDwellingTier).toBe(1);
    expect(pending.learnedTechniques).toEqual(first.learnedTechniques);
    expect(pending.techniqueId).toBe(c.settings.starterTechniqueId);
    expect(pending.supply).toEqual({ enabled: true, hpThreshold: 0.7, readyAt: 0 });
    expect(pending.nextInstance).toBe(first.nextInstance);
    expect(pending.opening!.selected).toHaveLength(2);
    const delayed = rules.advanceGame(pending, 100000, 1);
    expect(delayed).toEqual({ ...pending, clockMs: 100000 });
    const active = enter(rules, delayed);
    expect(active.stones).toBe('34');
    expect(active.inventory).toEqual(c.settings.starterItems);
    expect(active.equipment[0].instanceId).not.toBe(first.equipment[0].instanceId);
    expect(active.player.hp).toBe(rules.getPlayerStats(active).maxHp);
    expect(active.supply.readyAt).toBe(100000);
    expect(() => rules.applyCommand(active, { type: 'enter-life', lifeId: active.lifeId })).toThrow();
    expect(() => rules.applyCommand(active, { type: 'technique', techniqueId: 'learned' })).toThrow(/开放/);
    expect(() => rules.applyCommand(active, { type: 'craft', recipeId: 'healing-refinement', quantity: 1 })).toThrow(/本世丹道/);
    expect(() => rules.applyCommand(active, { type: 'equip', slot: 'weapon', instanceId: first.equipment[0].instanceId })).toThrow(/未持有/);
  });

  it('awards each node once per life, not per kill or historical record, and unlocks designation from accumulated points', () => {
    const { c, rules, state } = fixture();
    const first = founded(rules, state);
    first.regionKills.bamboo = '2';
    first.challengeWins[c.challenges[0].id] = '1';
    const before = rules.getGameView(first).reincarnation;
    first.regionKills.bamboo = '10000';
    first.challengeWins[c.challenges[0].id] = '10000';
    expect(rules.getGameView(first).reincarnation.reward).toEqual(before.reward);
    const pending = rebirth(rules, first);
    expect(pending.history.reincarnation.points).toBe('16');
    let next = enter(rules, pending);
    next.level = 4;
    expect(rules.getGameView(next).reincarnation.reward.total).toBe('7');
    next.regionKills.bamboo = '2';
    next.challengeWins[c.challenges[0].id] = '1';
    next = enter(rules, rebirth(rules, next));
    expect(next.history.reincarnation.points).toBe('28');
    next.level = 2;
    const third = rebirth(rules, next);
    expect(third.history.reincarnation.points).toBe('31');
    expect(third.history.reincarnation.count).toBe('3');
    expect(third.history.openingTier).toBe(2);
    expect(third.opening!.designationsUsed).toBe(0);
    const selected = rules.applyCommand(third, {
      type: 'fate-designate', lifeId: third.lifeId, slot: 0, fateId: first.innateFates[0],
    });
    expect(selected.opening!.designationsUsed).toBe(1);
    expect(() => rules.applyCommand(selected, { type: 'reincarnate', lifeId: '3' })).toThrow();
  });

  it('continues RNG exactly once into the new opening and rejects absent or inconsistent lifecycle records', () => {
    const { c, rules, state } = fixture();
    const first = founded(rules, state);
    const pending = rebirth(rules, first);
    const oracle = structuredClone(pending);
    oracle.rng = first.rng;
    oracle.opening!.drawsUsed = 0;
    oracle.opening!.candidates = [];
    drawFates(c, oracle);
    expect(oracle).toEqual(pending);
    expect(rules.getGameView(JSON.parse(JSON.stringify(pending)))).toEqual(rules.getGameView(pending));
    for (const edit of [
      (s: GameState) => { Reflect.deleteProperty(s.history, 'reincarnation'); },
      (s: GameState) => { s.history.reincarnation.count = '99'; },
      (s: GameState) => { s.history.openingTier = 0; },
    ]) {
      const broken = structuredClone(pending);
      edit(broken);
      expect(() => rules.getGameView(broken)).toThrow();
    }
    const invalid = structuredClone(c);
    invalid.openingTiers[1].requiredPoints = '0';
    expect(() => loadContent(invalid)).toThrow(/门槛/);
  });
});

describe('bounded same-proficiency retraining', () => {
  it('adds efficiency, splits an action at the old record and caps real XP without granting it for free', () => {
    const { c } = fixture();
    expect(proficiencyTrainingGain(c, 'alchemy', '8', '20', '10', '0.5')).toBe('18');
    expect(proficiencyTrainingGain(c, 'alchemy', '20', '20', '10', '0.5')).toBe('15');
    expect(proficiencyTrainingGain(c, 'alchemy', '0', '100', '0', '0.5')).toBe('0');
    const first = proficiencyTrainingGain(c, 'alchemy', '8', '20', '5', '0.5');
    const second = proficiencyTrainingGain(c, 'alchemy', dec(8).plus(first).toFixed(), '20', '5', '0.5');
    expect(dec(first).plus(second).toFixed()).toBe('18');
    const cap = proficiencyCap(c.proficiencies.find((p) => p.id === 'alchemy')!);
    expect(proficiencyTrainingGain(c, 'alchemy', dec(cap).minus(1).toFixed(), cap, '10', '0.5')).toBe('1');
  });

  it.each([1, 123456789])('uses the same bounded gain for crafting previews, success/failure and batches: %s', (seed) => {
    const { c, rules, state } = fixture((c) => {
      c.fates.forEach((fate) => { fate.effects = [{ kind: 'experience', target: 'alchemy', value: '0.5' }]; });
      c.proficiencyRules.successBase = '0.5';
      c.proficiencyRules.minimumSuccess = '0.1';
      const recipe = c.recipes.find((recipe) => recipe.id === 'healing')!;
      recipe.training = { difficulty: 2, xp: '10' };
      recipe.extraOutputEligible = false;
    });
    state.proficiencyXp.alchemy = '8';
    state.history.proficiencyXp.alchemy = '20';
    state.rng = seed;
    const preview = rules.getGameView(state).recipes.find((recipe) => recipe.id === 'healing')!.production;
    expect(preview.successXp).toBe('18');
    expect(preview.failureXp).toBe(preview.successXp);
    const command = { type: 'craft' as const, recipeId: 'healing', quantity: 1 };
    const first = rules.applyCommand(state, command);
    expect(first.crafting.healing.successes).toBe(seed === 1 ? '1' : '0');
    expect(first.proficiencyXp.alchemy).toBe('26');
    expect(first.history.proficiencyXp.alchemy).toBe('26');
    const single = rules.applyCommand(first, command);
    const bulk = rules.applyCommand(state, { ...command, quantity: 2 });
    expect(bulk).toEqual(single);
    expect(bulk.proficiencyXp.alchemy).toBe('41');
    expect(bulk.proficiencyXp.forging).toBe('0');
    expect(bulk.inventory.herb).toBe((BigInt(c.settings.starterItems.herb) - 4n).toString());
  });

  it('keeps actual combat training identical across online/offline chunks and stops accelerating at the old record', () => {
    const { rules, state } = fixture();
    const unarmed = rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: null });
    unarmed.history.proficiencyXp.body = '3';
    const fighting = rules.applyCommand(unarmed, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const bulk = rules.advanceGame(fighting, 10000);
    let single = fighting;
    for (let ms = 1000; ms <= 10000; ms += 1000) single = rules.advanceGame(single, ms);
    expect(bulk).toEqual(single);
    expect(bulk.proficiencyXp.body).toBe('6');
    expect(bulk.history.proficiencyXp.body).toBe('6');
    expect(rules.getGameView(bulk).proficiencies.find((p) => p.id === 'body')!.retraining.bonus).toBe('0');
  });
});
