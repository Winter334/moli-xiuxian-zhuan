import { describe, expect, it } from 'vitest';
import {
  advanceGame, applyCommand, content, createGame, createRules, getGameView, loadContent,
  type Content, type GameState, type Stats,
} from './index';
import { applyDamage, directDamage, hitChance, restore, strikeDamage, triggerEffects } from './combat';
import { dec, random } from './numbers';
import { firstFoundation } from './scenarios';

const copy = () => structuredClone(content);
const fighter = (hp = '100', mp = '20', shield = '0') => ({ hp, mp, shield, nextActionMs: 0 });
const stats: Stats = {
  maxHp: '100', maxMp: '20', attack: '10', magicAttack: '30', defense: '2', magicDefense: '4', agility: '10',
  hpRegen: '0', mpRegen: '1', critChance: '0', critMultiplier: '2', attackIntervalMs: 2000,
};
function catchUp(state: GameState, to: number, ticks = 3600) {
  while (state.clockMs < Math.floor(to / 1000) * 1000) state = advanceGame(state, to, ticks);
  return state;
}
function duel(edit: (c: Content) => void = () => {}) {
  const c = copy();
  c.regions[0].enemies = [c.enemies[0].id];
  c.enemies[0].equipmentDrops = [];
  c.enemies[0].drops = [];
  c.enemies[0].effects = [];
  c.enemies[0].attack = '0';
  c.enemies[0].maxHp = '10000';
  c.enemies[0].hpRegen = '0';
  c.enemies[0].mpRegen = '0';
  c.enemies[0].attackIntervalMs = 2000;
  edit(c);
  const rules = createRules(c);
  const state = rules.applyCommand(rules.createGame(0, 1), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
  return { rules, state, c };
}

describe('validated, versioned content', () => {
  it('loads immutable JSON content and references', () => {
    expect(content.realms).toHaveLength(14);
    expect(content.regions).toHaveLength(3);
    expect(Object.isFrozen(content.effects[0])).toBe(true);
    expect(() => loadContent({ ...copy(), madeUpField: true })).toThrow();
  });
  it('rejects duplicate identifiers, unknown references, ranges, costs and cycles', () => {
    const bad = [
      (c: Content) => { c.items.push(c.items[0]); },
      (c: Content) => { c.enemies[0].effects.push('missing'); },
      (c: Content) => { c.affixes[0].min = '999'; },
      (c: Content) => { c.recipes[0].costs.push(c.recipes[0].costs[0]); },
      (c: Content) => { c.regions[0].unlock = { regionId: 'ruins', kills: '1' }; },
      (c: Content) => { c.settings.reserveBands[2].until = '30001'; },
      (c: Content) => { c.actions[0].mpCost = '1'; },
      (c: Content) => { c.items[0].sellPrice = '999'; },
      (c: Content) => { c.recipes[0].stones = '-1'; },
      (c: Content) => { c.enemies[0].drops[0].chance = 2; },
      (c: Content) => { c.enemies[0].attackIntervalMs = 500; },
    ];
    for (const mutate of bad) { const c = copy(); mutate(c); expect(() => loadContent(c)).toThrow(); }
  });
  it('rejects old schema, rules and content instead of replaying with new rules', () => {
    for (const field of ['schemaVersion', 'rulesVersion', 'contentVersion'] as const) {
      const state = createGame(0);
      Object.assign(state, { [field]: field === 'schemaVersion' ? 0 : 'old' });
      expect(() => advanceGame(state, 1000)).toThrow(/版本/);
      expect(() => applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' })).toThrow(/版本/);
      expect(() => getGameView(state)).toThrow(/版本/);
    }
  });
});

describe('common combat semantics', () => {
  it('allows zero physical damage, and crit cannot pierce defense', () => {
    expect(strikeDamage('10', '10', '1', true, '999')).toBe('0');
    expect(strikeDamage('9', '10', '1', false, '2')).toBe('0');
  });
  it('subtracts defense per segment, before critical multiplier, then shields', () => {
    expect(strikeDamage('100', '80', '1', true, '2')).toBe('40');
    expect(strikeDamage('100', '80', '0.5', true, '2')).toBe('0');
    const target = fighter('100', '0', '35');
    expect(applyDamage(target, '40')).toEqual({ absorbed: '35', hpLost: '5' });
    expect(target.hp).toBe('95');
    expect(target.shield).toBe('0');
  });
  it('magic uses magic defense and spends mana even on a miss', () => {
    const action = { id: 'test-magic', name: '法术', damageType: 'magical', hits: 1, mpCost: '6', coefficient: '1.5' } as const;
    expect(directDamage(stats, { ...stats, defense: '9999' }, action, false)).toBe('41');
    expect(directDamage(stats, { ...stats, magicDefense: '9999' }, action, true)).toBe('0');
    const { rules, state } = duel((c) => {
      c.techniques[0].actionId = 'spark';
      c.enemies[0].agility = '1000000';
    });
    state.rng = 123456789;
    state.player.mp = '20';
    const after = rules.advanceGame(state, 2000);
    expect(after.battle!.hp).toBe('10000');
    expect(after.player.mp).toBe('14');
  });
  it('agility ratio is scale invariant and never confers guaranteed hit/evasion', () => {
    expect(hitChance('10', '10')).toBeCloseTo(0.78);
    expect(hitChance('1000', '1000')).toBe(hitChance('10', '10'));
    expect(hitChance('10000000000000000000', '1')).toBeLessThan(1);
    expect(hitChance('1', '10000000000000000000')).toBeGreaterThan(0);
  });
  it('zero damage still triggers on-hit healing, not hurt retaliation', () => {
    const { rules, state } = duel((c) => {
      c.techniques[0].effects = ['hit-mend'];
      c.enemies[0].defense = '1000';
      c.enemies[0].effects = ['thorn'];
    });
    state.player.hp = '50';
    const after = rules.advanceGame(state, 2000);
    expect(after.player.hp).toBe('52');
    expect(after.battle!.hp).toBe('10000');
  });
  it('does not multiply fixed restoration by crit and clamps recovery to missing resources', () => {
    const target = fighter('99', '19');
    expect(restore(target, stats, 'hp', '500')).toBe('1');
    expect(restore(target, stats, 'mp', '500')).toBe('1');
    expect(target.hp).toBe('100');
    expect(target.mp).toBe('20');
  });
  it('guaranteed crit doubles post-defense damage but not the shared fixed on-hit heal', () => {
    const { rules, state } = duel((c) => {
      c.baseStats.critChance = '1';
      c.baseStats.critMultiplier = '2';
      c.techniques[0].effects = ['hit-mend'];
      c.enemies[0].defense = '3';
    });
    state.player.hp = '50';
    const after = rules.advanceGame(state, 2000);
    expect(after.player.hp).toBe('52');
    expect(after.battle!.hp).toBe('9980');
  });
  it('shares the same effect definition between equipment, techniques and enemies', () => {
    const effect = content.effects.find((value) => value.id === 'hit-mend')!;
    expect(content.equipment.some((value) => value.effects.includes(effect.id))).toBe(true);
    expect(content.techniques.some((value) => value.effects.includes(effect.id))).toBe(true);
    expect(content.enemies.some((value) => value.effects.includes(effect.id))).toBe(true);
    const owner = fighter('20');
    const opponent = fighter();
    triggerEffects('hit', [effect], owner, stats, opponent, stats);
    expect(owner.hp).toBe('22');
  });
  it('uses enemy abilities with real restoration and action shields', () => {
    const { rules, state } = duel((c) => {
      c.enemies[0].effects = ['hit-mend', 'action-ward'];
      c.enemies[0].attack = '8';
      c.enemies[0].defense = '1000';
    });
    state.battle!.hp = '500';
    const after = rules.advanceGame(state, 2000);
    expect(after.battle!.shield).toBe('3');
    expect(dec(after.battle!.hp).gte('500')).toBe(true);
  });
  it('a living defender can retaliate, but a dead attacker cannot complete later hits', () => {
    const { rules, state } = duel((c) => {
      c.techniques[0].actionId = 'double-strike';
      c.techniques[0].effects = [];
      c.enemies[0].effects = ['thorn'];
      c.effects.find((effect) => effect.id === 'thorn')!.amount = '200';
    });
    state.player.hp = '1';
    const after = rules.advanceGame(state, 2000);
    expect(after.activity.stopReason).toContain('战败');
    expect(after.player.hp).toBe('0');
    expect(after.totals.kills).toBe('0');
  });
  it('falls back to a free basic attack without mana, and does not partially pay', () => {
    const { rules, state } = duel((c) => {
      c.techniques[0].actionId = 'spark';
      c.techniques[0].effects = [];
      c.baseStats.mpRegen = '0';
      c.settings.baseMpRegenFraction = '0';
      c.enemies[0].defense = '0';
    });
    state.player.mp = '2';
    const after = rules.advanceGame(state, 2000);
    expect(after.battle!.hp).toBe('9987');
    expect(after.player.mp).toBe('2');
  });
  it('player wins simultaneous readiness; a dead defender never attacks or reflects', () => {
    const { rules, state } = duel((c) => {
      c.enemies[0].maxHp = '1';
      c.enemies[0].attack = '99999';
      c.enemies[0].effects = ['thorn'];
    });
    const after = rules.advanceGame(state, 2000);
    expect(after.totals.kills).toBe('1');
    expect(after.player.hp).toBe('100');
    expect(after.activity.kind).toBe('dungeon');
  });
  it('does not give rest or full mana between enemy waves', () => {
    const { rules, state } = duel((c) => {
      c.enemies[0].maxHp = '1';
      c.techniques[0].effects = [];
    });
    state.player.hp = '40';
    state.player.mp = '1';
    const after = rules.advanceGame(state, 2000);
    expect(after.totals.kills).toBe('1');
    expect(after.player.hp).toBe('40');
    expect(after.player.mp).toBe('3');
  });
  it('allows explicit combat regeneration, without out-of-combat percentage healing', () => {
    const { rules, state } = duel((c) => { c.baseStats.hpRegen = '0.5'; });
    state.player.hp = '40';
    expect(rules.advanceGame(state, 1000).player.hp).toBe('40.5');
    const rest = rules.applyCommand(state, { type: 'activity', kind: 'idle' });
    expect(rules.advanceGame(rest, 1000).player.hp).toBe('45.5');
  });
  it('consumes real supplies only when authorized, below threshold and off cooldown', () => {
    const { rules, state } = duel();
    state.player.hp = '1';
    state.inventory['healing-pill'] = '2';
    const noAuthorization = rules.advanceGame(state, 1000);
    expect(noAuthorization.player.hp).toBe('1');
    const supplied = rules.applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 0.9 });
    const first = rules.advanceGame(supplied, 1000);
    expect(first.player.hp).toBe('61');
    expect(first.inventory['healing-pill']).toBe('1');
    expect(rules.advanceGame(first, 10_000).inventory['healing-pill']).toBe('1');
    const second = rules.advanceGame(first, 11_000);
    expect(second.inventory['healing-pill']).toBe('0');
    expect(second.player.hp).toBe('100');
    expect(second.totals.pillsUsed).toBe('2');
  });
  it('empty supply inventory never restores health or consumes materials automatically', () => {
    const { rules, state } = duel();
    state.player.hp = '1';
    state.inventory['healing-pill'] = '0';
    state.inventory.herb = '1000';
    state.supply.enabled = true;
    const after = rules.advanceGame(state, 1000);
    expect(after.player.hp).toBe('1');
    expect(after.inventory.herb).toBe('1000');
    expect(after.totals.pillsUsed).toBe('0');
  });
  it('stops on defeat, rests from zero, and never automatically resumes farming', () => {
    const { rules, state } = duel((c) => {
      c.enemies[0].attack = '100000';
      c.enemies[0].agility = '100000';
    });
    const after = rules.advanceGame(state, 3_600_000);
    expect(after.activity.kind).toBe('idle');
    expect(after.activity.stopReason).toContain('战败');
    expect(after.activity.stoppedAt).toBe(2000);
    expect(after.player.hp).toBe('100');
    expect(after.totals.kills).toBe('0');
    expect(after.totals.activeSeconds).toBe('2');
    expect(after.clockMs).toBe(3_600_000);
  });
  it('stops unbreakable stalemates and bounds net-zero regeneration fights', () => {
    const a = duel((c) => { c.enemies[0].defense = '999999'; });
    expect(a.rules.advanceGame(a.state, 200_000).activity.stoppedAt).toBe(120_000);
    const b = duel((c) => { c.enemies[0].hpRegen = '10000'; });
    expect(b.rules.advanceGame(b.state, 1_000_000).activity.stoppedAt).toBe(900_000);
  });
});

