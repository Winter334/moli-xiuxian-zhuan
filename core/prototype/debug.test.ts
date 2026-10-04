import { describe, expect, it } from 'vitest';
import { createCharacter, readCharacter } from './character-state';
import { executeDebugCommand } from './debug';
import { FOUNDATION_LEVEL } from './growth';
import { FATE_IDS } from './fates';
import { MANUAL_IDS, MANUALS, SKILLS, masteryProgress, threshold } from './skills';
import { checkProgress, type ClientSave } from '../../shared/client-save';
import { exactAdd } from '../numbers';

const save = (character: ReturnType<typeof createCharacter>): ClientSave =>
  ({ format: 'opening-client-2', tradeRevision: '0', character, playedMs: 0 });

describe('test controls preserve character contracts', () => {
  it('replaces only the current fate without a test marker and requires explicit administrator authorization', () => {
    const before = createCharacter(0, 19);
    const fateId = FATE_IDS.find(id => id !== before.fateId)!;
    const after = executeDebugCommand(before, { type: 'fate', fateId });
    expect(readCharacter(after).fateId).toBe(fateId);
    for (const key of ['life', 'skills', 'cultivation', 'inventory', 'equipment', 'marrow'] as const) expect(after[key]).toEqual(before[key]);
    expect(after.simulation.rng).toBe(before.simulation.rng);
    expect(after.history.testAssisted).toBe(false);
    expect(before.history.testAssisted).toBe(false);
    expect(() => checkProgress(save(before), save(after), 0, 0)).toThrow('本世气运不一致');
    expect(() => checkProgress(save(before), save(after), 0, 0, true)).not.toThrow();
    const marked = structuredClone(after);
    marked.history.testAssisted = true;
    expect(() => checkProgress(save(before), save(marked), 0, 0)).toThrow('本世气运不一致');
    const cleared = executeDebugCommand(marked, { type: 'clear-test-marker' });
    expect(cleared.history.testAssisted).toBe(false);
    expect(marked.history.testAssisted).toBe(true);
    expect(() => checkProgress(save(marked), save(cleared), 0, 0)).toThrow('履历记录发生回退');
    expect(() => checkProgress(save(marked), save(cleared), 0, 0, true)).not.toThrow();
    marked.history.withdrawals = '1';
    expect(() => checkProgress(save(marked), save(cleared), 0, 0, true)).toThrow('履历记录发生回退');
  });

  it('keeps foundation roots, adds insight, obtains prerequisites and retains post-cap cumulative skill progress', () => {
    let state = executeDebugCommand(createCharacter(0, 19), { type: 'realm', level: FOUNDATION_LEVEL, root: 'heaven' });
    expect(state.foundationRoot).toBe('heaven');
    expect(() => executeDebugCommand(state, { type: 'realm', level: FOUNDATION_LEVEL + 1, root: 'human' })).toThrow('根基不能更换');
    state = executeDebugCommand(state, { type: 'insight', amount: '0.25' });
    expect(state.marrowInsight).toBe('0.25');
    const manualId = MANUAL_IDS[0];
    state = executeDebugCommand(state, { type: 'learn-skill', skillId: manualId });
    expect(state.skills[manualId]?.level).toBe(0);
    expect(state.simulation.clearedGroups[MANUALS[manualId].prerequisite]).toBeDefined();
    expect(state.activeManual).toBeUndefined();
    state = executeDebugCommand(state, { type: 'skill', skillId: manualId, level: SKILLS[manualId].max });
    const xp = state.skills[manualId]!.xp;
    state = executeDebugCommand(state, { type: 'skill-xp', skillId: manualId, amount: '0.25' });
    expect(state.skills[manualId]).toEqual({ level: SKILLS[manualId].max, xp: exactAdd(xp, '0.25') });
    const inheritedMastery = masteryProgress(state.skills, 'manual-mastery');
    expect(state.skills['manual-mastery']).toBeUndefined();
    state = executeDebugCommand(state, { type: 'skill-xp', skillId: 'manual-mastery', amount: '0.25' });
    expect(state.skills['manual-mastery']?.xp).toBe(exactAdd(inheritedMastery.xp, '0.25'));
    expect(state.skills['weapon-mastery']).toBeUndefined();
    state = executeDebugCommand(state, { type: 'skill', skillId: 'weapon-mastery', level: 1 });
    expect(state.skills['weapon-mastery']).toEqual({ level: 1, xp: threshold('weapon-mastery', 1) });
    expect(() => readCharacter(state)).not.toThrow();
  });
});
