import { describe, expect, it } from 'vitest';
import {
  advanceCharacter, createCharacter, executeCharacterCommand, getCharacterView,
  INITIAL_CALENDAR_MINUTES, MINUTES_PER_DAY, pauseSimulationUntil, worldCalendarAt, WORLD_DAY_MS, WORLD_EPOCH_MS,
} from './index';
import { synchronizeCharacter } from './character-state';
import { SKILLS, threshold } from './skills';

describe('unified world calendar', () => {
  it('shares dates across creation times, meditation levels and paused encounters', () => {
    const first = createCharacter(WORLD_EPOCH_MS, 19);
    const later = createCharacter(WORLD_EPOCH_MS + WORLD_DAY_MS, 23);
    const meditating = executeCharacterCommand(first, { type: 'recover', mode: 'sleep' });
    meditating.skills.rest = { level: SKILLS.rest.max, xp: threshold('rest', SKILLS.rest.max) };
    synchronizeCharacter(meditating);
    const recovered = advanceCharacter(meditating, WORLD_EPOCH_MS + 1000);
    const regionId = getCharacterView(first).regions.find(region => region.enterable)!.id;
    const fighting = executeCharacterCommand(first, { type: 'enter', regionId });
    const now = WORLD_EPOCH_MS + WORLD_DAY_MS * 2;
    const paused = { ...fighting, simulation: pauseSimulationUntil(fighting.simulation, now) };
    for (const character of [first, later, recovered, paused]) {
      expect(getCharacterView(character, now).calendar).toEqual(worldCalendarAt(now));
    }
    expect(worldCalendarAt(now).dayIndex - worldCalendarAt(now - WORLD_DAY_MS).dayIndex).toBe(1);
    expect(recovered.skills.rest).toEqual(meditating.skills.rest);
    expect(recovered.simulation.player.sources).toEqual(meditating.simulation.player.sources);
    expect(recovered.simulation).not.toHaveProperty('calendarMinutes');
  });

  it('refreshes personal stock once per shared day without catch-up stock or rerolls on clock correction', () => {
    const first = executeCharacterCommand(createCharacter(WORLD_EPOCH_MS, 19),
      { type: 'visit-shop', shopId: 'village-stall' }, WORLD_EPOCH_MS);
    const boundary = WORLD_EPOCH_MS +
      (MINUTES_PER_DAY - INITIAL_CALENDAR_MINUTES % MINUTES_PER_DAY) * WORLD_DAY_MS / MINUTES_PER_DAY;
    expect(getCharacterView(first, boundary - 1).shop.refreshDue).toBe(false);
    expect(getCharacterView(first, boundary).shop.refreshDue).toBe(true);
    expect(executeCharacterCommand(first, { type: 'visit-shop', shopId: 'village-stall' }, boundary - 1)).toEqual(first);
    const next = executeCharacterCommand(first, { type: 'visit-shop', shopId: 'village-stall' }, boundary);
    expect(next.shop.dayIndex).toBe(first.shop.dayIndex! + 1);
    expect(getCharacterView(next, boundary).shop.refreshDue).toBe(false);
    expect(executeCharacterCommand(next, { type: 'visit-shop', shopId: 'village-stall' }, WORLD_EPOCH_MS)).toEqual(next);
    expect(getCharacterView(next, WORLD_EPOCH_MS).shop.refreshDue).toBe(false);
    const late = executeCharacterCommand(first, { type: 'visit-shop', shopId: 'village-stall' }, boundary + WORLD_DAY_MS * 10);
    expect(late.shop.inventory).toEqual(next.shop.inventory);
    expect(late.shop.instances).toEqual(next.shop.instances);
    expect(late.simulation.rng).toBe(next.simulation.rng);
    expect(late.shop.dayIndex).toBe(next.shop.dayIndex! + 10);
  });
});
