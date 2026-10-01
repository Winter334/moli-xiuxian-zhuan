import { afterEach, describe, expect, it, vi } from 'vitest';
import * as numbers from '../numbers';
import { dec } from '../numbers';
import { advanceCharacter, executeCharacterCommand, getCharacterView, rollLoot } from './character';
import { addInstance, createCharacter, gainCharacterExperience, gainCharacterSkill, readCharacter, synchronizeCharacter } from './character-state';
import { combatPower } from './combat-power';
import { FOOD_EFFECTS, ITEMS, RECIPES } from './content';
import { executeDebugCommand } from './debug';
import { damageValue, modifyValue, regeneration } from './effects';
import { craftingRates } from './economy';
import { MINING_SITES } from './gathering';
import { gainSkill, initialSkills } from './skills';
import { advanceSimulation, createSimulation, pauseSimulationUntil, readSimulation, startEncounter, updatePlayerStats, withdraw } from './simulation';
import { BASE_STATS, resolveStats } from './stats';
import type { EffectModifier, StatSource } from './types';
import { checkProgress, type ClientSave } from '../../shared/client-save';
import { checkReservedCapacity, reserveTrade } from '../../src/trade-reservation';

const gearId = Object.keys(ITEMS).find(id => ITEMS[id].slot === 'head')!;
const originalGear = ITEMS[gearId];
const originalSite = MINING_SITES['azure-vein'];
afterEach(() => { ITEMS[gearId] = originalGear; MINING_SITES['azure-vein'] = originalSite; vi.restoreAllMocks(); });
function endowed(modifiers: EffectModifier[]) {
  ITEMS[gearId] = { ...originalGear, fixedStats: { modifiers } };
  const state = createCharacter(0, 19);
  state.equipment.head = addInstance(state, state.instances, gearId, 100);
  synchronizeCharacter(state);
  return state;
}
const increase = (target: EffectModifier['target'], value: string): EffectModifier =>
  ({ target, operation: 'increase', value: dec(value).toFixed() });
const source = (...modifiers: EffectModifier[]): StatSource => ({ id: 'contract-source', modifiers });
const saved = (character: ReturnType<typeof createCharacter>): ClientSave =>
  ({ format: 'opening-client-2', tradeRevision: '0', playedMs: 0, character });

