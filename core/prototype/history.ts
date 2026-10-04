import { z } from 'zod';
import { integerAdd } from '../numbers';
import type { CharacterState } from './character-state';
import { ARMOR_ASSEMBLIES, ASSEMBLIES, ENEMIES, ITEMS, RECIPES, REGIONS, SAFE_LOCATIONS } from './content';
import { MINING_SITES } from './gathering';
import { LEVEL_CAP } from './growth';
import { FISH } from './lake-activities';
import { countSchema } from './types';

const catalogKey = (catalog: object) => z.string().refine(id => Object.hasOwn(catalog, id));
const craftingSources = Object.fromEntries([
  ...Object.entries(RECIPES).map(([id, recipe]) =>
    [`recipe:${id}`, { output: recipe.output, quantity: recipe.path === 'ordinary' ? recipe.outputCount ?? 1 : 1,
      bonus: recipe.path === 'ordinary' }] as const),
  ...ASSEMBLIES.map(recipe => [`assemble:${recipe.output}`, { output: recipe.output, quantity: 1, bonus: false }] as const),
  ...ARMOR_ASSEMBLIES.map(recipe => [`upgrade:${recipe.output}`, { output: recipe.output, quantity: 1, bonus: false }] as const),
]);
const milestoneSchema = z.object({
  life: countSchema.refine(value => BigInt(value) > 0n),
  at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  level: z.number().int().min(0).max(LEVEL_CAP),
}).strict();
const counts = (catalog: object) => z.record(catalogKey(catalog), countSchema);
export const historySchema = z.object({
  testAssisted: z.boolean(),
  kills: counts(ENEMIES),
  defeats: countSchema,
  withdrawals: countSchema,
  crafting: z.record(catalogKey(craftingSources), z.object({
    attempts: countSchema, successes: countSchema, produced: countSchema, bonusProduced: countSchema,
  }).strict()),
  bestCraftedQuality: z.record(catalogKey(ITEMS), z.number().int().min(10).max(999)),
  mining: z.record(catalogKey(MINING_SITES), z.object({
    cycles: countSchema, successes: countSchema, produced: countSchema.optional(), secondaryProduced: countSchema.optional(),
  }).strict()),
  gathered: counts(ITEMS),
  used: counts(ITEMS),
  absorbedMarrow: counts(ITEMS),
  purchaseSpent: countSchema,
  saleEarned: countSchema,
  firstVisits: z.record(catalogKey({ ...SAFE_LOCATIONS, ...REGIONS }), milestoneSchema),
  firstClears: z.record(catalogKey(REGIONS), milestoneSchema),
  firstEncounters: z.record(catalogKey(ENEMIES), milestoneSchema),
  firstRealms: z.record(z.string().regex(/^(0|[1-9]\d*)$/).refine(id => Number(id) <= LEVEL_CAP), milestoneSchema),
}).strict();
export type CharacterHistory = z.infer<typeof historySchema>;

export function initialHistory(at: number): CharacterHistory {
  return {
    testAssisted: false, kills: {}, defeats: '0', withdrawals: '0',
    crafting: {}, bestCraftedQuality: {}, mining: {}, gathered: {}, used: {}, absorbedMarrow: {},
    purchaseSpent: '0', saleEarned: '0',
    firstVisits: { 'qingshi-village': { at, level: 0, life: '1' } },
    firstClears: {}, firstEncounters: {}, firstRealms: { '0': { at, level: 0, life: '1' } },
  };
}

export function incrementRecord(counts: Record<string, string>, id: string, amount: string | number = 1) {
  counts[id] = integerAdd(counts[id] ?? '0', amount);
}

export function markMilestone(state: CharacterState, kind: 'firstVisits' | 'firstClears' | 'firstRealms' | 'firstEncounters', id: string, level = state.level) {
  state.history[kind][id] ??= { at: state.simulation.clockMs, level, life: state.life.number };
}

export function recordCraft(
  state: CharacterState, source: string, output: string, quantity: number, quality?: number, bonusProduced = 0,
) {
  const entry = state.history.crafting[source] ??= { attempts: '0', successes: '0', produced: '0', bonusProduced: '0' };
  entry.attempts = integerAdd(entry.attempts, 1);
  if (quantity === 0) return;
  entry.successes = integerAdd(entry.successes, 1);
  entry.produced = integerAdd(entry.produced, quantity);
  entry.bonusProduced = integerAdd(entry.bonusProduced, bonusProduced);
  if (quality !== undefined) {
    state.history.bestCraftedQuality[output] = Math.max(state.history.bestCraftedQuality[output] ?? 0, quality);
  }
}

