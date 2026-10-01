import { describe, expect, it } from 'vitest';
import { allocatedEnemyStats, loadContent, type Content } from './content';
import { createRules } from './game';
import { growthCandidate } from './growth-candidate';
import { monsterCandidate, monsterProfile } from './monster-candidate';
import { monsterFoundation } from './monster-scenarios';
import { dec } from './numbers';

// Unit fixtures only; progression scenarios below obtain resources with public commands.
function funded(rules = createRules(monsterCandidate)) {
  const state = rules.createGame(0, 42);
  state.stones = '1000000';
  for (const item of rules.content.items) state.inventory[item.id] = '10000';
  for (const region of rules.content.regions) state.regionKills[region.id] = '20';
  return state;
}
function onlyGuardian() {
  const c = structuredClone(monsterCandidate);
  const region = c.regions.find((entry) => entry.id === 'ruins')!;
  region.enemies = ['garden-guardian'];
  region.enemyWeights = { 'garden-guardian': 1 };
  return c;
}

describe('realm baselines, simple roles and sparse traits', () => {
  it('derives five actual attributes from realm baselines, not from player level or a decorative label', () => {
    for (const enemy of monsterCandidate.enemies) {
      const resolved = allocatedEnemyStats(monsterCandidate.realms, enemy.allocation!);
      expect(enemy).toMatchObject(resolved);
    }
    const physical = monsterCandidate.enemies.find((enemy) => enemy.id === 'iron-lizard')!;
    const magical = monsterCandidate.enemies.find((enemy) => enemy.id === 'flame-lizard')!;
    expect(physical.allocation!.level).toBe(magical.allocation!.level);
    expect(dec(magical.attack).lt(physical.attack)).toBe(true);
    expect(dec(magical.maxHp).lt(physical.maxHp)).toBe(true);
    expect(physical.defense).toBe('18');
    expect(magical.defense).toBe('5');
    const c = onlyGuardian();
    const rules = createRules(c);
    const low = funded(rules);
    const high = structuredClone(low);
    high.level = 12;
    const begin = (state: typeof low) => rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'ruins' });
    expect(begin(low).battle).toEqual(begin(high).battle);
  });
  it('permits simple upper/lower variants and limits triggered effects to three of thirteen templates', () => {
    expect(monsterCandidate.enemies).toHaveLength(13);
    expect(monsterCandidate.enemies.filter((enemy) => enemy.effects.length)).toHaveLength(3);
    expect(monsterCandidate.enemyEffects).toHaveLength(2);
    const elites = monsterCandidate.enemies.filter((enemy) => enemy.eliteOf);
    expect(elites).toHaveLength(3);
    for (const elite of elites) {
      const base = monsterCandidate.enemies.find((entry) => entry.id === elite.eliteOf)!;
      expect(elite.effects).toEqual(base.effects);
      for (const stat of ['maxHp', 'attack', 'defense', 'agility'] as const) expect(dec(elite[stat]).gt(base[stat])).toBe(true);
    }
  });
  it('keeps critical materials on normal monsters, without adding finished equipment or foundation-pill drops', () => {
    for (const id of ['dense-ore', 'heartwood', 'moon-fungus', 'essence']) {
      expect(monsterCandidate.enemies.some((enemy) => !enemy.eliteOf && enemy.drops.some((drop) => drop.itemId === id && drop.chance === 1))).toBe(true);
    }
    expect(monsterCandidate.enemies.every((enemy) => !enemy.equipmentDrops.length)).toBe(true);
    expect(monsterCandidate.enemies.some((enemy) => enemy.drops.some((drop) => drop.itemId === 'foundation-pill'))).toBe(false);
    const guardian = monsterCandidate.enemies.find((enemy) => enemy.id === 'garden-guardian')!;
    const vine = monsterCandidate.enemies.find((enemy) => enemy.id === 'root-vine')!;
    expect(guardian.drops.some((drop) => drop.itemId === 'moon-fungus')).toBe(false);
    expect(vine.drops.some((drop) => drop.itemId === 'essence')).toBe(false);
  });
  it('does not require random affixes on ordinary or even every late weapon', () => {
    expect(monsterCandidate.equipment.filter((entry) => entry.affixCount > 0).map((entry) => entry.id)).toEqual(['bamboo-edge', 'jade-staff']);
    const c = structuredClone(monsterCandidate);
    c.equipmentQualities!.forEach((quality) => { quality.weight = quality.id === 'fine' ? 1 : 0; });
    const rules = createRules(c);
    const state = rules.applyCommand(funded(rules), { type: 'craft', recipeId: 'forge-iron-sword', quantity: 1 });
    expect(state.equipment[0].affixes).toEqual([]);
    expect(state.equipment[0].quality!.modifiers[0].value).toBe('23.4');
    expect(growthCandidate.equipment.find((entry) => entry.id === 'iron-sword')!.affixCount).toBe(1);
  });
  it('rejects inconsistent baselines, false elite ancestry and mixed effect pools', () => {
    const mutations = [
      (c: Content) => { Object.assign(c, { schemaVersion: 4 }); },
      (c: Content) => { delete c.enemies[0].allocation; },
      (c: Content) => { c.enemies[0].attack = '999'; },
      (c: Content) => { c.enemies[0].allocation!.level = 2; },
      (c: Content) => { c.enemies[0].allocation!.rank = 'elite'; },
      (c: Content) => { c.enemies.at(-1)!.eliteOf = 'bamboo-snake-elite'; },
      (c: Content) => { c.enemies[0].effects = ['thorn']; },
      (c: Content) => { c.equipment[0].effects = ['enemy-spines']; },
      (c: Content) => { c.enemyEffects!.push(c.enemyEffects![0]); },
      (c: Content) => { c.enemyEffects![0].id = 'thorn'; },
      (c: Content) => { c.regions[1].enemyWeights = { 'bamboo-snake': 1 }; },
      (c: Content) => { c.regions[1].enemyWeights!['bamboo-snake'] = -1; },
      (c: Content) => { c.regions[1].enemyWeights!['unknown'] = 1; },
    ];
    for (const mutate of mutations) {
      const c = structuredClone(monsterCandidate);
      mutate(c);
      expect(() => loadContent(c)).toThrow();
    }
  });
});

