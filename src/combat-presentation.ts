import type { CharacterEvent } from '../core/prototype/character';

export interface CombatFrame {
  sequence: number;
  clockMs: number;
  receivedAt: number;
  paused: boolean;
  events: CharacterEvent[];
}

export const EMPTY_COMBAT_FRAME: CombatFrame = {
  sequence: 0, clockMs: 0, receivedAt: 0, paused: true, events: [],
};

export function combatFrame(previous: CombatFrame, clockMs: number, receivedAt: number,
  events: CharacterEvent[] = [], paused = false): CombatFrame {
  return {
    sequence: previous.sequence + 1, clockMs, receivedAt, paused,
    // Presentation never replays an accumulated combat history.
    events: paused ? [] : events.filter(entry => clockMs - entry.event.at <= 1000).slice(-32),
  };
}
