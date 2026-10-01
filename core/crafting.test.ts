import { describe, expect, it } from 'vitest';
import { createRules } from './game';
import { content, loadContent, type Content } from './content';
import { balanceCandidate } from './balance-candidate';
import { craftingCandidate } from './crafting-candidate';
import { craftingOpening, craftingRules as rules } from './crafting-scenarios';
import type { GameState } from './types';

// Funded/controlled encounters are unit fixtures, not self-sufficiency evidence.
function funded() {
  const state = rules.createGame(0, 42);
  state.stones = '1000000';
  for (const item of craftingCandidate.items) state.inventory[item.id] = '10000';
  state.regionKills.quarry = '1';
  state.regionKills.ruins = '1';
  return state;
}
function arena(edit: (c: Content) => void = () => {}) {
  const c = structuredClone(craftingCandidate);
  c.regions[0].enemies = ['hill-wolf'];
  c.regions[0].clear = {
    waves: 3, reward: { stones: '7', cultivation: '11' }, firstBonus: { stones: '5', cultivation: '3' },
  };
  const enemy = c.enemies[0];
  Object.assign(enemy, { maxHp: '1', attack: '0', defense: '0', effects: [], drops: [], cultivation: '0', stones: '0' });
  c.baseStats.hpRegen = '0';
  c.baseStats.mpRegen = '0';
  c.settings.baseMpRegenFraction = '0';
  c.techniques[0].effects = [];
  c.techniques[0].actionId = 'strike';
  edit(c);
  const testRules = createRules(c);
  return {
    rules: testRules,
    state: testRules.applyCommand(testRules.createGame(0, 1), { type: 'activity', kind: 'dungeon', targetId: 'foothill' }),
  };
}
function kills(testRules: ReturnType<typeof createRules>, state: GameState, target: bigint, regionId = 'foothill') {
  const deadline = state.clockMs + 120_000;
  while (BigInt(state.regionKills[regionId] ?? '0') < target) {
    if (state.clockMs >= deadline || state.activity.kind !== 'dungeon') throw new Error('Test encounter failed to reach requested kills');
    state = testRules.advanceGame(state, state.clockMs + 1000, 1);
  }
  return state;
}

describe('crafting candidate boundary and configuration', () => {
  it('preserves legacy and A1 profiles and rejects cross-version saves', () => {
    const legacy = createRules();
    const a1 = createRules(balanceCandidate);
    expect(content.version).toBe('stage-1.2.0');
    expect(balanceCandidate.version).toBe('stage-1-dwelling-candidate.1');
    expect(legacy.createGame(0).equipment).toHaveLength(1);
    expect(a1.createGame(0).equipment).toHaveLength(1);
    expect(rules.createGame(0).equipment).toEqual([]);
    expect(rules.createGame(0).loadout.weapon).toBeNull();
    expect(legacy.getGameView(legacy.createGame(0)).regions[0].clear).toBeUndefined();
    for (const other of [legacy, a1]) {
      expect(() => rules.advanceGame(other.createGame(0), 1000)).toThrow(/版本/);
      expect(() => other.getGameView(rules.createGame(0))).toThrow(/版本/);
    }
  });
  it('forbids hidden equipment drops, gifts and missing crafting sources in the chosen route', () => {
    const mutations = [
      (c: Content) => { c.settings.starterEquipmentId = 'wood-sword'; },
      (c: Content) => { c.enemies[0].equipmentDrops.push({ equipmentId: 'wood-sword', chance: 0.01 }); },
      (c: Content) => { c.regions[0].firstClearEquipmentId = 'wood-sword'; },
      (c: Content) => { c.recipes = c.recipes.filter((recipe) => recipe.outputId !== 'wood-sword'); },
    ];
    for (const mutate of mutations) {
      const c = structuredClone(craftingCandidate);
      mutate(c);
      expect(() => loadContent(c)).toThrow();
    }
  });
  it('validates wave counts, reward values, typed outputs and bounded instance generation', () => {
    const mutations = [
      (c: Content) => { c.regions[0].clear!.waves = 0; },
      (c: Content) => { c.regions[0].clear!.waves = 1.5; },
      (c: Content) => { c.regions[0].clear!.waves = 10001; },
      (c: Content) => { c.regions[0].clear!.reward.stones = '-1'; },
      (c: Content) => { c.regions[0].clear!.reward.cultivation = '-0.1'; },
      (c: Content) => { c.recipes[0].outputKind = 'equipment'; },
      (c: Content) => { c.recipes.find((recipe) => recipe.outputKind)!.outputId = 'missing'; },
      (c: Content) => { c.recipes.find((recipe) => recipe.outputKind)!.outputQuantity = '1000000000000'; },
    ];
    for (const mutate of mutations) {
      const c = structuredClone(craftingCandidate);
      mutate(c);
      expect(() => loadContent(c)).toThrow();
    }
  });
  it('rejects malformed cumulative counters instead of granting clears', () => {
    for (const value of ['-1', '1.5', '001', '1e3', 9007199254740992]) {
      const state = rules.createGame(0);
      state.regionKills.foothill = value as string;
      expect(() => rules.getGameView(state)).toThrow(/累计波次/);
      expect(() => rules.advanceGame(state, 1000)).toThrow(/累计波次/);
    }
  });
});

