import { describe, expect, it } from 'vitest';
import { allocatedEnemyStats, content, loadContent, type Content } from './content';
import { createRules } from './game';
import { dec, random } from './numbers';
import { FOUNDATION_METHOD_IDS, type FoundationMethodId } from '../shared/contracts';
import { gameCommandSchema } from '../server/validation';

function fixture(edit: (c: Content) => void = () => {}) {
  const c = structuredClone(content);
  c.openingTiers = [{ requiredPoints: '0', slots: 1, candidates: 1, draws: 1, designations: 0 }];
  c.fates = [{ id: 'fixture', name: 'Fixture', rarity: 'common', weight: 1,
    effects: [{ kind: 'gift-stones', amount: '0' }] }];
  c.settings.starterEquipmentId = null;
  c.settings.starterItems = {};
  c.settings.baseMpRegenFraction = '0';
  c.baseStats.mpRegen = '0';
  c.techniques[0].modifiers = [];
  c.techniques[0].effects = [];
  c.techniques[0].practiceBonuses = [];
  c.foundationMethods.forEach((method, index) => {
    method.successChance = ['0.6', '0.5', '0.4'][index];
    method.extraCosts = method.id === 'human' ? [] : [
      { itemId: 'ore', quantity: '4', failureQuantity: '2' },
      ...(method.id === 'heaven' ? [{ itemId: 'clear-spirit-core', quantity: '1', failureQuantity: '0' }] : []),
    ];
    method.modifiers = [{ stat: 'maxHp', mode: 'percent', value: ['0.1', '0.2', '0.3'][index] }];
  });
  c.challenges[0].unlock = { level: 0 };
  const boss = c.challenges[0].enemy;
  Object.assign(boss.allocation!.multipliers, {
    maxHp: '0.01', maxMp: '0', attack: '0', magicAttack: '0', defense: '0', magicDefense: '0', agility: '0.01',
  });
  Object.assign(boss, allocatedEnemyStats(c.realms, boss.allocation!), { attackIntervalMs: 1000, stones: '2' });
  boss.drops = [{ itemId: 'clear-spirit-core', quantity: '1', chance: 0.5 }];
  edit(c);
  const rules = createRules(c);
  let state = rules.createGame(0, 1);
  state = rules.applyCommand(state, { type: 'fate-select', lifeId: state.lifeId, slot: 0, fateId: c.fates[0].id });
  state = rules.applyCommand(state, { type: 'enter-life', lifeId: state.lifeId });
  state.level = 12;
  state.cultivation = c.realms[12].required;
  state.reserve = '13';
  state.inventory = { [c.settings.breakthroughItemId]: '5', ore: '8', 'clear-spirit-core': '1' };
  return { c, rules, state };
}
function attempt(methodId: FoundationMethodId, lifeId = '1') {
  return { type: 'breakthrough' as const, methodId, lifeId };
}

