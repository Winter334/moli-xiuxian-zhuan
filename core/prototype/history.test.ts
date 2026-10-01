import { afterEach, describe, expect, it, vi } from 'vitest';
import * as numbers from '../numbers';
import { executeCharacterCommand, advanceCharacter, getCharacterView } from './character';
import { addInstance, createCharacter, readCharacter } from './character-state';
import { ARMOR_ASSEMBLIES, ASSEMBLIES, ITEMS, RECIPES } from './content';
import { executeDebugCommand } from './debug';
import { MINING_SITE_IDS, MINING_SITES } from './gathering';
import { FOUNDATION_LEVEL } from './growth';
import { checkHistoryProgress } from './history';
import { reincarnateCharacter } from './reincarnation';

afterEach(() => vi.restoreAllMocks());
const initial = () => createCharacter(0, 19);

describe('durable character history', () => {
  it('records encounters on entry before kills, preserves them on withdrawal and across lives, and does not invent them from debug skips', () => {
    const state = initial();
    const regionId = getCharacterView(state).regions.find(region => region.arrivable)!.id;
    const arrived = executeCharacterCommand(state, { type: 'arrive', regionId });
    expect(arrived.history.firstEncounters).toEqual({});
    const skipped = executeDebugCommand(state, { type: 'region', regionId, operation: 'complete' });
    expect(skipped.history.firstEncounters).toEqual({});
    const fighting = executeCharacterCommand(arrived, { type: 'explore' });
    const ids = fighting.simulation.battle!.enemies.map(enemy => enemy.definition.id);
    expect(Object.keys(fighting.history.firstEncounters).sort()).toEqual([...new Set(ids)].sort());
    expect(fighting.history.kills).toEqual({});
    const withdrew = executeCharacterCommand(fighting, { type: 'withdraw' });
    expect(readCharacter(withdrew).history.firstEncounters).toEqual(fighting.history.firstEncounters);
    const next = reincarnateCharacter(withdrew, 1000, 71);
    expect(next.history.firstEncounters).toEqual(fighting.history.firstEncounters);
    expect(next.history.firstEncounters[ids[0]].life).toBe('1');
  });

  it('requires encounter history in current snapshots and protects first encounters from deletion or rewriting', () => {
    const state = initial();
    expect(() => readCharacter({ ...state, schemaVersion: 'neko-character-8' })).toThrow();
    const missing = structuredClone(state) as unknown as { history: Record<string, unknown> };
    delete missing.history.firstEncounters;
    expect(() => readCharacter(missing)).toThrow();
    const regionId = getCharacterView(state).regions.find(region => region.arrivable)!.id;
    const entered = executeCharacterCommand(state, { type: 'enter', regionId });
    const id = Object.keys(entered.history.firstEncounters)[0];
    const changed = structuredClone(entered.history);
    changed.firstEncounters[id].at++;
    expect(() => checkHistoryProgress(entered.history, changed)).toThrow('首次经历');
    delete changed.firstEncounters[id];
    expect(() => checkHistoryProgress(entered.history, changed)).toThrow('首次经历');
  });

  it('counts individual craft attempts, failures and batch output without charging rejected commands', () => {
    const [recipeId, recipe] = Object.entries(RECIPES).find(([, entry]) =>
      entry.path === 'ordinary' && (entry.outputCount ?? 1) > 1 && entry.difficulty > 0)!;
    const state = initial();
    for (const [id, count] of Object.entries(recipe.materials)) state.inventory[id] = String(count * 2);
    vi.spyOn(numbers, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99999999);
    const made = executeCharacterCommand(state, { type: 'craft', recipeId, quantity: 2 });
    expect(made.history.crafting[`recipe:${recipeId}`]).toEqual({
      attempts: '2', successes: '1', produced: String(recipe.outputCount), bonusProduced: '0',
    });
    expect(state.history.crafting).toEqual({});
    const before = structuredClone(made);
    expect(() => executeCharacterCommand(made, { type: 'craft', recipeId, quantity: 2 })).toThrow();
    expect(made).toEqual(before);

    const [componentId, component] = Object.entries(RECIPES).find(([, entry]) => entry.path === 'component')!;
    for (const [id, count] of Object.entries(component.materials)) made.inventory[id] = String(count * 2);
    const crafted = executeCharacterCommand(made, { type: 'craft', recipeId: componentId, quantity: 2 });
    const qualities = Object.values(crafted.instances).filter(item => item.itemId === component.output).map(item => item.quality);
    expect(crafted.history.crafting[`recipe:${componentId}`]).toEqual({ attempts: '2', successes: '2', produced: '2', bonusProduced: '0' });
    expect(crafted.history.bestCraftedQuality[component.output]).toBe(Math.max(...qualities));

    const recipeA = ASSEMBLIES[0];
    const bladeId = addInstance(crafted, crafted.instances, recipeA.blade, 100);
    const hiltId = addInstance(crafted, crafted.instances, recipeA.hilt, 100);
    const assembled = executeCharacterCommand(crafted, { type: 'assemble', bladeId, hiltId });
    expect(assembled.history.crafting[`assemble:${recipeA.output}`]).toEqual({ attempts: '1', successes: '1', produced: '1', bonusProduced: '0' });
    const recipeB = ARMOR_ASSEMBLIES[0];
    const interiorId = addInstance(assembled, assembled.instances, recipeB.interior, 100);
    const exteriorId = addInstance(assembled, assembled.instances, recipeB.exterior, 100);
    const upgraded = executeCharacterCommand(assembled, { type: 'assemble-armor', interiorId, exteriorId });
    const item = Object.values(upgraded.instances).find(entry => entry.itemId === recipeB.output)!;
    expect(upgraded.history.bestCraftedQuality[recipeB.output]).toBe(item.quality);
    expect(upgraded.history.crafting[`upgrade:${recipeB.output}`]).toEqual({ attempts: '1', successes: '1', produced: '1', bonusProduced: '0' });
  });

  it('separates mined items, direct uses, marrow absorption and trade from crafted output', () => {
    const siteId = MINING_SITE_IDS[0];
    const site = MINING_SITES[siteId];
    let state = executeDebugCommand(initial(), { type: 'travel', locationId: site.location });
    state = executeCharacterCommand(state, { type: 'gather', siteId });
    vi.spyOn(numbers, 'random').mockReturnValue(0);
    state = advanceCharacter(state, state.gathering!.cycleSeconds * 1000);
    expect(state.history.mining[siteId]).toEqual({ cycles: '1', successes: '1' });
    expect(state.history.gathered[site.itemId]).toBe('1');
    expect(state.history.crafting).toEqual({});
    const foodId = Object.keys(ITEMS).find(id => ITEMS[id].kind === 'food')!;
    state.inventory[foodId] = '2';
    state = executeCharacterCommand(state, { type: 'use', itemId: foodId, quantity: 2 });
    expect(state.history.used[foodId]).toBe('2');
    state = executeDebugCommand(state, { type: 'realm', level: FOUNDATION_LEVEL });
    const marrowId = Object.keys(ITEMS).find(id => ITEMS[id].kind === 'marrow')!;
    state.inventory[marrowId] = '3';
    state = executeCharacterCommand(state, { type: 'absorb-marrow' });
    expect(state.history.absorbedMarrow[marrowId]).toBe('3');
    expect(state.history.used[marrowId]).toBeUndefined();

    state = executeCharacterCommand(state, { type: 'travel', locationId: initial().locationId });
    const moneyBefore = BigInt(state.money);
    const quantity = 2;
    state = executeCharacterCommand(state, { type: 'sell', shopId: 'village-stall',
      target: { kind: 'stack', itemId: 'copper-coin' }, quantity });
    expect(BigInt(state.history.saleEarned)).toBe(BigInt(state.money) - moneyBefore);
    state.money = '1000000';
    const paidFrom = BigInt(state.money);
    state = executeCharacterCommand(state, { type: 'buy', shopId: 'village-stall',
      target: { kind: 'stack', itemId: 'copper-coin' }, quantity });
    expect(BigInt(state.history.purchaseSpent)).toBe(paidFrom - BigInt(state.money));
    expect(state.history.bestCraftedQuality).toEqual({});
  });

  it('records first real arrivals and promotions, but not map browsing or debug skips', () => {
    const state = initial();
    const regionId = getCharacterView(state).regions.find(region => region.arrivable)!.id;
    expect(state.history.firstVisits[regionId]).toBeUndefined();
    const arrived = executeCharacterCommand(state, { type: 'arrive', regionId });
    expect(arrived.history.firstVisits[regionId]).toEqual({ at: 0, level: 0, life: '1' });
    const later = advanceCharacter(arrived, 1000);
    const back = executeCharacterCommand(later, { type: 'travel', locationId: state.locationId });
    const again = executeCharacterCommand(back, { type: 'arrive', regionId });
    expect(again.history.firstVisits[regionId]).toEqual(arrived.history.firstVisits[regionId]);
    const skipped = executeDebugCommand(state, { type: 'realm', level: FOUNDATION_LEVEL });
    expect(skipped.history.testAssisted).toBe(true);
    expect(skipped.history.firstRealms).toEqual(state.history.firstRealms);
    const completed = executeDebugCommand(state, { type: 'region', regionId, operation: 'complete' });
    expect(completed.history.firstClears).toEqual({});
    expect(completed.history.kills).toEqual({});
    const insightId = Object.keys(ITEMS).find(id => ITEMS[id].kind === 'insight')!;
    state.inventory[insightId] = '1';
    const promoted = executeCharacterCommand(state, { type: 'use', itemId: insightId, quantity: 1 });
    expect(promoted.level).toBeGreaterThan(state.level);
    expect(promoted.history.firstRealms[String(promoted.level)]).toEqual({ at: 0, level: promoted.level, life: '1' });
    expect(promoted.history.testAssisted).toBe(false);
  });

  it('rejects incompatible, inconsistent, rolled-back and rewritten history', () => {
    const state = initial();
    const old = { ...state, schemaVersion: 'neko-character-4' };
    expect(() => readCharacter(old)).toThrow();
    const missing: Record<string, unknown> = { ...state };
    delete missing.history;
    expect(() => readCharacter(missing)).toThrow();
    const before = structuredClone(state.history);
    before.withdrawals = '2';
    before.testAssisted = true;
    expect(() => checkHistoryProgress(before, state.history)).toThrow('履历记录发生回退');
    const changed = structuredClone(before);
    changed.firstVisits[state.locationId].at++;
    expect(() => checkHistoryProgress(before, changed)).toThrow('首次经历');
    expect(() => checkHistoryProgress(before, structuredClone(before))).not.toThrow();
    const siteId = MINING_SITE_IDS[0];
    state.history.mining[siteId] = { cycles: '1', successes: '2' };
    expect(() => readCharacter(state)).toThrow('Invalid mining history');
  });
});