describe('paid equipment generation', () => {
  it('pays all actual costs, creates an instance rather than an item, and does not auto-equip or advance time', () => {
    const start = rules.applyCommand(funded(), { type: 'activity', kind: 'meditate' });
    start.player.hp = '10';
    const before = structuredClone(start);
    const after = rules.applyCommand(start, { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    expect(start).toEqual(before);
    expect(BigInt(start.stones) - BigInt(after.stones)).toBe(40n);
    expect(BigInt(start.inventory.ore) - BigInt(after.inventory.ore)).toBe(6n);
    expect(BigInt(start.inventory['spirit-bamboo']) - BigInt(after.inventory['spirit-bamboo'])).toBe(4n);
    expect(BigInt(start.inventory.hide) - BigInt(after.inventory.hide)).toBe(2n);
    expect(after.inventory['iron-sword']).toBeUndefined();
    expect(after.equipment).toHaveLength(1);
    expect(after.equipment[0].affixes).toHaveLength(1);
    expect(after.loadout.weapon).toBeNull();
    expect(after.clockMs).toBe(start.clockMs);
    expect(after.player.hp).toBe('10');
    expect(after.activity).toEqual(start.activity);
  });
  it('is identical for batched and sequential crafts, including RNG and unique instances', () => {
    const start = funded();
    const batch = rules.applyCommand(start, { type: 'craft', recipeId: 'forge-iron-sword', quantity: 25 });
    let sequential = start;
    for (let i = 0; i < 25; i++) sequential = rules.applyCommand(sequential, { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    expect(batch).toEqual(sequential);
    expect(batch.crafting['forge-iron-sword'].attempts).toBe('25');
    expect(batch.equipment).toHaveLength(Number(batch.crafting['forge-iron-sword'].successes));
    expect(new Set(batch.equipment.map((entry) => entry.instanceId)).size).toBe(batch.equipment.length);
    expect(batch.nextInstance).toBe((BigInt(batch.equipment.length) + 1n).toString());
  });
  it('rejects missing material/cash, locked recipes and combat without spending RNG or assets', () => {
    for (const missing of ['stones', 'hide'] as const) {
      const start = funded();
      if (missing === 'stones') start.stones = '39';
      else start.inventory.hide = '1';
      const before = structuredClone(start);
      expect(() => rules.applyCommand(start, { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 })).toThrow();
      expect(start).toEqual(before);
    }
    expect(() => rules.applyCommand(rules.createGame(0), { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 })).toThrow(/开放/);
    const fighting = rules.applyCommand(funded(), { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    expect(() => rules.applyCommand(fighting, { type: 'craft', recipeId: 'forge-wood-sword', quantity: 1 })).toThrow(/脱战/);
  });
  it('retains the generated affixes across JSON saves, equips and reads', () => {
    const made = rules.applyCommand(funded(), { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    const restored = JSON.parse(JSON.stringify(made)) as GameState;
    const equipped = rules.applyCommand(restored, { type: 'equip', slot: 'weapon', instanceId: restored.equipment[0].instanceId });
    expect(equipped.rng).toBe(made.rng);
    expect(equipped.equipment).toEqual(made.equipment);
    expect(Number(rules.getPlayerStats(equipped).attack)).toBeGreaterThanOrEqual(18);
    rules.getGameView(equipped);
    expect(equipped.equipment).toEqual(made.equipment);
  });
  it('shows real outputs and costs without treating equipment as pills', () => {
    const view = rules.getGameView(funded());
    const forged = view.recipes.find((recipe) => recipe.id === 'forge-iron-sword')!;
    expect(forged.outputKind).toBe('equipment');
    expect(forged.outputName).toBe('寒铁剑');
    expect(forged.description).toContain('攻击');
    expect(forged.effects.some((effect) => effect.includes('词条'))).toBe(true);
    expect(forged.costs.find((cost) => cost.itemId === 'stones')?.quantity).toBe('40');
    expect(view.inventory.find((item) => item.id === 'timber')?.effects).toContain('炼器材料');
    expect(view.recipes.find((recipe) => recipe.id === 'healing')?.outputKind).toBeUndefined();
  });
});

describe('cumulative wave settlement', () => {
  it('settles only at the threshold, adds first bonus once and does not heal on clear', () => {
    const { rules: testRules, state: start } = arena();
    start.player.hp = '40';
    start.player.mp = '3';
    let state = kills(testRules, start, 2n);
    expect(state.stones).toBe('30');
    expect(testRules.getGameView(state).regions[0].clear).toMatchObject({ wavesPerClear: 3, completedWaves: 2, clears: '0' });
    state = kills(testRules, state, 3n);
    expect(state.stones).toBe('42');
    expect(state.cultivation).toBe('14');
    expect(state.player.hp).toBe('40');
    expect(state.player.mp).toBe('3');
    expect(state.equipment).toEqual([]);
    expect(testRules.getGameView(state).regions[0].clear).toMatchObject({ completedWaves: 0, clears: '1' });
    expect(testRules.advanceGame(state, state.clockMs)).toEqual(state);
    state = kills(testRules, state, 6n);
    expect(state.stones).toBe('49');
    expect(state.cultivation).toBe('25');
    expect(state.journal.filter((entry) => entry.kind === 'gain')).toHaveLength(2);
  });
  it('retains completed waves through stop, activity changes, region switches and save/load', () => {
    const { rules: testRules, state: start } = arena((c) => {
      c.regions[1].unlock = { level: 0 };
      c.regions[1].enemies = ['hill-wolf'];
    });
    let state = kills(testRules, start, 2n);
    state = testRules.applyCommand(state, { type: 'activity', kind: 'idle' });
    state = testRules.applyCommand(state, { type: 'activity', kind: 'meditate' });
    state = testRules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    state = kills(testRules, state, 1n, 'bamboo');
    state = JSON.parse(JSON.stringify(state)) as GameState;
    state = testRules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    expect(state.regionKills).toEqual({ foothill: '2', bamboo: '1' });
    expect(state.stones).toBe('30');
    state = kills(testRules, state, 3n);
    expect(state.stones).toBe('42');
    expect(state.regionKills.bamboo).toBe('1');
    const view = testRules.getGameView(state);
    view.regions[0].clear!.reward.stones = '999';
    expect(testRules.content.regions[0].clear!.reward.stones).toBe('7');
  });
  it('restarts the unfinished enemy without counting partial damage as progress', () => {
    const { rules: testRules, state: start } = arena((c) => { c.enemies[0].maxHp = '100'; });
    let state = kills(testRules, start, 1n);
    while (state.battle!.hp === '100') state = testRules.advanceGame(state, state.clockMs + 1000, 1);
    expect(Number(state.battle!.hp)).toBeLessThan(100);
    state = testRules.applyCommand(state, { type: 'activity', kind: 'idle' });
    state = testRules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    expect(state.battle!.hp).toBe('100');
    expect(state.regionKills.foothill).toBe('1');
    expect(state.stones).toBe('30');
  });
  it('preserves completed waves on defeat and never resumes after recovery', () => {
    const { rules: testRules, state: start } = arena((c) => {
      c.enemies[0].maxHp = '10000';
      c.enemies[0].attack = '99999';
      c.enemies[0].agility = '100000';
      c.enemies[0].attackIntervalMs = 1000;
    });
    start.regionKills.foothill = '2';
    const day = testRules.advanceGame(start, 86_400_000);
    expect(day.activity.kind).toBe('idle');
    expect(day.activity.stopReason).toContain('战败');
    expect(day.regionKills.foothill).toBe('2');
    expect(day.stones).toBe('30');
    const month = testRules.advanceGame(day, 30 * 86_400_000);
    expect(month.clockMs).toBe(30 * 86_400_000);
    expect(month.regionKills).toEqual(day.regionKills);
    expect(month.totals).toEqual(day.totals);
    expect(month.player.hp).toBe('100');
  });
  it('keeps very large wave/stone counters exact and does not replay the first bonus', () => {
    const { rules: testRules, state } = arena();
    const rounds = 10n ** 160n + 9007199254740993n;
    state.regionKills.foothill = (rounds * 3n + 2n).toString();
    state.stones = rounds.toString();
    const after = kills(testRules, state, rounds * 3n + 3n);
    expect(after.stones).toBe((rounds + 7n).toString());
    expect(testRules.getGameView(after).regions[0].clear).toMatchObject({ clears: (rounds + 1n).toString(), completedWaves: 0 });
  });
  it('uses the shared cultivation reserve rules for clear rewards', () => {
    const { rules: testRules, state } = arena();
    state.level = 12;
    state.cultivation = '17000';
    state.reserve = '14999';
    const after = kills(testRules, state, 3n);
    expect(after.reserve).toBe('15006.5');
    expect(after.activity.kind).toBe('dungeon');
  });
  it.each([1, 42, 20260926])('is identical online/offline across clears and JSON saves, seed=%s', (seed) => {
    const { rules: testRules } = arena();
    const start = testRules.applyCommand(testRules.createGame(0, seed), { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    const whole = testRules.advanceGame(start, 600_999);
    let split = start;
    while (split.clockMs < 600_000) split = testRules.advanceGame(JSON.parse(JSON.stringify(split)), 600_999, 7);
    expect(split).toEqual(whole);
    expect(Number(split.regionKills.foothill)).toBeGreaterThan(20);
    expect(split.equipment).toEqual([]);
  });
});

describe('self-funded opening using actual candidate rules', () => {
  it.each([1, 42, 20260926])('buys, crafts, equips and clears without gifts or injected assets, seed=%s', (seed) => {
    for (const retreat of [false, true]) {
      const result = craftingOpening(seed, retreat);
      expect(result.equipmentCost).toBe('16');
      expect(result.firstClearSeconds).toBeLessThan(3600);
      expect(result.state.equipment).toHaveLength(1);
      expect(result.state.equipment[0].definitionId).toBe('wood-sword');
      expect(result.state.regionKills.foothill).toBe('20');
      expect(rules.getGameView(result.state).regions[0].clear?.clears).toBe('1');
      expect(result.state.stones).toBe('34');
      expect(BigInt(result.state.inventory['healing-pill'] ?? '0') + BigInt(result.state.totals.pillsUsed)).toBe(5n);
      expect(result.interruptedAt !== null).toBe(retreat);
    }
  });
});
