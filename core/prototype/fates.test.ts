import { afterEach, describe, expect, it, vi } from 'vitest';
import * as numbers from '../numbers';
import { createCharacter, readCharacter, synchronizeCharacter } from './character-state';
import { executeCharacterCommand, getCharacterView } from './character';
import { drawFate, FATES, FATE_IDS, FATE_TIERS, FATE_TIER_IDS, fateSource } from './fates';
import { getPlayerStats, pauseSimulationUntil } from './simulation';
import { sourceSchema } from './types';

afterEach(() => vi.restoreAllMocks());

describe('fate identity and source contracts', () => {
  it('draws a weighted tier first and uses equal intervals for every fate within that tier', () => {
    const random = vi.spyOn(numbers, 'random');
    const total = FATE_TIER_IDS.reduce((sum, id) => sum + FATE_TIERS[id].weight, 0);
    let start = 0;
    for (const tier of FATE_TIER_IDS) {
      const weight = FATE_TIERS[tier].weight;
      const pool = FATE_IDS.filter(id => FATES[id].tier === tier);
      expect(weight).toBeGreaterThan(0);
      expect(pool.length).toBeGreaterThan(0);
      for (const [index, id] of pool.entries()) {
        for (const tierRoll of [start / total, (start + weight - 0.000001) / total]) {
          for (const itemRoll of [(index + 0.000001) / pool.length, (index + 0.999999) / pool.length]) {
            random.mockReset().mockReturnValueOnce(tierRoll).mockReturnValueOnce(itemRoll);
            expect(drawFate({ rng: 19 })).toBe(id);
            expect(random).toHaveBeenCalledTimes(2);
          }
        }
      }
      start += weight;
    }
  });

  it('binds every drawn identity to exactly one validated source and starts with its resolved full health', () => {
    const random = vi.spyOn(numbers, 'random');
    const total = FATE_TIER_IDS.reduce((sum, id) => sum + FATE_TIERS[id].weight, 0);
    let start = 0;
    for (const tier of FATE_TIER_IDS) {
      const pool = FATE_IDS.filter(id => FATES[id].tier === tier);
      for (const [index, id] of pool.entries()) {
        random.mockReset()
          .mockReturnValueOnce((start + FATE_TIERS[tier].weight / 2) / total)
          .mockReturnValueOnce((index + 0.5) / pool.length);
        const state = createCharacter(0, 19);
        expect(state.fateId).toBe(id);
        const source = sourceSchema.parse(fateSource(id));
        expect(state.simulation.player.sources.filter(entry => entry.id.startsWith('fate:'))).toEqual([source]);
        expect(state.simulation.player.hp).toBe(getPlayerStats(state.simulation).maxHp);
        expect(getCharacterView(state, 0).fate).toEqual({
          id, name: FATES[id].name, tier, tierName: FATE_TIERS[tier].name, description: FATES[id].description,
          effectDescription: FATES[id].effectDescription,
        });
        const restored = readCharacter(JSON.parse(JSON.stringify(state)));
        synchronizeCharacter(restored);
        expect(restored).toEqual(state);
        expect(random).toHaveBeenCalledTimes(2);
      }
      start += FATE_TIERS[tier].weight;
    }
  });

  it('persists the post-draw random state and never draws on reads, commands or offline pauses', () => {
    const rng = { rng: 19 };
    const expectedId = drawFate(rng);
    const state = createCharacter(0, 19);
    expect(state.fateId).toBe(expectedId);
    expect(state.simulation.rng).toBe(rng.rng);
    expect(rng.rng).not.toBe(19);
    const random = vi.spyOn(numbers, 'random');
    let restored = readCharacter(JSON.parse(JSON.stringify(state)));
    restored = executeCharacterCommand(restored, { type: 'recover', mode: 'sleep' });
    restored.simulation = pauseSimulationUntil(restored.simulation, 60000);
    synchronizeCharacter(restored);
    expect(getCharacterView(restored, 0).fate.id).toBe(expectedId);
    expect(readCharacter(restored).simulation.rng).toBe(rng.rng);
    expect(random).not.toHaveBeenCalled();
  });

  it('rejects missing identities and forged sources instead of repairing or rerolling saves', () => {
    const state = createCharacter(0, 19);
    const { fateId: _id, ...missing } = structuredClone(state);
    expect(() => readCharacter(missing)).toThrow();
    expect(() => readCharacter({ ...state, fateId: 'not-in-the-catalog' })).toThrow();
    const forged = structuredClone(state);
    const source = forged.simulation.player.sources.find(entry => entry.id === fateSource(state.fateId).id)!;
    source.modifiers = [];
    forged.simulation.player.hp = '0';
    expect(() => readCharacter(forged)).toThrow('Character stats are not settled');
    expect(source.modifiers).toEqual([]);
  });
});
