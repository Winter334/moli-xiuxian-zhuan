import { expect, it } from 'vitest';
import { advanceCharacter, executeCharacterCommand, getCharacterView, type CharacterEvent } from './character';
import { createCharacter } from './character-state';

it('observes detached combat events without changing settlement or saved state', () => {
  const initial = createCharacter(0, 19);
  const regionId = getCharacterView(initial).regions.find(region => region.enterable)!.id;
  const events: CharacterEvent[] = [];
  const command = { type: 'enter' as const, regionId };
  const entered = executeCharacterCommand(initial, command, 0, events);
  expect(entered).toEqual(executeCharacterCommand(initial, command, 0));
  const next = advanceCharacter(entered, 2000, 1000, events);
  expect(next).toEqual(advanceCharacter(entered, 2000));
  const strike = events.find(entry => entry.event.kind === 'strike')!;
  expect(strike).toMatchObject({ life: initial.life.number, regionId, group: '0' });
  expect(strike.event.at).toBeGreaterThan(0);
  const before = structuredClone(next);
  if (strike.event.kind === 'strike') strike.event.hpLost = '999999';
  expect(next).toEqual(before);
  expect(next).not.toHaveProperty('events');
});