describe('foundation attempts and lasting records', () => {
  it('requires an explicit method, valid life, full cultivation and all preparation before rolling', () => {
    const { c, rules, state } = fixture();
    const before = structuredClone(state);
    rules.getGameView(state);
    expect(state).toEqual(before);
    expect(() => rules.applyCommand(state, attempt('heaven', '2'))).toThrow(/本世/);
    expect(() => rules.applyCommand(state, { ...attempt('human'), methodId: 'invalid' } as never)).toThrow(/方式/);
    expect(gameCommandSchema.safeParse({ type: 'breakthrough' }).success).toBe(false);
    expect(gameCommandSchema.safeParse(attempt('earth')).success).toBe(true);
    expect(state).toEqual(before);
    const short = structuredClone(state);
    short.inventory.ore = '2';
    expect(rules.getGameView(short).breakthrough.methods.find((m) => m.id === 'heaven')!.ready).toBe(false);
    expect(() => rules.applyCommand(short, attempt('heaven'))).toThrow(/数量不足/);
    expect(short.rng).toBe(state.rng);
    expect(short.inventory[c.settings.breakthroughItemId]).toBe('5');
    short.cultivation = '0';
    expect(() => rules.applyCommand(short, attempt('human'))).toThrow(/十二层/);
    const fresh = rules.createGame(0);
    expect(() => rules.applyCommand(fresh, attempt('human'))).toThrow(/入世/);
  });

  it.each(FOUNDATION_METHOD_IDS)('consumes exactly the displayed failed costs without advancement or XP: %s', (methodId) => {
    const { c, rules, state } = fixture();
    state.rng = 123456789;
    state.activity = { kind: 'meditate', startedAt: 0 };
    const terms = rules.getGameView(state).breakthrough.methods.find((method) => method.id === methodId)!;
    const end = rules.applyCommand(state, attempt(methodId));
    for (const cost of terms.costs) {
      expect(end.inventory[cost.itemId]).toBe((BigInt(state.inventory[cost.itemId]) - BigInt(cost.failureQuantity)).toString());
    }
    expect(end.foundation.lastAttempt).toEqual({ methodId, at: 0, success: false });
    expect(end.foundation.attempts).toBe('1');
    expect(end.foundation.methodId).toBeNull();
    expect(end.level).toBe(12);
    expect(end.cultivation).toBe(c.realms[12].required);
    expect(end.reserve).toBe(state.reserve);
    expect(end.player).toEqual(state.player);
    expect(end.proficiencyXp).toEqual(state.proficiencyXp);
    expect(end.history).toEqual(state.history);
    expect(end.activity.kind).toBe('idle');
    const oracle = { rng: state.rng };
    random(oracle);
    expect(end.rng).toBe(oracle.rng);
    expect(rules.advanceGame(end, 10000).foundation).toEqual(end.foundation);
  });

  it.each(FOUNDATION_METHOD_IDS)('applies only the successful current-life foundation once: %s', (methodId) => {
    const { c, rules, state } = fixture((c) => {
      c.fates[0].effects = [{ kind: 'stat', modifier: { stat: 'maxHp', mode: 'percent', value: '0.2' } }];
    });
    state.rng = 1;
    const terms = rules.getGameView(state).breakthrough.methods.find((method) => method.id === methodId)!;
    const end = rules.applyCommand(state, attempt(methodId));
    terms.costs.forEach((cost) => {
      expect(end.inventory[cost.itemId]).toBe((BigInt(state.inventory[cost.itemId]) - BigInt(cost.quantity)).toString());
    });
    expect(end.level).toBe(13);
    expect(end.cultivation).toBe(state.reserve);
    expect(end.reserve).toBe('0');
    expect(end.foundation.methodId).toBe(methodId);
    expect(end.history.foundationMethods).toEqual([methodId]);
    const modifier = c.foundationMethods.find((method) => method.id === methodId)!.modifiers[0];
    expect(rules.getPlayerStats(end).maxHp).toBe(dec(c.realms[13].maxHp).mul(dec(modifier.value).plus('1.2')).toFixed());
    expect(end.player.hp).toBe(state.player.hp);
    expect(end.player.mp).toBe(state.player.mp);
    expect(Object.keys(end.history.achievements)).toEqual(methodId === 'heaven' ? ['heaven-foundation'] : []);
    expect(() => rules.applyCommand(end, attempt('heaven'))).toThrow(/不可重复/);
    expect(rules.getGameView(end).breakthrough.methods.every((method) => !method.ready)).toBe(true);
  });

  it('can retry another method after failure without transferring unearned effects or giving crafting XP', () => {
    const { rules, state } = fixture((c) => {
      c.fates[0].effects = [{ kind: 'luck', value: '9' }, { kind: 'production-success', target: 'alchemy', value: '1' }];
    });
    state.rng = 123456789;
    const failed = rules.applyCommand(state, attempt('heaven'));
    expect(failed.foundation.methodId).toBeNull();
    expect(failed.inventory['clear-spirit-core']).toBe('1');
    failed.rng = 1;
    const success = rules.applyCommand(failed, attempt('human'));
    expect(success.foundation.attempts).toBe('2');
    expect(success.foundation.methodId).toBe('human');
    expect(success.history.achievements).toEqual({});
    expect(success.proficiencyXp).toEqual(state.proficiencyXp);
    expect(success.inventory['clear-spirit-core']).toBe('1');
  });

  it('retains a first achievement record across later successes but never derives strength from history', () => {
    const { c, rules, state } = fixture();
    state.rng = 1;
    const first = rules.applyCommand(state, attempt('heaven'));
    const next = structuredClone(state);
    next.lifeId = '2';
    next.history = rules.applyCommand(first, { type: 'reincarnate', lifeId: first.lifeId }).history;
    next.clockMs = 1000;
    next.rng = 1;
    expect(rules.getPlayerStats(next)).toEqual(rules.getPlayerStats(state));
    const again = rules.applyCommand(next, attempt('heaven', '2'));
    expect(again.history.achievements).toEqual(first.history.achievements);
    expect(again.history.foundationMethods).toEqual(['heaven']);
    expect(again.journal.filter((entry) => entry.text.startsWith('达成成就'))).toHaveLength(0);
    expect(rules.getGameView(again).achievements[0]).toMatchObject({ completed: true, completedAt: 0, lifeId: '1' });
    expect(again.inventory[c.settings.breakthroughItemId]).toBe('4');
  });

  it('rejects malformed history and invalid content cost/rank contracts instead of repairing them', () => {
    const { c, rules, state } = fixture();
    for (const field of ['foundation', 'challengeWins']) {
      const broken = structuredClone(state);
      Reflect.deleteProperty(broken, field);
      expect(() => rules.getGameView(broken)).toThrow();
    }
    const forged = structuredClone(state);
    forged.history.achievements['heaven-foundation'] = { at: 0, lifeId: '1' };
    expect(() => rules.getGameView(forged)).toThrow(/成就/);
    const noAttempt = structuredClone(state);
    noAttempt.level = 13;
    noAttempt.foundation.methodId = 'human';
    noAttempt.history.foundationMethods = ['human'];
    expect(() => rules.getGameView(noAttempt)).toThrow(/尝试/);
    for (const edit of [
      (c: Content) => { c.foundationMethods[0].successChance = '1'; },
      (c: Content) => { c.foundationMethods[1].extraCosts[0].failureQuantity = '99'; },
      (c: Content) => { c.challenges[0].enemy.level = 12; },
      (c: Content) => { c.regions[0].enemies.push(c.challenges[0].enemy.id); },
      (c: Content) => {
        c.challenges[0].unlock = { regionId: c.regions[0].id, kills: '1' };
        c.regions[0].unlock = { level: 13 };
      },
    ]) {
      const broken = structuredClone(c);
      edit(broken);
      expect(() => loadContent(broken)).toThrow();
    }
  });
});

