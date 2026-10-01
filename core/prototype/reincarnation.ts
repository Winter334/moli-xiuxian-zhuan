import { integerAdd } from '../numbers';
import { createCharacter, readCharacter, record, type CharacterState } from './character-state';

// Start from the normal opening so new life-specific fields reset by default.
export function reincarnateCharacter(ending: CharacterState, now: number, seed: number): CharacterState {
  const previous = readCharacter(ending);
  const next = createCharacter(Math.max(now, previous.simulation.clockMs), seed);
  next.life = { number: integerAdd(previous.life.number, 1), startedAt: next.simulation.clockMs };
  next.history = structuredClone(previous.history);
  record(next, `轮回已定，开启第${next.life.number}世`);
  return readCharacter(next);
}
