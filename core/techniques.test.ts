import { describe, expect, it } from 'vitest';
import { content, loadContent, type Content } from './content';
import { createRules } from './game';

// Synthetic combat operands test rule ordering, not any candidate's balance values.
function fixture(edit: (c: Content) => void = () => {}) {
  const c = structuredClone(content);
  Object.assign(c.baseStats, { hpRegen: '0', mpRegen: '0', critChance: '1', critMultiplier: '2' });
  c.settings.baseMpRegenFraction = '0';
  Object.assign(c.realms[0], { maxHp: '100', maxMp: '20', attack: '10', magicAttack: '12', defense: '2', magicDefense: '0' });
  for (const weapon of c.equipment) Object.assign(weapon, { modifiers: [], effects: [], affixPool: [], affixCount: 0 });
  c.effects.push(
    { id: 'test-mana', name: '定额回灵', trigger: 'hit', kind: 'restore', resource: 'mp', amount: '2' },
    { id: 'test-hit', name: '附伤', trigger: 'hit', kind: 'damage', damageType: 'magical', amount: '4' },
    { id: 'test-reaction', name: '反击', trigger: 'hurt', kind: 'damage', damageType: 'magical', amount: '3' },
  );
  Object.assign(c.techniques[0], {
    actionId: 'double-strike', weaponType: 'sword', practiceBonuses: [],
    modifiers: [{ stat: 'attack', mode: 'flat', value: '2' }], effects: [],
    weaponMatch: {
      modifiers: [{ stat: 'defense', mode: 'flat', value: '3' }],
      effects: ['test-mana', 'test-hit'], actionDamagePercent: '0.5',
    },
  });
  Object.assign(c.techniques[1], { unlock: { level: 0 }, weaponType: null, modifiers: [], effects: [] });
  Object.assign(c.actions.find((a) => a.id === 'double-strike')!, { coefficient: '1', mpCost: '4', hits: 2 });
  Object.assign(c.enemies[0], {
    maxHp: '1000', maxMp: '20', attack: '10', magicAttack: '10', defense: '6', magicDefense: '0', hpRegen: '0', mpRegen: '0',
    attackIntervalMs: 2000, critChance: '0', actionId: 'double-strike', effects: ['test-reaction'],
    drops: [], equipmentDrops: [],
  });
  c.regions[0].enemies = [c.enemies[0].id];
  edit(c);
  const rules = createRules(c);
  const state = rules.createGame(0, 1);
  state.equipment.push({
    instanceId: 'owned-staff', definitionId: 'jade-staff', contentVersion: c.version, affixes: [],
  });
  return { c, rules, state, swordId: state.loadout.weapon! };
}