describe('independent one-encounter challenges', () => {
  it('enforces the realm ceiling before starting and uses current realm rather than prior success', () => {
    const { c, rules, state } = fixture((c) => {
      c.challenges[0].unlock = { regionId: c.regions[0].id, kills: '1' };
    });
    const locked = structuredClone(state);
    expect(() => rules.applyCommand(state, { type: 'challenge', lifeId: '2', challengeId: c.challenges[0].id })).toThrow(/本世/);
    expect(() => rules.applyCommand(state, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id })).toThrow(/尚未开放/);
    expect(state).toEqual(locked);
    state.regionKills[c.regions[0].id] = '1';
    state.rng = 1;
    const founded = rules.applyCommand(state, attempt('human'));
    const before = structuredClone(founded);
    expect(rules.getGameView(founded).challenges[0].canStart).toBe(false);
    expect(() => rules.applyCommand(founded, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id })).toThrow(/不得超过/);
    expect(founded).toEqual(before);
    state.history = structuredClone(founded.history);
    const start = rules.applyCommand(state, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id });
    expect(start.battle!.enemyId).toBe(c.challenges[0].enemy.id);
    expect(start.player.hp).toBe(state.player.hp);
    expect(start.player.mp).toBe(state.player.mp);
    expect(start.rng).toBe(state.rng);
    expect(() => rules.applyCommand(start, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id })).toThrow(/脱战/);
    expect(() => rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: c.challenges[0].id })).toThrow(/秘境/);
  });

  it('settles one win, stops, and shares lucky drop odds and online/offline rules without region progress', () => {
    const { c, rules, state } = fixture((c) => { c.fates[0].effects = [{ kind: 'luck', value: '1' }]; });
    state.player.hp = '50';
    const start = rules.applyCommand(state, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id });
    start.rng = 1;
    expect(rules.getGameView(start).challenges[0].enemy.drops[0]).toMatchObject({
      baseChance: '0.5', effectiveChance: '1', luckEligible: true,
    });
    const end = rules.advanceGame(start, 2000);
    expect(end.activity.kind).toBe('idle');
    expect(end.battle).toBeNull();
    expect(end.challengeWins[c.challenges[0].id]).toBe('1');
    expect(end.regionKills).toEqual(state.regionKills);
    expect(end.inventory['clear-spirit-core']).toBe('2');
    expect(end.player.hp).toBe('50');
    expect(end.stones).toBe(dec(start.stones).plus(c.challenges[0].enemy.stones).toFixed());
    expect(end.proficiencyXp.body).toBe(dec(c.proficiencyRules.combatXpPerAction).mul(c.proficiencyRules.realmXpMultipliers[13]).toFixed());
    expect(end.cultivation).toBe(state.cultivation);
    expect(end.history.achievements).toEqual({});
    const bulk = rules.advanceGame(start, 20000);
    let single = start;
    for (let ms = 1000; ms <= 20000; ms += 1000) single = rules.advanceGame(single, ms);
    expect(bulk).toEqual(single);
    expect(bulk.challengeWins).toEqual(end.challengeWins);
    expect(bulk.inventory).toEqual(end.inventory);
    const retry = rules.applyCommand(end, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id });
    expect(retry.battle!.hp).toBe(c.challenges[0].enemy.maxHp);
    expect(retry.player.hp).toBe(end.player.hp);
  });

  it('may award no core, keeps automatic supplies real, and never grants a challenge achievement', () => {
    const { c, rules, state } = fixture();
    state.player.hp = '1';
    state.inventory[c.settings.supplyItemId] = '1';
    state.supply.enabled = true;
    state.supply.hpThreshold = 1;
    const start = rules.applyCommand(state, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id });
    start.rng = 123456789;
    const end = rules.advanceGame(start, 2000);
    expect(end.challengeWins[c.challenges[0].id]).toBe('1');
    expect(end.inventory['clear-spirit-core']).toBe(state.inventory['clear-spirit-core']);
    expect(end.inventory[c.settings.supplyItemId]).toBe('0');
    expect(end.totals.pillsUsed).toBe('1');
    expect(end.supply.readyAt).toBe(1000 + c.settings.supplyCooldownMs);
    expect(end.history.achievements).toEqual({});
  });

  it('blocks out-of-combat commands, resets abandoned enemy HP, and stops on defeat without free recovery', () => {
    const { c, rules, state } = fixture((c) => {
      const boss = c.challenges[0].enemy;
      boss.allocation!.multipliers.attack = '10';
      Object.assign(boss, allocatedEnemyStats(c.realms, boss.allocation!));
    });
    const start = rules.applyCommand(state, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id });
    start.rng = 1;
    expect(() => rules.applyCommand(start, attempt('human'))).toThrow(/脱战/);
    expect(() => rules.applyCommand(start, { type: 'equip', slot: 'weapon', instanceId: null })).toThrow(/脱战/);
    expect(() => rules.applyCommand(start, { type: 'craft', recipeId: 'healing', quantity: 1 })).toThrow(/脱战/);
    start.battle!.hp = '1';
    const abandoned = rules.applyCommand(start, { type: 'activity', kind: 'idle' });
    const retry = rules.applyCommand(abandoned, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id });
    expect(retry.battle!.hp).toBe(c.challenges[0].enemy.maxHp);
    retry.rng = 1;
    const lost = rules.advanceGame(retry, 1000);
    expect(lost.activity.kind).toBe('idle');
    expect(lost.player.hp).toBe('0');
    expect(lost.battle).toBeNull();
    expect(lost.challengeWins).toEqual({});
    expect(lost.inventory).toEqual(state.inventory);
    expect(() => rules.applyCommand(lost, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id })).toThrow(/气血/);
    const rested = rules.advanceGame(lost, 2000);
    const next = rules.applyCommand(rested, { type: 'challenge', lifeId: '1', challengeId: c.challenges[0].id });
    expect(next.player.hp).toBe(rested.player.hp);
    expect(dec(next.player.hp).lt(rules.getPlayerStats(next).maxHp)).toBe(true);
  });
});