describe('dual attributes and bounded fixed mastery', () => {
  it('selects each attack and defense independently, before critical damage and shields', () => {
    const action = { id: 'test', name: '测试', hits: 1, mpCost: '0', coefficient: '2', damageType: 'physical' } as const;
    expect(directDamage(stats, stats, action, true)).toBe('36');
    expect(directDamage(stats, stats, { ...action, damageType: 'magical' }, true)).toBe('112');
    expect(directDamage({ ...stats, attack: '9999' }, stats, { ...action, damageType: 'magical' }, true)).toBe('112');
    expect(directDamage({ ...stats, magicAttack: '9999' }, stats, action, true)).toBe('36');
  });

  it('fixed magical on-hit damage needs no magic attack and does not produce more hit triggers', () => {
    const { rules, state } = duel(c => {
      c.realms[0].magicAttack = '0';
      c.techniques[0].effects = ['test-magic-hit', 'hit-mend'];
      c.techniques[0].actionId = 'double-strike';
      c.techniques[0].practiceBonuses = [];
      c.enemies[0].defense = '9999';
      c.enemies[0].magicDefense = '3';
      c.effects.push({ id: 'test-magic-hit', name: '附法伤', kind: 'damage', damageType: 'magical', trigger: 'hit', amount: '8' });
    });
    state.player.hp = '50';
    state.battle!.nextActionMs = 60_000;
    const after = rules.advanceGame(state, 2000);
    expect(after.battle!.hp).toBe('9990');
    expect(after.player.hp).toBe('54');
    expect(after.player.mp).toBe('16');
    expect(after.techniqueXp.breathing).toBe('1');
  });

  it('distinguishes one action trigger from two landed-hit triggers', () => {
    const fight = (trigger: 'hit' | 'action') => {
      const { rules, state } = duel(c => {
        c.techniques[0].effects = ['test-magic'];
        c.techniques[0].actionId = 'double-strike';
        c.enemies[0].defense = '9999';
        c.enemies[0].magicDefense = '3';
        c.effects.push({ id: 'test-magic', name: '附法伤', kind: 'damage', damageType: 'magical', trigger, amount: '8' });
      });
      state.battle!.nextActionMs = 60_000;
      return rules.advanceGame(state, 2000).battle!.hp;
    };
    expect(fight('hit')).toBe('9990');
    expect(fight('action')).toBe('9995');
  });

  it('mastery adds only the configured capped fixed values, regardless of realm and weapon panel', () => {
    const c = copy();
    c.techniques[0].modifiers = [];
    c.techniques[0].practiceBonuses = [{ stat: 'magicAttack', value: '12' }, { stat: 'magicDefense', value: '4' }];
    const rules = createRules(c);
    const state = rules.createGame(0);
    for (const level of [0, 12]) {
      state.level = level;
      for (const factor of ['0.5', '1', '2']) {
        state.techniqueXp.breathing = '0';
        const before = rules.getPlayerStats(state);
        state.techniqueXp.breathing = dec(c.techniques[0].xpCap).mul(factor).toFixed();
        const after = rules.getPlayerStats(state);
        const portion = Math.min(Number(factor), 1);
        expect(dec(after.magicAttack).minus(before.magicAttack).toFixed()).toBe(String(12 * portion));
        expect(dec(after.magicDefense).minus(before.magicDefense).toFixed()).toBe(String(4 * portion));
        expect(after.attack).toBe(before.attack);
        expect(after.defense).toBe(before.defense);
      }
    }
    state.techniqueXp.breathing = c.techniques[0].xpCap;
    const equipped = rules.getPlayerStats(state);
    const unarmed = rules.getPlayerStats(rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: null }));
    expect(equipped.magicAttack).toBe(unarmed.magicAttack);
    expect(rules.getGameView(state).techniques[0].masteryEffects).toEqual(['法攻 +12', '法防 +4']);
  });

  it('growth accumulates and diminishes separately by physical and magical attribute', () => {
    const c = copy();
    c.items.push({
      id: 'test-magic-pill', name: '测试法攻丹', kind: 'growth', unlock: { level: 0 },
      use: { kind: 'growth', stat: 'magicAttack', amount: '2', scale: '2' },
    });
    const rules = createRules(c);
    let state = rules.createGame(0);
    state.player.pillAttack = '999';
    state.inventory['test-magic-pill'] = '4';
    const before = rules.getPlayerStats(state);
    const batch = rules.applyCommand(state, { type: 'consume', itemId: 'test-magic-pill', quantity: 4 });
    for (let i = 0; i < 4; i++) state = rules.applyCommand(state, { type: 'consume', itemId: 'test-magic-pill', quantity: 1 });
    expect(batch).toEqual(state);
    expect(state.player.pillMagicAttack).toBe('5.8');
    expect(rules.getPlayerStats(state).attack).toBe(before.attack);
    expect(dec(rules.getPlayerStats(state).magicAttack).minus(before.magicAttack).toFixed()).toBe('5.8');
  });

  it('rejects missing dual stats and old mastery fields instead of filling them', () => {
    const c = copy();
    Reflect.deleteProperty(c.realms[0], 'magicAttack');
    expect(() => loadContent(c)).toThrow();
    const old = copy();
    Object.assign(old.techniques[0], { attackPercentAtCap: '0.2' });
    expect(() => loadContent(old)).toThrow();
    const rules = createRules();
    const state = rules.createGame(0);
    Reflect.deleteProperty(state.player, 'pillMagicAttack');
    expect(() => rules.getGameView(state)).toThrow(/累计状态/);
  });
});

