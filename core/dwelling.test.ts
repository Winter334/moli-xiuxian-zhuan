import { describe, expect, it } from 'vitest';
import { createRules } from './game';
import { content, loadContent } from './content';
import { balanceCandidate } from './balance-candidate';
import { candidateRules as rules, catchUpWith, dwellingFoundation } from './dwelling-scenarios';
import { dec } from './numbers';
import type { GameCommand } from './types';
import { gameCommandSchema } from '../server/validation';

// Funded states below are unit fixtures, not evidence for a self-sufficient route.
function funded() {
  const state = rules.createGame(0, 42);
  state.stones = '1000000000000000000000000000000';
  for (const item of balanceCandidate.items) state.inventory[item.id] = '100000';
  return state;
}
function upgraded(tier = 2, gathering = 3, study = 3) {
  const state = funded();
  state.dwelling = { tier, gathering, study };
  return state;
}

describe('candidate isolation and dwelling validation', () => {
  it('keeps dwelling state opt-in and rejects cross-profile saves', () => {
    const legacy = createRules();
    expect(legacy.createGame(0).dwelling).toBeUndefined();
    expect(legacy.getGameView(legacy.createGame(0)).dwelling).toBeUndefined();
    expect(() => legacy.applyCommand(legacy.createGame(0), { type: 'upgrade-dwelling', track: 'study' })).toThrow(/未开放/);
    expect(() => rules.advanceGame(legacy.createGame(0), 1000)).toThrow(/版本/);
    expect(() => legacy.advanceGame(rules.createGame(0), 1000)).toThrow(/版本/);
  });
  it('does not silently initialize missing dwelling state', () => {
    const state = rules.createGame(0);
    delete state.dwelling;
    expect(() => rules.advanceGame(state, 1000)).toThrow(/显式迁移/);
    expect(() => rules.getGameView(state)).toThrow(/显式迁移/);
  });
  it('validates costs, references, additive progression and noncircular prerequisites', () => {
    const mutations = [
      (c: typeof balanceCandidate) => { Object.assign(c, { schemaVersion: 1 }); },
      (c: typeof balanceCandidate) => { c.dwelling!.tiers[0].stones = '1'; },
      (c: typeof balanceCandidate) => { c.dwelling!.tiers[1].requiredGathering = 2; },
      (c: typeof balanceCandidate) => { c.dwelling!.tiers[2].id = c.dwelling!.tiers[1].id; },
      (c: typeof balanceCandidate) => { c.dwelling!.gathering[0].costs[0].itemId = 'missing'; },
      (c: typeof balanceCandidate) => { c.dwelling!.gathering[0].costs[0].itemId = 'foundation-pill'; },
      (c: typeof balanceCandidate) => { c.dwelling!.study[0].costs.push(c.dwelling!.study[0].costs[0]); },
      (c: typeof balanceCandidate) => { c.dwelling!.study[1].requiredTier = 99; },
      (c: typeof balanceCandidate) => { c.dwelling!.study[1].bonus = '0.1'; },
      (c: typeof balanceCandidate) => { c.dwelling!.tiers[2].meditationBonus = '0'; },
      (c: typeof balanceCandidate) => { c.items.find((item) => item.id === 'warm-jade')!.buyPrice = undefined;
        c.enemies.forEach((enemy) => { enemy.drops = enemy.drops.filter((drop) => drop.itemId !== 'warm-jade'); }); },
    ];
    for (const mutate of mutations) {
      const c = structuredClone(balanceCandidate);
      mutate(c);
      expect(() => loadContent(c)).toThrow();
    }
  });
  it('accepts only the typed upgrade tracks at the API boundary and core', () => {
    expect(gameCommandSchema.parse({ type: 'upgrade-dwelling', track: 'study' })).toEqual({ type: 'upgrade-dwelling', track: 'study' });
    expect(() => gameCommandSchema.parse({ type: 'upgrade-dwelling', track: 'all' })).toThrow();
    expect(() => rules.applyCommand(funded(), { type: 'upgrade-dwelling', track: 'all' } as unknown as GameCommand)).toThrow(/未知/);
  });
  it('rejects invalid levels instead of silently granting benefits', () => {
    for (const home of [{ tier: 1, gathering: 0, study: 0 }, { tier: 0, gathering: 2, study: 0 }, { tier: 3, gathering: 3, study: 3 }, { tier: 0, gathering: -1, study: 0 }]) {
      const state = funded();
      state.dwelling = home;
      expect(() => rules.advanceGame(state, 1000)).toThrow(/洞府/);
    }
  });
});