export function validateHistory(state: CharacterState) {
  const history = state.history;
  const present = state.simulation.battle?.enemies.map(enemy => enemy.definition.id) ?? [];
  if ([...present, ...Object.keys(history.kills).filter(id => BigInt(history.kills[id]) > 0n)]
    .some(id => !history.firstEncounters[id])) throw new Error('Missing enemy encounter history');
  for (const [id, entry] of Object.entries(history.crafting)) {
    const definition = craftingSources[id];
    const base = BigInt(entry.successes) * BigInt(definition.quantity);
    const bonus = BigInt(entry.bonusProduced);
    if (BigInt(entry.successes) > BigInt(entry.attempts) ||
        BigInt(entry.produced) !== base + bonus || bonus > base ||
        bonus % BigInt(definition.quantity) !== 0n || (!definition.bonus && bonus !== 0n)) {
      throw new Error('Invalid crafting history');
    }
  }
  for (const id of Object.keys(history.bestCraftedQuality)) {
    if (!['equipment', 'part'].includes(ITEMS[id].kind) || !Object.entries(history.crafting)
      .some(([source, entry]) => craftingSources[source].output === id && BigInt(entry.produced) > 0n)) {
      throw new Error('Invalid crafted quality history');
    }
  }
  const gathered: Record<string, string> = {};
  for (const [id, entry] of Object.entries(history.mining)) {
    if (BigInt(entry.successes) > BigInt(entry.cycles)) throw new Error('Invalid mining history');
    const produced = entry.produced ?? entry.successes;
    const max = id === 'north-willow-grove' ? 3n : 1n;
    if (BigInt(produced) < BigInt(entry.successes) || BigInt(produced) > BigInt(entry.successes) * max) {
      throw new Error('Invalid gathering quantity history');
    }
    incrementRecord(gathered, MINING_SITES[id as keyof typeof MINING_SITES].itemId, produced);
    if (id === 'brokenplain-marrow-seam') {
      if (entry.secondaryProduced === undefined || entry.successes !== entry.cycles ||
          BigInt(entry.secondaryProduced) > BigInt(entry.cycles)) throw new Error('Invalid dual-output mining history');
      incrementRecord(gathered, 'stellar-marrow', entry.secondaryProduced);
    } else if (entry.secondaryProduced !== undefined) throw new Error('Unexpected secondary mining history');
  }
  for (const id of new Set([...Object.keys(gathered), ...Object.keys(history.gathered)])) {
    if (FISH.some(fish => fish.id === id) || id === 'condensed-gel-hilt') continue;
    if (BigInt(gathered[id] ?? '0') !== BigInt(history.gathered[id] ?? '0')) throw new Error('Invalid gathered item history');
  }
  if (Object.keys(history.used).some(id => !['food', 'insight', 'foundation-pill', 'meditation-kit', 'marrow'].includes(ITEMS[id].kind)) ||
      Object.keys(history.absorbedMarrow).some(id => ITEMS[id].kind !== 'marrow')) throw new Error('Invalid item use history');
  for (const kind of ['firstVisits', 'firstClears', 'firstRealms', 'firstEncounters'] as const) {
    for (const [id, milestone] of Object.entries(history[kind])) {
      const currentLife = milestone.life === state.life.number;
      if (milestone.at > state.simulation.clockMs || BigInt(milestone.life) > BigInt(state.life.number) ||
          (currentLife ? milestone.at < state.life.startedAt || milestone.level > state.level
            : milestone.at > state.life.startedAt) ||
          (kind === 'firstRealms' && Number(id) !== milestone.level) ||
          (currentLife && kind === 'firstClears' && BigInt(state.simulation.clearedGroups[id] ?? '0') < BigInt(REGIONS[id].groups))) {
        throw new Error('Invalid milestone history');
      }
    }
  }
}

export function checkHistoryProgress(before: CharacterHistory, after: CharacterHistory, allowTestMarkerClear = false) {
  function monotonic(previous: object, next: object) {
    for (const [key, value] of Object.entries(previous)) {
      const current = (next as Record<string, unknown>)[key];
      if (current === undefined) throw new Error('履历记录发生回退');
      if (typeof value === 'object' && value !== null) {
        if (typeof current !== 'object' || current === null) throw new Error('履历记录发生回退');
        monotonic(value, current);
      } else if (typeof value === 'boolean' ? value && !current : BigInt(current as string | number) < BigInt(value)) {
        throw new Error('履历记录发生回退');
      }
    }
  }
  const { firstVisits, firstClears, firstRealms, firstEncounters, testAssisted, ...counters } = before;
  if (testAssisted && !after.testAssisted && !allowTestMarkerClear) throw new Error('履历记录发生回退');
  monotonic(counters, after);
  for (const [kind, milestones] of Object.entries({ firstVisits, firstClears, firstRealms, firstEncounters })) {
    const next = after[kind as 'firstVisits' | 'firstClears' | 'firstRealms' | 'firstEncounters'];
    for (const [id, milestone] of Object.entries(milestones)) {
      if (next[id]?.at !== milestone.at || next[id]?.level !== milestone.level ||
          next[id]?.life !== milestone.life) throw new Error('首次经历不可改写或删除');
    }
  }
}