describe('weighted elite encounters persist until actual defeat', () => {
  it('exposes realm/rank and precise encounter probability without conflating it with loot probability', () => {
    const rules = createRules(monsterCandidate);
    const view = rules.getGameView(funded(rules));
    const region = view.regions.find((entry) => entry.id === 'bamboo')!;
    expect(region.enemies.map((enemy) => enemy.encounterChance)).toEqual(['0.45', '0.45', '0.1']);
    expect(region.enemies[2]).toMatchObject({ realm: { level: 1, name: '炼气一层' }, rank: 'elite' });
    expect(region.drops.some((drop) => drop.includes('初阶培元丹') && drop.includes('4%'))).toBe(true);
  });
  it('samples elites through real kills and pays the configured monster-specific rewards', () => {
    const rules = createRules(monsterProfile());
    let state = funded(rules);
    state.level = 12;
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const counts: Record<string, number> = {};
    const startBlood = BigInt(state.inventory.blood);
    while (BigInt(state.totals.kills) < 1000n) {
      const before = state;
      state = rules.advanceGame(state, state.clockMs + 1000);
      if (before.totals.kills !== state.totals.kills) counts[before.battle!.enemyId] = (counts[before.battle!.enemyId] ?? 0) + 1;
      if (state.clockMs > 10_000_000 || state.activity.kind !== 'dungeon') throw new Error('采样未完成');
    }
    expect(counts['bamboo-snake-elite']).toBeGreaterThan(50);
    expect(counts['bamboo-snake-elite']).toBeLessThan(150);
    expect(BigInt(state.inventory.blood) - startBlood).toBe(1000n + BigInt(counts['bamboo-snake-elite']));
    expect(state.regionKills.bamboo).toBe('1020');
    expect(state.pendingEncounters!.bamboo).toBe(state.battle!.enemyId);
  });
  it('cannot reroll by retreat, changing activity, visiting another region or JSON save/load', () => {
    const rules = createRules(monsterCandidate);
    let state = rules.applyCommand(funded(rules), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const firstId = state.battle!.enemyId;
    const firstRng = state.rng;
    const firstKills = state.regionKills.bamboo;
    for (let i = 0; i < 10; i++) {
      state = rules.applyCommand(state, { type: 'activity', kind: 'meditate' });
      state = rules.applyCommand(JSON.parse(JSON.stringify(state)), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
      expect(state.battle!.enemyId).toBe(firstId);
      expect(state.rng).toBe(firstRng);
    }
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'quarry' });
    const rngAfterOther = state.rng;
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    expect(state.battle!.enemyId).toBe(firstId);
    expect(state.rng).toBe(rngAfterOther);
    expect(state.regionKills.bamboo).toBe(firstKills);
    expect(state.totals.kills).toBe('0');
  });
  it('keeps the pending enemy through defeat; healing does not resume combat', () => {
    const rules = createRules(onlyGuardian());
    let state = funded(rules);
    state.player.hp = '1';
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'ruins' });
    while (state.activity.kind === 'dungeon' && state.clockMs < 60_000) state = rules.advanceGame(state, state.clockMs + 1000);
    expect(state.activity.stopReason).toContain('战败');
    expect(state.pendingEncounters!.ruins).toBe('garden-guardian');
    state = rules.advanceGame(state, 120_000);
    expect(state.activity.kind).toBe('idle');
    expect(state.regionKills.ruins).toBe('20');
    expect(state.totals.kills).toBe('0');
    const rng = state.rng;
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'ruins' });
    expect(state.battle!.enemyId).toBe('garden-guardian');
    expect(state.rng).toBe(rng);
  });
  it('rejects absent, unknown or mismatched pending encounters and cross-version saves', () => {
    const rules = createRules(monsterCandidate);
    const original = rules.createGame(0);
    for (const pending of [undefined, [], { nowhere: 'hill-wolf' }, { bamboo: 'hill-wolf' }]) {
      const state = structuredClone(original);
      Object.assign(state, { pendingEncounters: pending });
      expect(() => rules.getGameView(state)).toThrow(/遭遇/);
    }
    const fighting = rules.applyCommand(original, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    fighting.pendingEncounters = {};
    expect(() => rules.advanceGame(fighting, 1000)).toThrow(/遭遇/);
    const old = createRules(growthCandidate);
    expect(() => rules.getGameView(old.createGame(0))).toThrow(/版本/);
    expect(() => old.getGameView(original)).toThrow(/版本/);
    const oldState = old.createGame(0);
    oldState.pendingEncounters = {};
    expect(() => old.getGameView(oldState)).toThrow(/旧版/);
  });
});