describe('real inventory upgrades and activity-specific benefits', () => {
  it('provides the initial home and zero-cost basic meditation/practice', () => {
    const state = rules.createGame(0);
    expect(state.dwelling).toEqual({ tier: 0, gathering: 0, study: 0 });
    expect(rules.getActivityRates(state)).toEqual({
      meditationBonus: '0', practiceBonus: '0', meditationPerSecond: '0.8', practicePerSecond: '0.8',
    });
    expect(rules.advanceGame(rules.applyCommand(state, { type: 'activity', kind: 'meditate' }), 1000).cultivation).toBe('0.8');
  });
  it('charges once, preserves input and carries every facility through migration', () => {
    let state = funded();
    expect(() => rules.applyCommand(state, { type: 'upgrade-dwelling', track: 'tier' })).toThrow(/初设/);
    for (const track of ['gathering', 'study'] as const) state = rules.applyCommand(state, { type: 'upgrade-dwelling', track });
    const before = structuredClone(state);
    state = rules.applyCommand(state, { type: 'upgrade-dwelling', track: 'tier' });
    expect(state.dwelling).toEqual({ tier: 1, gathering: 1, study: 1 });
    expect(BigInt(before.stones) - BigInt(state.stones)).toBe(180n);
    expect(BigInt(before.inventory.copper) - BigInt(state.inventory.copper)).toBe(15n);
    expect(before.dwelling).toEqual({ tier: 0, gathering: 1, study: 1 });
    expect(state.clockMs).toBe(before.clockMs);
    expect(state.rng).toBe(before.rng);
    expect(rules.getActivityRates(state).meditationBonus).toBe('0.25');
    expect(rules.getActivityRates(state).practiceBonus).toBe('0.3');
    state = rules.applyCommand(state, { type: 'upgrade-dwelling', track: 'tier' });
    expect(state.dwelling).toEqual({ tier: 2, gathering: 1, study: 1 });
    expect(() => rules.applyCommand(state, { type: 'upgrade-dwelling', track: 'tier' })).toThrow(/最高/);
  });
  it('fails atomically on missing cash, missing materials, tier gates and combat', () => {
    const missing = funded();
    missing.inventory.hide = '11';
    const before = structuredClone(missing);
    expect(() => rules.applyCommand(missing, { type: 'upgrade-dwelling', track: 'study' })).toThrow(/数量不足/);
    expect(missing).toEqual(before);
    const poor = funded();
    poor.stones = '44';
    expect(() => rules.applyCommand(poor, { type: 'upgrade-dwelling', track: 'study' })).toThrow(/灵石/);
    const gated = rules.applyCommand(funded(), { type: 'upgrade-dwelling', track: 'gathering' });
    expect(() => rules.applyCommand(gated, { type: 'upgrade-dwelling', track: 'gathering' })).toThrow(/品阶/);
    const fighting = rules.applyCommand(funded(), { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    expect(() => rules.applyCommand(fighting, { type: 'upgrade-dwelling', track: 'study' })).toThrow(/脱战/);
  });
  it('adds environment and facility once, without multiplying their bonuses', () => {
    const state = upgraded();
    expect(rules.getActivityRates(state)).toEqual({
      meditationBonus: '0.8', practiceBonus: '1', meditationPerSecond: '1.44', practicePerSecond: '1.6',
    });
    expect(rules.getGameView(state).dwelling?.name).toBe('灵泉洞府');
  });
  it('changes only future seconds, retaining the current main activity', () => {
    let state = rules.applyCommand(funded(), { type: 'activity', kind: 'meditate' });
    state = rules.advanceGame(state, 10_000);
    expect(state.cultivation).toBe('8');
    state = rules.applyCommand(state, { type: 'upgrade-dwelling', track: 'gathering' });
    expect(state.cultivation).toBe('8');
    expect(state.activity.kind).toBe('meditate');
    expect(rules.advanceGame(state, 11_000).cultivation).toBe('8.92');
  });
  it('specializes only the selected technique and retains independent study/gathering effects', () => {
    const state = rules.applyCommand(upgraded(), { type: 'activity', kind: 'practice', targetId: 'breathing' });
    const after = catchUpWith(rules, state, 2_000_000);
    expect(after.techniqueXp.breathing).toBe('1800');
    expect(after.techniqueXp.flame).toBe('0');
    expect(after.cultivation).toBe('0');
    expect(after.activity.stoppedAt).toBe(1_125_000);
    const gatheringOnly = funded();
    gatheringOnly.dwelling = { tier: 0, gathering: 1, study: 0 };
    expect(rules.getActivityRates(gatheringOnly).practicePerSecond).toBe('0.8');
    const studyOnly = funded();
    studyOnly.dwelling = { tier: 0, gathering: 0, study: 1 };
    expect(rules.getActivityRates(studyOnly).meditationPerSecond).toBe('0.8');
  });
  it('does not modify combat, action practice, drops, regeneration or RNG', () => {
    const low = funded();
    low.level = 6;
    const high = structuredClone(low);
    high.dwelling = { tier: 2, gathering: 3, study: 3 };
    const command = { type: 'activity', kind: 'dungeon', targetId: 'foothill' } as const;
    const a = catchUpWith(rules, rules.applyCommand(low, command), 360_000);
    const b = catchUpWith(rules, rules.applyCommand(high, command), 360_000);
    expect({ ...a, dwelling: undefined }).toEqual({ ...b, dwelling: undefined });
  });
});

describe('deterministic limits and candidate resource checks', () => {
  it('preserves exact state across millisecond partitions, budgets and JSON restoration', () => {
    const start = rules.applyCommand(upgraded(), { type: 'activity', kind: 'meditate' });
    const whole = catchUpWith(rules, start, 1_001_999);
    let split = start;
    for (const at of [199, 3179, 67_222, 128_999, 667_123, 1_001_999]) {
      split = catchUpWith(rules, JSON.parse(JSON.stringify(split)), at, 7);
    }
    expect(split).toEqual(whole);
  });
  it('still saturates at the same finite reserve and carries it through breakthrough', () => {
    const start = upgraded();
    start.level = 12;
    start.cultivation = '17000';
    start.reserve = '29999.9';
    start.inventory['foundation-pill'] = '1';
    const active = rules.applyCommand(start, { type: 'activity', kind: 'meditate' });
    const state = catchUpWith(rules, active, 7 * 86_400_000);
    expect(state.reserve).toBe('30000');
    expect(state.activity.stoppedAt).toBe(1000);
    expect(state.totals.cultivationGained).toBe('0.1');
    const after = rules.applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
    expect(after.cultivation).toBe('30000');
    expect(after.dwelling).toEqual(start.dwelling);
  });
  it('allows breakthrough with no investment or full reserve requirement', () => {
    const state = funded();
    state.level = 12;
    state.cultivation = '17000';
    state.reserve = '123.4';
    const after = rules.applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
    expect(after.cultivation).toBe('123.4');
    expect(after.dwelling).toEqual({ tier: 0, gathering: 0, study: 0 });
  });
  it('stops defeat, consumes only finite supplies and never resumes after recovery', () => {
    const state = rules.createGame(0, 1);
    let active = rules.applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 0.5 });
    active = rules.applyCommand(active, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    const day = catchUpWith(rules, active, 86_400_000);
    const week = catchUpWith(rules, day, 7 * 86_400_000);
    expect(day.activity.stopReason).toContain('战败');
    expect(day.inventory['healing-pill']).toBe('0');
    expect(day.totals.pillsUsed).toBe('5');
    expect(week.totals).toEqual(day.totals);
    expect(week.inventory).toEqual(day.inventory);
    expect(week.activity).toEqual(day.activity);
  });
  it('keeps candidate batch crafting/growth equivalent to sequential commands', () => {
    const state = funded();
    state.regionKills.bamboo = '5';
    const batch = rules.applyCommand(state, { type: 'craft', recipeId: 'attack', quantity: 80 });
    let sequential = state;
    for (let i = 0; i < 80; i++) sequential = rules.applyCommand(sequential, { type: 'craft', recipeId: 'attack', quantity: 1 });
    expect(batch).toEqual(sequential);
    const consumed = rules.applyCommand(batch, { type: 'consume', itemId: 'attack-pill', quantity: 80 });
    for (let i = 0; i < 80; i++) sequential = rules.applyCommand(sequential, { type: 'consume', itemId: 'attack-pill', quantity: 1 });
    expect(consumed).toEqual(sequential);
  });
  it('bounds every recipe by input resale value and checks actual all-buyable loops', () => {
    for (const recipe of rules.content.recipes) {
      const output = rules.content.items.find((item) => item.id === recipe.outputId)!;
      const liquidationCost = recipe.costs.reduce((total, cost) => total +
        BigInt(rules.content.items.find((item) => item.id === cost.itemId)!.sellPrice ?? '0') * BigInt(cost.quantity), BigInt(recipe.stones));
      expect(BigInt(output.sellPrice ?? '0') * BigInt(recipe.outputQuantity)).toBeLessThanOrEqual(liquidationCost);
      const materials = recipe.costs.map((cost) => ({ ...cost, item: rules.content.items.find((item) => item.id === cost.itemId)! }));
      if (!materials.every((cost) => cost.item.buyPrice)) continue;
      let state = funded();
      state.regionKills.bamboo = '5';
      const before = BigInt(state.stones);
      for (const material of materials) state = rules.applyCommand(state, { type: 'buy', itemId: material.itemId, quantity: Number(material.quantity) });
      state = rules.applyCommand(state, { type: 'craft', recipeId: recipe.id, quantity: 1 });
      state = rules.applyCommand(state, { type: 'sell', itemId: recipe.outputId, quantity: Number(recipe.outputQuantity) });
      expect(BigInt(state.stones)).toBeLessThan(before);
    }
  });
  it('reaches foundation without dwelling or injected assets through the actual core', () => {
    const result = dwellingFoundation('none', 1);
    expect(result.state.level).toBe(13);
    expect(result.state.dwelling).toEqual({ tier: 0, gathering: 0, study: 0 });
    expect(result.ledger.dwellingStones).toBe('0');
    expect(Object.values(result.seconds).reduce((sum, n) => sum + n, 0)).toBe(result.foundationSeconds);
    expect(dec(result.cultivation.meditation).plus(result.cultivation.combat).eq(result.state.totals.cultivationGained)).toBe(true);
  }, 30_000);
});
