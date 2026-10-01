import { expect, it } from 'vitest';
import { dec } from '../numbers';
import { executeCharacterCommand } from './character';
import { createCharacter, gainCharacterExperience, readCharacter, record } from './character-state';
import { ITEMS } from './content';
import { executeDebugCommand } from './debug';
import { FOUNDATION_LEVEL, killExperience, killExperienceRealmFactor, realmAt } from './growth';
import { describeLogGain, describeRealmFactor, RECENT_LOG_LIMIT } from './log';
import { MANUAL_IDS, MANUALS } from './skills';

it('bounds saved recent logs with the same limit as snapshot validation', () => {
  const state = createCharacter(0, 19);
  for (let index = 0; index < RECENT_LOG_LIMIT + 3; index++) record(state, `record ${index}`);
  expect(state.log).toHaveLength(RECENT_LOG_LIMIT);
  expect(state.log[0].message).toBe('record 3');
  expect(readCharacter(JSON.parse(JSON.stringify(state))).log).toEqual(state.log);
  expect(() => readCharacter({ ...state, log: [...state.log, state.log[0]] })).toThrow();
});

it('uses the settlement realm factor to describe bonuses, penalties and equal-realm rewards', () => {
  for (const [enemyRealm, playerLevel, label] of [[2, 0, '越级增益'], [0, 3, '低阶减益'], [2, 3, '无境界差修正']] as const) {
    const factor = killExperienceRealmFactor(enemyRealm, playerLevel);
    expect(killExperience('1', enemyRealm, playerLevel, 1)).toBe(factor);
    expect(describeRealmFactor(factor)).toContain(label);
  }
  expect(describeLogGain('修为', '0.0000004')).not.toBe('修为+0');
});

it('reports credited cultivation separately from overflow without changing the cap', () => {
  const state = createCharacter(0, 19);
  state.level = FOUNDATION_LEVEL - 1;
  const cap = realmAt(FOUNDATION_LEVEL).entryCost;
  state.cultivation = dec(cap).minus(2).toFixed();
  const reward = gainCharacterExperience(state, '10');
  expect(reward).toMatchObject({ earned: '10', credited: '2', changed: false });
  expect(state.cultivation).toBe(cap);
  expect(gainCharacterExperience(state, '10').credited).toBe('0');
  const growing = createCharacter(0, 19);
  const promotion = gainCharacterExperience(growing, realmAt(1).entryCost);
  expect(promotion.credited).toBe(realmAt(1).entryCost);
  expect(growing.level).toBe(1);
});

it('summarizes a marrow batch from its applied permanent gains instead of the final combat panel', () => {
  let state = executeDebugCommand(createCharacter(0, 19), { type: 'travel', locationId: MANUALS[MANUAL_IDS[0]].location });
  state = executeCharacterCommand(state, { type: 'learn-manual', manualId: MANUAL_IDS[0] });
  state = executeCharacterCommand(state, { type: 'activate-manual', manualId: MANUAL_IDS[0] });
  const itemId = Object.keys(ITEMS).find(id => ITEMS[id].kind === 'marrow')!;
  state.inventory[itemId] = '8';
  const after = executeCharacterCommand(state, { type: 'use', itemId, quantity: 8 });
  const message = after.log.at(-1)!.message;
  expect(message).toContain(`使用 ${ITEMS[itemId].name} ×8`);
  expect(message).toContain('灵髓积蕴');
  for (const key of ['attack', 'defense', 'agility', 'maxHp'] as const) {
    const gain = dec(after.marrow[key]).minus(state.marrow[key]);
    const label = { attack: '攻击', defense: '防御', agility: '敏捷', maxHp: '气血上限' }[key];
    if (gain.gt(0)) expect(message).toContain(describeLogGain(label, gain.toFixed()));
    else expect(message).not.toContain(`${label}+`);
  }
  expect(after.history.used[itemId]).toBe('8');
  expect(after.inventory[itemId]).toBeUndefined();
  expect(after.log).toHaveLength(state.log.length + 1);
});