describe('pure, bounded, partition-independent time', () => {
  it('floors creation and targets to whole seconds, rejects unsafe values', () => {
    expect(createGame(1999).clockMs).toBe(1000);
    expect(createGame(1999.75).clockMs).toBe(1000);
    expect(advanceGame(createGame(0), 999).clockMs).toBe(0);
    expect(() => createGame(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => createGame(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => advanceGame(createGame(0), NaN)).toThrow();
    expect(() => advanceGame(createGame(0), 1000, 0)).toThrow();
  });
  it('bounds real work to maxTicks and exposes the exact resume timestamp', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'meditate' });
    expect(advanceGame(state, 10_000_000).clockMs).toBe(3_600_000);
    expect(advanceGame(state, 10_000, 3).clockMs).toBe(3000);
  });
  it('never mutates its input or aliases view data', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const before = structuredClone(state);
    advanceGame(state, 20_000);
    applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 0.5 });
    const view = getGameView(state);
    view.activity.kind = 'idle';
    expect(state).toEqual(before);
  });
  it('whole and arbitrary millisecond partitions match exactly, including RNG, journal and equipment', () => {
    for (const seed of [1, 42, 8888]) {
      const initial = applyCommand(createGame(1111, seed), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
      const whole = advanceGame(initial, 601_999);
      let segmented = initial;
      const division = { rng: seed };
      let timestamp = initial.clockMs;
      while (timestamp < 601_999) {
        timestamp = Math.min(601_999, timestamp + 0.25 + random(division) * 17_331);
        segmented = advanceGame(segmented, timestamp, 100);
      }
      expect(segmented).toEqual(whole);
    }
  });
  it('different work budgets and JSON save/load match during actual combat and supplies', () => {
    let state = createGame(0, 1);
    state.level = 4;
    state.player.hp = '140';
    state.inventory['healing-pill'] = '50';
    state = applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 0.8 });
    state = applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const whole = catchUp(state, 1_800_999, 10000);
    let small = state;
    while (small.clockMs < 1_800_000) small = advanceGame(JSON.parse(JSON.stringify(small)), 1_800_999, 7);
    expect(small).toEqual(whole);
    expect(BigInt(whole.totals.kills)).toBeGreaterThan(0n);
  });
  it('idle fast-forward is exactly equal to a second-by-second rest', () => {
    const state = createGame(0);
    state.player.hp = '0';
    state.player.mp = '0';
    let segmented = state;
    for (let at = 1000; at <= 100_000; at += 1000) segmented = advanceGame(segmented, at);
    expect(advanceGame(state, 100_000)).toEqual(segmented);
  });
});