describe('shared effect settlement contracts', () => {
  it('combines declared groups, scales source deltas once and resolves joint periods for normal power', () => {
    const manual: StatSource = {
      id: 'contract-manual', tags: ['manual'], multiplier: { attack: '1.1', maxHp: '0.75' },
      statPolarity: { multiplier: { attack: 'benefit', maxHp: 'cost' } },
    };
    const effects = source(
      { ...increase('source.benefit', '.2'), tags: ['manual'] },
      { ...increase('source.cost', '-.4'), tags: ['manual'] },
      increase('stat.maxHp', '.1'),
    );
    expect(resolveStats({ ...BASE_STATS, maxHp: '100', attack: '10' }, [manual, effects]))
      .toMatchObject({ maxHp: '93.5', attack: '11.2' });
    expect(modifyValue('100', 'damage.dealt', [source(
      increase('damage.dealt', '.1'), increase('damage.dealt', '.2'),
      { ...increase('damage.dealt', '.5'), group: 'separate' },
    )])).toBe('195');
    const periodic = source(
      { target: 'damage.dealt', operation: 'multiply', value: '2', when: { everyBasicAttacks: 2 } },
      { target: 'damage.dealt', operation: 'multiply', value: '3', when: { everyBasicAttacks: 2 } },
      { ...increase('damage.dealt', '99'), when: { hpAtMost: '0.5' } },
    );
    expect(modifyValue('100', 'damage.dealt', [periodic], { normalPower: true })).toBe('350');
    expect(damageValue('0', 'damage.dealt', [source({ target: 'damage.dealt', operation: 'flat', value: '99' })], {})).toBe('0');
    const state = endowed([increase('damage.dealt', '.2')]);
    state.marrow.attack = '100';
    synchronizeCharacter(state);
    const boosted = combatPower(state);
    ITEMS[gearId] = { ...originalGear, fixedStats: {} };
    expect(dec(boosted).gt(combatPower(state))).toBe(true);
  });

  it('persists attack attempts through misses, withdrawal and pause and checks low health before every hit', () => {
    const modifiers = [source(
      { ...increase('damage.dealt', '1'), when: { everyBasicAttacks: 2 } },
      { ...increase('damage.taken', '-.5'), when: { hpAtMost: '0.5' } },
    )];
    let state = createSimulation({ clockMs: 0, seed: 19,
      base: { ...BASE_STATS, maxHp: '1000', attack: '10', agility: '0' }, sources: modifiers });
    const target = { id: 'contract-enemy', stats: { ...BASE_STATS, maxHp: '10000', attack: '10', agility: '1' },
      abilities: { strikes: 2 as const } };
    state.player.hp = '505';
    state = startEncounter(state, { regionId: 'contract-region', enemies: [target] }).state;
    vi.spyOn(numbers, 'random').mockReturnValue(.5);
    const result = advanceSimulation(state, 1000);
    const strikes = result.events.filter(event => event.kind === 'strike');
    expect(strikes[0]).toMatchObject({ side: 'player', hit: false, damage: '0' });
    expect(strikes.slice(1).map(event => event.kind === 'strike' && event.damage)).toEqual(['10', '5']);
    expect(result.state.actionCounts.basicAttack).toBe('1');
    state = withdraw(result.state);
    state = pauseSimulationUntil(readSimulation(JSON.parse(JSON.stringify(state))), 100000);
    expect(state.actionCounts.basicAttack).toBe('1');
    state.player.base.agility = '1000000';
    state = startEncounter(state, { regionId: 'contract-region', enemies: [target] }).state;
    const next = advanceSimulation(state, 101000);
    expect(next.events.find(event => event.kind === 'strike' && event.side === 'player')).toMatchObject({ damage: '20' });
    expect(next.state.actionCounts.basicAttack).toBe('2');
    const before = createCharacter(0, 19);
    before.simulation.actionCounts.basicAttack = '2';
    const after = structuredClone(before);
    after.simulation.actionCounts.basicAttack = '1';
    expect(() => checkProgress(saved(before), saved(after), 0, 0)).toThrow('成长进度');
  });

  it('amplifies positive recovery without amplifying simultaneous upkeep or health rebasing', () => {
    const base = { ...BASE_STATS, maxHp: '1000' };
    const sources: StatSource[] = [
      { id: 'recovery', flat: { hpRegen: '100' } },
      { id: 'upkeep', flat: { hpRegen: '-80', hpRegenPercent: '-0.01' } },
      source(increase('healing.received', '.5')),
    ];
    const stats = resolveStats(base, sources);
    expect(regeneration(base, sources, stats)).toBe('60');
    let state = createSimulation({ clockMs: 0, seed: 19, base, sources, hp: '100' });
    state.mode = 'idle';
    expect(advanceSimulation(state, 1000).state.player.hp).toBe('160');
    state.mode = 'rest';
    expect(advanceSimulation(state, 1000).state.player.hp).toBe('190');
    expect(updatePlayerStats(state, { base: { ...base, maxHp: '1100' } }).state.player.hp).toBe('200');
  });

  it('shares recipe and medicine previews with execution while separating fixed rewards and proficiency', () => {
    let state = endowed([
      increase('experience.skill', '.2'), { ...increase('experience.skill', '.3'), tags: ['weapon'] },
      increase('experience.cultivation', '.5'),
      { ...increase('duration', '.1'), tags: ['supply', 'benefit'] },
      { ...increase('duration', '-.2'), tags: ['supply', 'cost'] },
      increase('craft.success', '.1'),
    ]);
    const skills = initialSkills();
    gainSkill(skills, 'unarmed', '10', 0, undefined, state.simulation.player.sources);
    gainSkill(skills, 'refining', '10', 0, undefined, state.simulation.player.sources);
    expect(skills.unarmed.xp).toBe('15');
    expect(skills.refining.xp).toBe('12');
    expect(gainCharacterExperience(state, '1').earned).toBe('1');
    expect(gainCharacterExperience(state, '1', undefined, true, ['activity', 'kill']).earned).toBe('1.5');
    const medicine = Object.keys(ITEMS).find(id => ITEMS[id].foodEffects?.some(effect => FOOD_EFFECTS[effect].polarity === 'cost') &&
      ITEMS[id].foodEffects?.some(effect => FOOD_EFFECTS[effect].polarity === 'benefit'))!;
    state.inventory[medicine] = '2';
    const positive = ITEMS[medicine].foodEffects!.find(id => FOOD_EFFECTS[id].polarity === 'benefit')!;
    const negative = ITEMS[medicine].foodEffects!.find(id => FOOD_EFFECTS[id].polarity === 'cost')!;
    const positiveTime = dec(FOOD_EFFECTS[positive].durationMs).mul('1.1').ceil().toNumber();
    const negativeTime = dec(FOOD_EFFECTS[negative].durationMs).mul('0.8').ceil().toNumber();
    const preview = getCharacterView(state);
    expect(preview.inventory.find(item => item.itemId === medicine)!.use!.description).toContain(`${positiveTime / 1000}秒`);
    state = executeCharacterCommand(state, { type: 'use', itemId: medicine, quantity: 1 });
    expect(state.simulation.effects.find(effect => effect.id === positive)!.expiresAt).toBe(positiveTime);
    expect(state.simulation.effects.find(effect => effect.id === negative)!.expiresAt).toBe(negativeTime);
    state = executeCharacterCommand(state, { type: 'use', itemId: medicine, quantity: 1 });
    expect(state.simulation.effects.find(effect => effect.id === positive)!.expiresAt).toBe(positiveTime * 2);
    const [recipeId, recipe] = Object.entries(RECIPES).find(([, recipe]) => recipe.path === 'ordinary')!;
    expect(getCharacterView(state).recipes.find(recipe => recipe.id === recipeId)!.successChance)
      .toBe(craftingRates(state, recipe).successChance);
    expect(() => readCharacter(JSON.parse(JSON.stringify(state)))).not.toThrow();
  });

  it('commits one attempt with actual bonus output and keeps fixed loot and reserved assets separate', () => {
    const state = endowed([{ target: 'craft.extra-batch', operation: 'flat', value: '1' }]);
    const [recipeId, recipe] = Object.entries(RECIPES).find(([, recipe]) =>
      recipe.path === 'ordinary' && (recipe.outputCount ?? 1) > 1)!;
    for (const [id, count] of Object.entries(recipe.materials)) state.inventory[id] = String(count);
    vi.spyOn(numbers, 'random').mockReturnValue(0);
    const crafted = executeCharacterCommand(state, { type: 'craft', recipeId, quantity: 1 });
    const endowedGear = ITEMS[gearId];
    ITEMS[gearId] = { ...originalGear, fixedStats: {} };
    const neutral = structuredClone(state);
    synchronizeCharacter(neutral);
    const ordinary = executeCharacterCommand(neutral, { type: 'craft', recipeId, quantity: 1 });
    ITEMS[gearId] = endowedGear;
    expect(crafted.skills).toEqual(ordinary.skills);
    for (const id of Object.keys(recipe.materials)) expect(crafted.inventory[id]).toBe(ordinary.inventory[id]);
    const batch = recipe.outputCount!;
    expect(crafted.history.crafting[`recipe:${recipeId}`]).toEqual({
      attempts: '1', successes: '1', produced: String(batch * 2), bonusProduced: String(batch),
    });
    expect(crafted.inventory[recipe.output]).toBe(String(batch * 2));
    const malformed = structuredClone(crafted);
    malformed.history.crafting[`recipe:${recipeId}`].bonusProduced = '0';
    expect(() => readCharacter(malformed)).toThrow('crafting history');
    const component = Object.values(RECIPES).find(recipe => recipe.path === 'component')!;
    expect(craftingRates(state, component)).toEqual({ successChance: '1', extraBatchChance: '0' });
    expect(rollLoot({ rng: 19 }, [
      { itemId: 'charcoal', chance: '1' }, { itemId: 'copper-coin', chance: '1', ignoreLuck: true },
    ], '1', '1', [source(increase('loot.quantity', '1'))])).toEqual({ charcoal: '2', 'copper-coin': '1' });
    const pending = reserveTrade({
      characterId: '00000000-0000-4000-8000-000000000001',
      requestId: '00000000-0000-4000-8000-000000000002',
      baseRevision: '0', shopId: 'market-supplies', save: saved(crafted),
      command: { type: 'claim', deliveryId: '00000000-0000-4000-8000-000000000003', quantity: 1 },
    }, '0', { kind: 'stack', itemId: recipe.output });
    crafted.inventory[recipe.output] = '1000000000000';
    expect(() => checkReservedCapacity(crafted, pending)).toThrow();
    expect(state.inventory[recipe.output]).toBeUndefined();
  });

  it('retains fractional mining work across sliced saves and pauses without extra per-cycle proficiency', () => {
    let state = endowed([{ ...increase('activity.speed', '.1'), tags: ['mining'] }]);
    const siteId = 'azure-vein';
    MINING_SITES[siteId] = { ...originalSite, seconds: [8, 8] };
    state = executeDebugCommand(state, { type: 'travel', locationId: MINING_SITES[siteId].location });
    state.skills.mining = { level: 0, xp: '0' };
    synchronizeCharacter(state);
    state = executeCharacterCommand(state, { type: 'gather', siteId });
    const view = getCharacterView(state).miningSites.find(site => site.id === siteId)!;
    expect(view.cycleSeconds).toBeCloseTo(8 / 1.1);
    const once = advanceCharacter(state, 80000);
    let sliced = advanceCharacter(state, 13000);
    expect(sliced.gathering!.elapsed).toBe('6.3');
    sliced = readCharacter(JSON.parse(JSON.stringify(sliced)));
    sliced = advanceCharacter(sliced, 80000);
    expect(sliced).toEqual(once);
    expect(once.history.mining[siteId].cycles).toBe('11');
    const expected = structuredClone(state);
    for (let cycle = 0; cycle < 11; cycle++) gainCharacterSkill(expected, 'mining', MINING_SITES[siteId].xp);
    expect(once.skills.mining).toEqual(expected.skills.mining);
    expect(once.gathering!.elapsed).toBe('0');
    const paused = structuredClone(once);
    paused.simulation = pauseSimulationUntil(paused.simulation, 180000);
    expect(paused.gathering).toEqual(once.gathering);
    expect(paused.history).toEqual(once.history);
    expect(() => readCharacter({ ...once, schemaVersion: 'neko-character-5' })).toThrow();
    expect(() => readSimulation({ ...once.simulation, kernelVersion: 'neko-kernel-4' })).toThrow();
  });
});
