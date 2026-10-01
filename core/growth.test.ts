import { describe, expect, it } from 'vitest';
import { loadContent, type Content } from './content';
import { createRules } from './game';
import { equipmentCandidate } from './equipment-candidate';
import { growthCandidate, growthProfile } from './growth-candidate';
import { growthFoundation } from './growth-scenarios';
import { dec } from './numbers';
import { strikeDamage } from './combat';

const rules = createRules(growthCandidate);
// Resource injection is confined to unit fixtures, never the public-command scenarios.
function funded() {
  const state = rules.createGame(0, 42);
  state.stones = '1000000';
  for (const item of rules.content.items) state.inventory[item.id] = '10000';
  for (const region of rules.content.regions) state.regionKills[region.id] = '20';
  return state;
}

describe('tiered permanent growth configuration and isolation', () => {
  it('provides three distinct tiers per attribute, with recipes and monster sources', () => {
    const pills = growthCandidate.items.filter((item) => item.kind === 'growth');
    expect(pills).toHaveLength(9);
    expect(growthCandidate.growthPillTiers?.map((tier) => tier.name)).toEqual(['初阶', '中阶', '高阶']);
    for (const pill of pills) {
      expect(growthCandidate.recipes.some((recipe) => recipe.outputId === pill.id && !recipe.outputKind)).toBe(true);
      expect(growthCandidate.enemies.some((enemy) => enemy.drops.some((drop) =>
        drop.itemId === pill.id && drop.chance > 0 && drop.chance < 1))).toBe(true);
    }
    expect(growthCandidate.enemies.flatMap((enemy) => enemy.equipmentDrops)).toEqual([]);
    expect(growthCandidate.enemies.flatMap((enemy) => enemy.drops).some((drop) => drop.itemId === 'foundation-pill')).toBe(false);
  });
  it('rejects missing, repeated or non-increasing tiers, missing recipes and split absorption scales', () => {
    const mutations = [
      (c: Content) => { Object.assign(c, { schemaVersion: 3 }); },
      (c: Content) => { delete c.growthPillTiers; },
      (c: Content) => { c.growthPillTiers![1].id = 'early'; },
      (c: Content) => { c.items = c.items.filter((item) => item.id !== 'defense-pill'); },
      (c: Content) => { c.recipes = c.recipes.filter((recipe) => recipe.id !== 'defense'); },
      ...['stat', 'tierId', 'amount', 'scale'].map((key) => (c: Content) => {
        const use = c.items.find((item) => item.id === 'attack-pill-middle')!.use!;
        if (use.kind !== 'growth') throw new Error('fixture');
        if (key === 'stat') Reflect.deleteProperty(use, 'stat');
        if (key === 'tierId') use.tierId = 'early';
        if (key === 'amount') use.amount = '1';
        if (key === 'scale') use.scale = '999';
      }),
    ];
    for (const mutate of mutations) {
      const c = structuredClone(growthCandidate);
      mutate(c);
      expect(() => loadContent(c)).toThrow();
    }
  });
  it('never invents new saved bonuses or silently migrates B2', () => {
    const old = createRules(equipmentCandidate);
    const fresh = rules.createGame(0);
    expect(old.createGame(0).player.pillDefense).toBeUndefined();
    expect(() => rules.getGameView(old.createGame(0))).toThrow(/版本/);
    expect(() => old.advanceGame(fresh, 1000)).toThrow(/版本/);
    for (const value of [undefined, '-1', 'NaN', 0]) {
      const bad = structuredClone(fresh);
      Object.assign(bad.player, { pillDefense: value });
      expect(() => rules.getGameView(bad)).toThrow(/累计状态/);
    }
    const masquerading = old.createGame(0);
    masquerading.player.pillMaxHp = '10';
    expect(() => old.getGameView(masquerading)).toThrow(/旧版/);
  });
});