describe('progression, bounded reserves and commands', () => {
  it('reaches first foundation from new-game resources with only legal commands', () => {
    const { state, milestones } = firstFoundation(1);
    expect(state.level).toBe(13);
    expect(state.inventory['foundation-pill']).toBe('0');
    expect(BigInt(state.regionKills.ruins)).toBeGreaterThanOrEqual(10n);
    expect(milestones.at(-1)!.atSeconds).toBeLessThan(86_400);
    expect(BigInt(state.totals.pillsUsed)).toBeLessThanOrEqual(5n);
  });
  it('automatically advances from mortal, without healing on promotion', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'meditate' });
    state.cultivation = '59';
    const after = advanceGame(state, 1000);
    expect(after.level).toBe(1);
    expect(after.cultivation).toBe('0');
    expect(after.player.hp).toBe('100');
    expect(after.player.mp).toBe('20');
  });
  it('integrates reserve bands across thresholds without discounting existing gains', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'meditate' });
    state.level = 12;
    state.cultivation = '17000';
    state.reserve = '14999';
    const after = advanceGame(state, 1000);
    expect(after.reserve).toBe('15000.6');
    expect(after.totals.cultivationGained).toBe('1.6');
    expect(getGameView(after).cultivation.efficiency).toBe(0.5);
  });
  it('one large real combat reward crosses all levels and saturates without invisible overflow', () => {
    const { rules, state, c } = duel((c) => {
      c.enemies[0].maxHp = '1';
      c.enemies[0].cultivation = '1000000';
    });
    const after = rules.advanceGame(state, 2000);
    expect(after.level).toBe(12);
    expect(after.cultivation).toBe(c.realms[12].required);
    expect(after.reserve).toBe(c.settings.reserveCapacity);
    const expected = c.realms.slice(0, 13).reduce((sum, realm) => sum.plus(realm.required), dec(c.settings.reserveCapacity));
    expect(after.totals.cultivationGained).toBe(expected.toFixed());
    expect(after.activity.kind).toBe('dungeon');
  });
  it('long meditation is identical across nonaligned partitions at every realm transition', () => {
    const start = applyCommand(createGame(2999, 7), { type: 'activity', kind: 'meditate' });
    const whole = catchUp(start, 10_000_987, 100000);
    let split = start;
    for (const time of [54_019, 64_999, 711_012, 988_515, 1_585_115, 3_701_997, 10_000_987]) {
      split = catchUp(split, time, 139);
    }
    expect(split).toEqual(whole);
  });
  it('stops the delivered content boundary explicitly without granting a fake next realm', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'meditate' });
    state.level = 13; state.cultivation = '119999';
    const after = advanceGame(state, 1000);
    expect(after.cultivation).toBe('120000');
    expect(after.level).toBe(13);
    expect(after.activity.stopReason).toContain('本版本');
    expect(getGameView(after).cultivation.efficiency).toBe(0);
  });
  it('caps reserve, records exact saturation and skips only equivalent idle time', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'meditate' });
    state.level = 12;
    state.cultivation = '17000';
    state.reserve = '29999.9';
    const whole = catchUp(state, 100_999);
    let parts = state;
    for (const at of [317, 1999, 2345, 9999, 37_582, 100_999]) parts = catchUp(parts, at, 2);
    expect(parts).toEqual(whole);
    expect(whole.reserve).toBe('30000');
    expect(whole.activity.stoppedAt).toBe(1000);
    expect(whole.totals.cultivationGained).toBe('0.1');
  });
  it('continues actual dungeon rewards when cultivation reserve is saturated', () => {
    const state = createGame(0, 1);
    state.level = 12; state.cultivation = '17000'; state.reserve = '30000';
    const after = advanceGame(applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' }), 30_000);
    expect(after.reserve).toBe('30000');
    expect(BigInt(after.totals.kills)).toBeGreaterThan(0n);
    expect(BigInt(after.stones)).toBeGreaterThan(30n);
  });
  it('breaks through with materials, without full reserve, preserving HP/MP and all real gains', () => {
    const state = createGame(0);
    state.level = 12; state.cultivation = '17000'; state.reserve = '1234.5';
    state.inventory['foundation-pill'] = '1';
    state.player.hp = '20'; state.player.mp = '3'; state.player.pillAttack = '10';
    const result = applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
    expect(result.level).toBe(13);
    expect(result.cultivation).toBe('1234.5');
    expect(result.reserve).toBe('0');
    expect(result.inventory['foundation-pill']).toBe('0');
    expect(result.player.hp).toBe('20');
    expect(result.player.mp).toBe('3');
    expect(result.player.pillAttack).toBe('10');
    expect(result.rng).toBe(state.rng);
  });
  it('rejects premature or missing-material breakthrough atomically', () => {
    const state = createGame(0);
    expect(() => applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' })).toThrow(/十二层/);
    state.level = 12; state.cultivation = '17000';
    const before = structuredClone(state);
    expect(() => applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' })).toThrow(/数量不足/);
    expect(state).toEqual(before);
  });
  it('practice changes only the selected technique, stops at cap and does not add cultivation', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'practice', targetId: 'breathing' });
    const after = advanceGame(state, 4_000_000);
    expect(after.techniqueXp.breathing).toBe('1800');
    expect(after.techniqueXp.flame).toBe('0');
    expect(after.cultivation).toBe('0');
    expect(after.activity.stoppedAt).toBe(1_800_000);
    expect(after.totals.activeSeconds).toBe('1800');
  });
  it('gates areas by exploration, allowing low-realm access and valid breakthrough material sources', () => {
    let state = createGame(0);
    expect(() => applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'ruins' })).toThrow(/开放/);
    state.regionKills.quarry = '5';
    state = applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'ruins' });
    expect(state.level).toBe(0);
    expect(state.battle?.enemyId).toBe('ruin-adept');
    expect(content.enemies.find((enemy) => enemy.id === 'ruin-adept')!.drops).toContainEqual({ itemId: 'essence', quantity: '1', chance: 1 });
  });
});