describe('monster-only encounter shields use normal damage rules', () => {
  it('applies once per encounter, persists on load, and does not regenerate on every action', () => {
    const rules = createRules(onlyGuardian());
    let state = funded(rules);
    state.level = 6;
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'ruins' });
    expect(state.battle!.shield).toBe('25');
    expect(state.player.shield).toBe('0');
    state = rules.advanceGame(state, 5000);
    expect(dec(state.battle!.shield).lt(25)).toBe(true);
    const saved = JSON.parse(JSON.stringify(state));
    const view = rules.getGameView(saved).battle!;
    expect(view.shield).toBe(state.battle!.shield);
    expect(view.abilities.some((entry) => entry.includes('战斗中不重复生成'))).toBe(true);
    expect(rules.advanceGame(saved, saved.clockMs)).toEqual(state);
    state = rules.applyCommand(state, { type: 'activity', kind: 'idle' });
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'ruins' });
    expect(state.battle!.shield).toBe('25');
    expect(state.battle!.hp).toBe(rules.content.enemies.find((enemy) => enemy.id === 'garden-guardian')!.maxHp);
  });
  it('is identical across online/offline partitions with elites, growth bonuses and supplies', () => {
    const rules = createRules(monsterProfile());
    let start = funded(rules);
    start.level = 9;
    start = rules.applyCommand(start, { type: 'craft', recipeId: 'forge-bamboo-edge', quantity: 1 });
    start = rules.applyCommand(start, { type: 'equip', slot: 'weapon', instanceId: start.equipment[0].instanceId });
    start = rules.applyCommand(start, { type: 'consume', itemId: 'defense-pill', quantity: 10 });
    start = rules.applyCommand(start, { type: 'supply', enabled: true, hpThreshold: 0.5 });
    start = rules.applyCommand(start, { type: 'activity', kind: 'dungeon', targetId: 'ruins' });
    const whole = rules.advanceGame(start, 600_000);
    let parts = start;
    while (parts.clockMs < 600_000) parts = rules.advanceGame(JSON.parse(JSON.stringify(parts)), 600_000, 17);
    expect(parts).toEqual(whole);
  });
});

describe('ordinary weapon paths with realm-based enemies and elites', () => {
  it.each(['sword', 'gauntlet', 'staff'] as const)('keeps the %s path self-sufficient with real growth investment and zero pill drops', (path) => {
    const result = monsterFoundation(path, 'modest', 1, true);
    expect(result.state.level).toBe(13);
    expect(result.ledger.growthDropped).toEqual({});
    expect(result.ledger.growthCrafted).toEqual(result.ledger.growthConsumed);
    expect(Object.values(result.ledger.enemyKills).reduce((sum, n) => sum + BigInt(n), 0n).toString()).toBe(result.state.totals.kills);
    expect(result.state.equipment).toHaveLength(3);
    expect(result.state.equipment.every((entry) => entry.affixes.length === 0)).toBe(true);
  }, 30_000);
});
