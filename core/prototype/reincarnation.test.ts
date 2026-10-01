import { describe, expect, it } from 'vitest';
import { createCharacter, gainCharacterExperience, readCharacter, synchronizeCharacter } from './character-state';
import { executeDebugCommand } from './debug';
import { markMilestone } from './history';
import { reincarnateCharacter } from './reincarnation';
import { checkProgress, type ClientSave } from '../../shared/client-save';

const save = (character: ReturnType<typeof createCharacter>): ClientSave =>
  ({ format: 'opening-client-2', tradeRevision: '0', playedMs: 0, character });

describe('life transition contracts', () => {
  it('resets to the normal opening and retains only lifetime history, including previous-life milestones', () => {
    let ending = createCharacter(0, 19);
    gainCharacterExperience(ending, '10000000');
    synchronizeCharacter(ending);
    ending = executeDebugCommand(ending, { type: 'travel', locationId: 'qingshi-village' });
    ending.furnaceTier = 4;
    ending.money = '10000';
    ending.inventory.charcoal = '100';
    ending.history.withdrawals = '4';
    const original = structuredClone(ending);
    const next = reincarnateCharacter(ending, 1000, 29);
    const opening = createCharacter(1000, 29);
    expect(next).toEqual({ ...opening, history: ending.history, life: { number: '2', startedAt: 1000 }, log: next.log });
    expect(next.history.testAssisted).toBe(true);
    expect(next.history.firstRealms[String(ending.level)]).toMatchObject({ life: '1' });
    expect(readCharacter(next)).toEqual(next);
    expect(ending).toEqual(original);
    expect(() => checkProgress(save(ending), save(next), 0, 1000)).toThrow('世次');
  });

  it('allows repeated immediate transitions, preserves old firsts and dates new milestones to the current life', () => {
    const second = reincarnateCharacter(createCharacter(0, 19), 0, 19);
    const third = reincarnateCharacter(second, 0, 19);
    expect(third.life).toEqual({ number: '3', startedAt: 0 });
    expect(third.history.firstVisits[third.locationId].life).toBe('1');
    expect(third.fateId).toBe(second.fateId);
    expect(() => checkProgress(save(second), save(third), 0, 0)).toThrow('世次');
    gainCharacterExperience(third, '10000000');
    synchronizeCharacter(third);
    expect(third.history.firstRealms[String(third.level)]?.life).toBe('3');
    const before = structuredClone(third.history.firstVisits[third.locationId]);
    markMilestone(third, 'firstVisits', third.locationId);
    expect(third.history.firstVisits[third.locationId]).toEqual(before);
    expect(readCharacter(third)).toEqual(third);
  });

  it('rejects missing life data, rewritten first-life identity and fabricated previous-life milestones', () => {
    const second = reincarnateCharacter(createCharacter(0, 19), 1000, 29);
    expect(() => readCharacter({ ...second, life: undefined })).toThrow();
    const changed = structuredClone(second);
    changed.history.firstVisits[changed.locationId] = { at: 1000, level: 0, life: '2' };
    expect(() => checkProgress(save(second), save(changed), 1000, 1000)).toThrow('首次经历');
    const forged = structuredClone(second);
    forged.history.firstRealms['1'] = { at: 0, level: 1, life: '1' };
    expect(() => readCharacter(forged)).not.toThrow();
    expect(() => checkProgress(save(second), save(forged), 1000, 1000)).toThrow('补写前世');
  });
});