describe('real assets, crafting and equipment extensibility', () => {
  it('batch growth pills exactly match sequential commands through diminishing returns', () => {
    const state = createGame(0);
    state.inventory['attack-pill'] = '200';
    const batch = applyCommand(state, { type: 'consume', itemId: 'attack-pill', quantity: 200 });
    let sequential = state;
    for (let i = 0; i < 200; i++) sequential = applyCommand(sequential, { type: 'consume', itemId: 'attack-pill', quantity: 1 });
    expect(batch).toEqual(sequential);
    expect(dec(batch.player.pillAttack).gt(31)).toBe(true);
    expect(dec(batch.player.pillAttack).lt(200)).toBe(true);
  });
  it('recovery batches match single pills and preserve unused full-health pills', () => {
    const state = createGame(0);
    state.player.hp = '1'; state.inventory['healing-pill'] = '10';
    const batch = applyCommand(state, { type: 'consume', itemId: 'healing-pill', quantity: 10 });
    let sequential = state;
    for (let i = 0; i < 10; i++) sequential = applyCommand(sequential, { type: 'consume', itemId: 'healing-pill', quantity: 1 });
    expect(batch).toEqual(sequential);
    expect(batch.inventory['healing-pill']).toBe('8');
    expect(batch.totals.pillsUsed).toBe('2');
  });
  it('crafting batches equal sequential crafts and do not interrupt meditation', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'meditate' });
    state.inventory.herb = '60'; state.stones = '100';
    const batch = applyCommand(state, { type: 'craft', recipeId: 'healing', quantity: 20 });
    let sequential = state;
    for (let i = 0; i < 20; i++) sequential = applyCommand(sequential, { type: 'craft', recipeId: 'healing', quantity: 1 });
    expect(batch).toEqual(sequential);
    expect(batch.activity.kind).toBe('meditate');
    expect(batch.inventory.herb).toBe('20');
    expect(batch.stones).toBe('80');
  });
  it('does not craft, equip, switch technique or consume manually during combat', () => {
    const state = applyCommand(createGame(0), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const commands = [
      { type: 'craft', recipeId: 'healing', quantity: 1 },
      { type: 'equip', slot: 'weapon', instanceId: null }, { type: 'technique', techniqueId: 'breathing' },
      { type: 'consume', itemId: 'healing-pill', quantity: 1 },
    ] as const;
    for (const command of commands) expect(() => applyCommand(state, command)).toThrow(/脱战/);
  });
  it('failed craft and purchase do not partially consume state', () => {
    const state = createGame(0);
    const before = structuredClone(state);
    expect(() => applyCommand(state, { type: 'craft', recipeId: 'healing', quantity: 10 })).toThrow();
    expect(() => applyCommand(state, { type: 'buy', itemId: 'healing-pill', quantity: 100 })).toThrow();
    expect(state).toEqual(before);
  });
  it('assets and counters above safe integer and above Decimal precision remain exact', () => {
    const state = createGame(0);
    const huge = 10n ** 160n + 9007199254740993n;
    state.stones = huge.toString();
    state.inventory.herb = huge.toString();
    const bought = applyCommand(state, { type: 'buy', itemId: 'herb', quantity: 10 });
    expect(bought.stones).toBe((huge - 30n).toString());
    expect(bought.inventory.herb).toBe((huge + 10n).toString());
    const sold = applyCommand(bought, { type: 'sell', itemId: 'herb', quantity: 10 });
    expect(sold.stones).toBe((huge - 20n).toString());
    expect(sold.inventory.herb).toBe(huge.toString());
  });
  it('growth above JS safe integer preserves sub-unit increments as decimal strings', () => {
    const state = createGame(0);
    state.inventory['attack-pill'] = '1';
    state.player.pillAttack = '9007199254740993';
    const after = applyCommand(state, { type: 'consume', itemId: 'attack-pill', quantity: 1 });
    expect(dec(after.player.pillAttack).gt(state.player.pillAttack)).toBe(true);
    expect(dec(after.player.pillAttack).minus(state.player.pillAttack).lt(1)).toBe(true);
  });
  it('validates quantities and unknown commands at the core boundary', () => {
    for (const quantity of [0, -1, 1.1, Infinity, 10001]) {
      expect(() => applyCommand(createGame(0), { type: 'buy', itemId: 'herb', quantity })).toThrow();
    }
    expect(() => applyCommand(createGame(0), { type: 'invalid' } as never)).toThrow();
  });
  it('adds a configured equipment drop with existing affix and no changed game flow', () => {
    const { rules, state } = duel((c) => {
      c.equipment.push({
        id: 'test-gauntlet', name: '测试拳套', slot: 'weapon', category: 'gauntlet',
        modifiers: [{ stat: 'attack', mode: 'flat', value: '500' }],
        effects: ['hit-mend'], affixPool: ['spirit'], affixCount: 1,
      });
      c.enemies[0].maxHp = '1';
      c.enemies[0].equipmentDrops = [{ equipmentId: 'test-gauntlet', chance: 1 }];
    });
    const dropped = rules.advanceGame(state, 2000);
    const instance = dropped.equipment.find((value) => value.definitionId === 'test-gauntlet')!;
    expect(instance.affixes).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(dropped)) as GameState;
    expect(rules.getGameView(saved).equipment.find((value) => value.instanceId === instance.instanceId)!.affixes[0]).toContain('灵力');
    const stopped = rules.applyCommand(saved, { type: 'activity', kind: 'idle' });
    const equipped = rules.applyCommand(stopped, { type: 'equip', slot: 'weapon', instanceId: instance.instanceId });
    expect(dec(rules.getGameView(equipped).player.stats.attack).gte(510)).toBe(true);
    expect(equipped.equipment.find((value) => value.instanceId === instance.instanceId)).toEqual(instance);
    expect(equipped.rng).toBe(dropped.rng);
  });
  it('changing the generation range cannot reroll a saved equipment affix', () => {
    const first = duel((c) => {
      c.enemies[0].maxHp = '1';
      c.enemies[0].equipmentDrops = [{ equipmentId: 'iron-sword', chance: 1 }];
    });
    const state = first.rules.advanceGame(first.state, 2000);
    const modified = first.c;
    modified.affixes.forEach((affix) => { affix.min = '99'; affix.max = '99'; });
    const rules = createRules(modified);
    const before = structuredClone(state.equipment);
    rules.getGameView(state);
    const after = rules.advanceGame(state, 3000);
    expect(after.equipment).toEqual(before);
  });
  it('buy-craft-sell cannot create stones without externally obtained materials', () => {
    for (const recipe of content.recipes) {
      const materials = recipe.costs.map((cost) => ({ item: content.items.find((item) => item.id === cost.itemId)!, count: BigInt(cost.quantity) }));
      if (materials.some(({ item }) => !item.buyPrice)) continue;
      const cost = materials.reduce((sum, { item, count }) => sum + BigInt(item.buyPrice!) * count, BigInt(recipe.stones));
      const output = content.items.find((item) => item.id === recipe.outputId)!;
      expect(BigInt(output.sellPrice ?? '0') * BigInt(recipe.outputQuantity)).toBeLessThan(cost);
    }
  });
});