describe('technique weapon conditions without class restrictions', () => {
  it('validates condition payloads and does not turn a type label into a bonus', () => {
    const { c } = fixture();
    for (const mutate of [
      (raw: Content) => { raw.techniques[0].weaponType = null; },
      (raw: Content) => { delete raw.techniques[0].weaponType; },
      (raw: Content) => { raw.techniques[0].weaponMatch!.effects = ['missing-effect']; },
      (raw: Content) => { raw.techniques[0].weaponMatch!.actionDamagePercent = '-0.1'; },
      (raw: Content) => { raw.techniques[0].weaponMatch = { modifiers: [], effects: [], actionDamagePercent: '0' }; },
    ]) {
      const bad = structuredClone(c);
      mutate(bad);
      expect(() => loadContent(bad)).toThrow();
    }
    const typed = fixture((raw) => { delete raw.techniques[0].weaponMatch; });
    const untyped = fixture((raw) => {
      delete raw.techniques[0].weaponMatch;
      raw.techniques[0].weaponType = null;
    });
    expect(typed.rules.getPlayerStats(typed.state)).toEqual(untyped.rules.getPlayerStats(untyped.state));
    expect(untyped.rules.getGameView(untyped.state).techniques[0].weaponType).toBeNull();
  });

  it('rechecks equipment and active technique, preserving mixed use and mastery', () => {
    const { rules, state, swordId } = fixture();
    const technique = rules.content.techniques[0];
    state.techniqueXp[technique.id] = '5';
    const matching = rules.getGameView(state).techniques[0];
    expect(matching.weaponType).toBe('sword');
    expect(matching.weaponMatch).toMatchObject({ conditionMet: true, active: true, actionDamagePercent: '0.5' });
    expect(matching.effects.some((line) => line.startsWith('持剑时：'))).toBe(true);
    expect(rules.getPlayerStats(state)).toMatchObject({ attack: '12', defense: '5' });
    for (const instanceId of ['owned-staff', null]) {
      let mixed = rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId });
      mixed = rules.applyCommand(mixed, { type: 'technique', techniqueId: technique.id });
      expect(rules.getPlayerStats(mixed)).toMatchObject({ attack: '12', defense: '2' });
      expect(rules.getGameView(mixed).techniques[0].weaponMatch).toMatchObject({ conditionMet: false, active: false });
      let fight = rules.applyCommand(mixed, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
      fight.player.mp = '5';
      fight.battle!.nextActionMs = 60_000;
      fight = rules.advanceGame(fight, 2000);
      expect(fight.player.mp).toBe('1');
      expect(fight.battle!.hp).toBe('976');
      expect(fight.techniqueXp[technique.id]).toBe('6');
    }
    let inactive = rules.applyCommand(state, { type: 'technique', techniqueId: rules.content.techniques[1].id });
    expect(rules.getPlayerStats(inactive)).toMatchObject({ attack: '10', defense: '2' });
    expect(rules.getGameView(inactive).techniques[0].weaponMatch).toMatchObject({ conditionMet: true, active: false });
    inactive = rules.applyCommand(inactive, { type: 'equip', slot: 'weapon', instanceId: swordId });
    inactive = rules.applyCommand(inactive, { type: 'technique', techniqueId: technique.id });
    expect(rules.getPlayerStats(inactive).defense).toBe('5');
    expect(inactive.techniqueXp[technique.id]).toBe('5');
    expect(state.loadout.weapon).toBe(swordId);
  });

  it('multiplies each direct hit after defense and crit, before shields, not restores, triggers or enemies', () => {
    for (const [damageType, defense, enemyHp, playerHp] of [
      ['physical', '6', '963', '84'],
      ['magical', '600', '927', '74'],
      ['physical', '600', '999', '90'],
    ] as const) {
      const { rules, state } = fixture((raw) => {
        raw.actions.find((a) => a.id === 'double-strike')!.damageType = damageType;
        raw.enemies[0].defense = defense;
      });
      const fight = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
      fight.player.mp = '5';
      fight.battle!.shield = '7';
      const after = rules.advanceGame(fight, 2000);
      expect(after.battle!.hp).toBe(enemyHp);
      expect(after.battle!.shield).toBe('0');
      expect(after.player.mp).toBe('5');
      expect(after.player.hp).toBe(playerHp);
    }
  });

  it('does not boost the mana fallback attack; on-hit recovery still requires a hit', () => {
    for (const misses of [false, true]) {
      const { rules, state } = fixture((raw) => {
        if (misses) raw.enemies[0].agility = '1000000';
      });
      const fight = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
      fight.player.mp = '0';
      fight.battle!.nextActionMs = 60_000;
      if (misses) fight.rng = 123456789;
      const after = rules.advanceGame(fight, 2000);
      expect(after.battle!.hp).toBe(misses ? '1000' : '984');
      expect(after.player.mp).toBe(misses ? '0' : '2');
    }
  });

  it('keeps matching effects deterministic across time chunks', () => {
    const { rules, state } = fixture();
    const start = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const batch = rules.advanceGame(start, 30_000);
    for (const ticks of [1, 7]) {
      let chunked = start;
      while (chunked.clockMs < 30_000) chunked = rules.advanceGame(chunked, 30_000, ticks);
      expect(chunked).toEqual(batch);
    }
  });
});
