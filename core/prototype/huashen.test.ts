import { describe, expect, it } from 'vitest';
import { dec } from '../numbers';
import { createCharacter, readCharacter, normalizeHuashenCultivation, synchronizeCharacter, addInstance } from './character-state';
import { executeCharacterCommand, advanceCharacter, getCharacterView } from './character';
import { executeDebugCommand } from './debug';
import { gainCultivation, realmAt } from './growth';
import { gainSkill, initialSkills } from './skills';
import { BASE_STATS, resolveStats } from './stats';
import { createSimulation, startEncounter, advanceSimulation } from './simulation';
import { ENEMIES } from './content';

const waiting = (xp = '1000000000000') => {
  const state = executeDebugCommand(createCharacter(0, 417), { type: 'realm', level: 24 });
  state.cultivation = xp;
  state.inventory['huashen-crystal'] = '2';
  return readCharacter(state);
};

describe('化神突破长期规则', () => {
  it('读取保留原件，续玩先清理超额，普通修为不能越过突破许可', () => {
    const old = waiting('50000000000000');
    expect(readCharacter(old).cultivation).toBe('50000000000000');
    const next = advanceCharacter(old, 0);
    expect(next.cultivation).toBe('1000000000000');
    expect(old.cultivation).toBe('50000000000000');
    expect(next.log.at(-1)?.message).toContain('49000000000000');
    expect(normalizeHuashenCultivation(next)).toBe(false);
    expect(gainCultivation(24, next.cultivation, '50000000000000').level).toBe(24);
    expect(gainCultivation(24, next.cultivation, '50000000000000').cultivation).toBe('1000000000000');
  });
  it('灵晶本次授权突破，保留当次余量，化神初期封顶但不晋升', () => {
    for (const [before, remaining] of [['900000000000', '0'], ['50000000000000', '100000000000']]) {
      const old = waiting(before);
      const next = executeCharacterCommand(old, { type: 'use', itemId: 'huashen-crystal', quantity: 1 });
      expect(next.level).toBe(25);
      expect(next.cultivation).toBe(remaining);
      expect(next.skills.domain?.xp).toBe('9999000000000000');
      expect(next.skills['manual-mastery']?.xp).toBe(next.skills.domain?.xp);
      const again = executeCharacterCommand(next, { type: 'use', itemId: 'huashen-crystal', quantity: 1 });
      expect(again.skills.domain).toEqual(next.skills.domain);
      expect(gainCultivation(25, again.cultivation, '50000000000000').level).toBe(25);
      expect(gainCultivation(25, again.cultivation, '50000000000000').cultivation).toBe('12000000000000');
    }
    const early = executeCharacterCommand(waiting('0'), { type: 'use', itemId: 'huashen-crystal', quantity: 1 });
    expect(early.level).toBe(24);
    expect(gainCultivation(early.level, early.cultivation, '900000000000').level).toBe(24);
  });
  it('精确领域奖励跳过所有倍率但继续向精通补差', () => {
    const skills = initialSkills();
    skills.domain = { level: 0, xp: '0' };
    gainSkill(skills, 'domain', '100', 25, '1000000000000000000', [
      { id: 'bonus', modifiers: [{ target: 'experience.skill', operation: 'multiply', value: '100' }] },
    ], false);
    expect(skills.domain.xp).toBe('100');
    expect(skills['manual-mastery']?.xp).toBe('100');
    expect(dec(realmAt(25).skillXpMultiplier).div(realmAt(24).skillXpMultiplier).toFixed()).toBe('1.4');
  });
  it('暴击合成后封顶且重读不重复浓缩，纳财只消耗本世紫币', () => {
    let state = executeCharacterCommand(waiting(), { type: 'use', itemId: 'huashen-crystal', quantity: 1 });
    state.inventory['purple-cast-coin'] = '10';
    state.inventory['green-cast-coin'] = '20';
    const money = state.money;
    state = executeCharacterCommand(state, { type: 'offer-fortune' });
    expect(state.fortuneOffering).toBe('10');
    expect(state.inventory['purple-cast-coin']).toBeUndefined();
    expect(state.inventory['green-cast-coin']).toBe('20');
    expect(state.money).toBe(money);
    expect(getCharacterView(readCharacter(state)).stats).toEqual(getCharacterView(state).stats);
    expect(resolveStats({ ...BASE_STATS, critChance: '2', critMultiplier: '3' },
      [{ id: 'realm', multiplier: { critChance: '0.25', critMultiplier: '4' } }])).toMatchObject({ critChance: '0.5', critMultiplier: '12' });
  });
  it('凝晶仅扣指定辐照并归零强度，知识直接由通关提供', () => {
    let state = executeDebugCommand(waiting(), { type: 'region', regionId: 'crystal-chamber', operation: 'complete' });
    state = executeDebugCommand(state, { type: 'travel', locationId: 'fallen-ark-outer' });
    state = executeCharacterCommand(state, { type: 'reactor', active: true });
    Object.assign(state.reactor!, { radiation: 1234567, power: 123, temperature: 345, gel: 56 });
    const before = { ...state.reactor! };
    const next = executeCharacterCommand(state, { type: 'reactor-crystallize' });
    expect(next.reactor).toEqual({ ...before, radiation: 234567, power: 0 });
    expect(next.inventory['huashen-crystal']).toBe('3');
  });
  it('主枢第十轮先普通攻击，再按实时装备检查，否则追加一击', () => {
    const initial = createSimulation({ clockMs: 0, seed: 417, base: { ...BASE_STATS,
      maxHp: '1000000000000000', attack: '0', defense: '0', agility: '1', attackSpeed: '0.01' } });
    const fight = startEncounter(initial, { regionId: 'main-hub-hall', enemies: [ENEMIES['main-hub-puppet'].definition] }).state;
    let equipped = false;
    const first = advanceSimulation(fight, 9000, 1000, { hasArkContract: () => equipped }).state;
    equipped = true;
    const active = advanceSimulation(first, 10000, 1000, { hasArkContract: () => equipped });
    expect(active.state.battle?.enemies[0].hp).toBe('1');
    const kinds = active.events.filter(e => e.kind === 'strike' || e.kind === 'ark-contract').map(e => e.kind);
    expect(kinds).toEqual(['strike', 'ark-contract']);
    const absent = advanceSimulation(first, 10000, 1000, { hasArkContract: () => false });
    expect(absent.events.filter(e => e.kind === 'strike')).toHaveLength(2);
    const fragile = structuredClone(first);
    fragile.player.hp = '1';
    const fatal = advanceSimulation(fragile, 10000, 1000, { hasArkContract: () => true });
    expect(fatal.events.some(e => e.kind === 'fainted')).toBe(true);
    expect(fatal.events.some(e => e.kind === 'ark-contract')).toBe(false);
  });
  it('提前击杀主枢仍回收一份阵契，装备优先于行囊原品质', () => {
    for (const equip of [false, true]) {
      let state = executeDebugCommand(waiting(), { type: 'region', regionId: 'main-hub-hall', operation: 'open' });
      const original = addInstance(state, state.instances, 'ark-ward-contract', 130);
      const other = addInstance(state, state.instances, 'ark-ward-contract', 131);
      if (equip) state.equipment.special = other;
      state.marrow.attack = '10000000000000000000';
      state.marrow.agility = '10000000000000000000';
      synchronizeCharacter(state);
      state = executeCharacterCommand(state, { type: 'enter', regionId: 'main-hub-hall' });
      const next = advanceCharacter(state, 1000);
      expect(next.instances[equip ? other : original]).toBeUndefined();
      expect(next.instances[equip ? original : other]).toBeDefined();
      if (equip) expect(next.equipment.special).toBeNull();
      expect(next.inventory['main-hub-core']).toBe('1');
      expect(next.simulation.clearedGroups['main-hub-hall']).toBe('1');
    }
  });
});