describe('actual permanent attribute application', () => {
  it.each([
    ['attack-pill', 'pillAttack', 'attack', '1'],
    ['defense-pill', 'pillDefense', 'defense', '0.2'],
    ['vitality-pill', 'pillMaxHp', 'maxHp', '5'],
  ] as const)('%s consumes real stock and affects %s in the shared stats', (itemId, field, stat, amount) => {
    const start = funded();
    const base = rules.getPlayerStats(start);
    const after = rules.applyCommand(start, { type: 'consume', itemId, quantity: 1 });
    expect(after.player[field]).toBe(amount);
    expect(rules.getPlayerStats(after)[stat]).toBe(dec(base[stat]).plus(amount).toFixed());
    expect(after.inventory[itemId]).toBe('9999');
    expect(after.totals.pillsUsed).toBe('1');
    expect(after.player.hp).toBe(start.player.hp);
    expect(after.clockMs).toBe(start.clockMs);
    expect(after.rng).toBe(start.rng);
    expect(start.player[field]).toBe('0');
  });
  it('uses grown attack/defense in damage and does not turn defense into magic immunity', () => {
    const before = rules.getPlayerStats(funded());
    let after = rules.applyCommand(funded(), { type: 'consume', itemId: 'attack-pill-late', quantity: 2 });
    after = rules.applyCommand(after, { type: 'consume', itemId: 'defense-pill-late', quantity: 2 });
    const stats = rules.getPlayerStats(after);
    expect(dec(strikeDamage(stats.attack, '0', '1', false, '1.5')).gt(before.attack)).toBe(true);
    expect(dec(strikeDamage('20', stats.defense, '1', false, '1.5')).lt(
      strikeDamage('20', before.defense, '1', false, '1.5'))).toBe(true);
    expect(strikeDamage('20', stats.magicDefense, '1', false, '1.5')).toBe(
      strikeDamage('20', before.magicDefense, '1', false, '1.5'));
  });
  it('shares accumulated absorption across tiers, but not across different attributes', () => {
    let state = rules.applyCommand(funded(), { type: 'consume', itemId: 'attack-pill', quantity: 100 });
    const prior = state.player.pillAttack;
    const view = rules.getGameView(state);
    const next = view.inventory.find((item) => item.id === 'attack-pill-late')!.growth!;
    expect(next.cumulative).toBe(prior);
    expect(dec(next.nextGain).lt(next.baseGain)).toBe(true);
    expect(next.tier).toEqual({ id: 'late', name: '高阶' });
    expect(view.inventory.find((item) => item.id === 'defense-pill-late')!.growth!.nextGain).toBe('1.6');
    state = rules.applyCommand(state, { type: 'consume', itemId: 'attack-pill-late', quantity: 1 });
    expect(state.player.pillAttack).toBe(dec(prior).plus(next.nextGain).toFixed());
    expect(state.player.pillDefense).toBe('0');
  });
  it.each(['attack-pill', 'defense-pill', 'vitality-pill'])('keeps exact sequential/batch/save-load identity beyond the %s soft threshold', (itemId) => {
    const start = funded();
    const batch = rules.applyCommand(start, { type: 'consume', itemId, quantity: 200 });
    let single = start;
    for (let i = 0; i < 200; i++) {
      single = rules.applyCommand(JSON.parse(JSON.stringify(single)), { type: 'consume', itemId, quantity: 1 });
    }
    expect(single).toEqual(batch);
    expect(() => rules.getGameView(batch)).not.toThrow();
  });
  it('preserves bonuses across realm gain and first foundation without refilling current HP', () => {
    let state = rules.applyCommand(funded(), { type: 'consume', itemId: 'vitality-pill-late', quantity: 2 });
    state = rules.applyCommand(state, { type: 'consume', itemId: 'attack-pill', quantity: 2 });
    state = rules.applyCommand(state, { type: 'consume', itemId: 'defense-pill', quantity: 2 });
    state = rules.applyCommand(state, { type: 'activity', kind: 'meditate' });
    state = rules.advanceGame(state, 100_000);
    expect(state.level).toBeGreaterThan(0);
    expect(state.player).toMatchObject({ pillMaxHp: '80', pillAttack: '2', pillDefense: '0.4' });
    state.level = 12;
    state.cultivation = rules.content.realms[12].required;
    state.player.hp = '37';
    state = rules.applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
    expect(state.player).toMatchObject({ hp: '37', pillMaxHp: '80', pillAttack: '2', pillDefense: '0.4' });
    expect(rules.getPlayerStats(state).maxHp).toBe('1280');
  });
  it('rejects insufficient stock and combat use atomically', () => {
    const start = funded();
    start.inventory['defense-pill'] = '1';
    const copy = structuredClone(start);
    expect(() => rules.applyCommand(start, { type: 'consume', itemId: 'defense-pill', quantity: 2 })).toThrow(/数量不足/);
    expect(start).toEqual(copy);
    const fighting = rules.applyCommand(start, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    expect(() => rules.applyCommand(fighting, { type: 'consume', itemId: 'defense-pill', quantity: 1 })).toThrow(/脱战/);
    expect(fighting.inventory['defense-pill']).toBe('1');
  });
  it('pays actual crafting costs and rejects a missing ingredient without partial charges', () => {
    const start = funded();
    const recipe = rules.content.recipes.find((entry) => entry.id === 'defense-late')!;
    const after = rules.applyCommand(start, { type: 'craft', recipeId: recipe.id, quantity: 2 });
    expect(BigInt(start.stones) - BigInt(after.stones)).toBe(90n);
    for (const cost of recipe.costs) expect(BigInt(start.inventory[cost.itemId]) - BigInt(after.inventory[cost.itemId])).toBe(BigInt(cost.quantity) * 2n);
    start.inventory['dense-ore'] = '0';
    const copy = structuredClone(start);
    expect(() => rules.applyCommand(start, { type: 'craft', recipeId: recipe.id, quantity: 2 })).toThrow(/数量不足/);
    expect(start).toEqual(copy);
  });
});

describe('monster drops are inventory, not free automatic growth', () => {
  it('preserves identical online/offline results including actual probabilistic pill drops', () => {
    let start = funded();
    start.level = 9;
    start.inventory['attack-pill'] = '0';
    start.inventory['vitality-pill'] = '0';
    start = rules.applyCommand(start, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    const whole = rules.advanceGame(start, 3_600_000);
    let split = start;
    while (split.clockMs < 3_600_000) split = rules.advanceGame(JSON.parse(JSON.stringify(split)), 3_600_000, 17);
    expect(split).toEqual(whole);
    expect(BigInt(whole.inventory['attack-pill']) + BigInt(whole.inventory['vitality-pill'])).toBeGreaterThan(0n);
    expect(whole.player.pillAttack).toBe('0');
    expect(whole.player.pillMaxHp).toBe('0');
    expect(whole.totals.pillsUsed).toBe('0');
  });
  it('allows an early drop to be consumed without inventing a realm lock or recipe ownership', () => {
    const c = structuredClone(growthCandidate);
    c.regions[0].enemies = ['hill-wolf'];
    c.enemies[0].drops.find((drop) => drop.itemId === 'attack-pill')!.chance = 1;
    const forced = createRules(c);
    let state = forced.createGame(0, 1);
    state = forced.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    while (!state.regionKills.foothill) state = forced.advanceGame(state, state.clockMs + 1000);
    state = forced.applyCommand(state, { type: 'activity', kind: 'idle' });
    expect(state.inventory['attack-pill']).toBe('1');
    expect(state.player.pillAttack).toBe('0');
    expect(() => forced.applyCommand(state, { type: 'craft', recipeId: 'attack', quantity: 1 })).toThrow(/开放/);
    state = forced.applyCommand(state, { type: 'consume', itemId: 'attack-pill', quantity: 1 });
    expect(state.player.pillAttack).toBe('1');
  });
  it('keeps a versioned zero-drop lower-bound profile without touching recipes or the normal profile', () => {
    const zero = growthProfile(true);
    const ids = new Set(zero.items.filter((item) => item.kind === 'growth').map((item) => item.id));
    expect(zero.enemies.flatMap((enemy) => enemy.drops).filter((drop) => ids.has(drop.itemId)).every((drop) => drop.chance === 0)).toBe(true);
    expect(zero.recipes).toEqual(growthCandidate.recipes);
    expect(zero.version).not.toBe(growthProfile().version);
    expect(growthCandidate.enemies[0].drops.at(-1)!.chance).toBe(0.01);
  });
});

describe('public-command growth self-sufficiency', () => {
  it('records real costs, materials and cumulative bonuses even with no pill drops', () => {
    const result = growthFoundation('sword', 'modest', 1, true);
    expect(result.state.level).toBe(13);
    expect(result.state.player).toMatchObject({ pillAttack: '24', pillDefense: '4.8', pillMaxHp: '120' });
    expect(result.ledger.growthDropped).toEqual({});
    expect(Object.values(result.ledger.growthCrafted)).toEqual(Array(9).fill('2'));
    expect(result.ledger.growthCrafted).toEqual(result.ledger.growthConsumed);
    expect(result.ledger.growthCraftStones).toBe('360');
    expect(result.growthCheckpoints).toHaveLength(3);
    expect(result.state.dwelling).toEqual({ tier: 0, gathering: 0, study: 0 });
  }, 30_000);
});
