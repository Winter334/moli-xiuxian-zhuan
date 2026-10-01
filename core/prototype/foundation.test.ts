import { describe, expect, it } from 'vitest';
import { dec, text } from '../numbers';
import { checkProgress, readClientSave } from '../../shared/client-save';
import { executeCharacterCommand, getCharacterView } from './character';
import { addInstance, createCharacter, readCharacter, synchronizeCharacter } from './character-state';
import { FOUNDATION, ITEMS } from './content';
import { FOUNDATION_DIVINE_ART } from './divine-arts';
import { foundationBase, foundationBonus, FOUNDATION_ROOTS } from './foundation';
import { FOUNDATION_LEVEL, realmAt } from './growth';

const pills = Object.entries(ITEMS).filter(([, item]) => item.kind === 'foundation-pill');
const cost = realmAt(FOUNDATION_LEVEL).entryCost;
function ready() {
  const state = createCharacter(0, 19);
  state.level = FOUNDATION_LEVEL - 1;
  state.cultivation = cost;
  for (const [id] of pills) state.inventory[id] = '2';
  state.inventory[FOUNDATION.insightItemId] = '2';
  synchronizeCharacter(state);
  return readCharacter(state);
}
const saved = (character: ReturnType<typeof createCharacter>) =>
  readClientSave(JSON.parse(JSON.stringify({ format: 'opening-client-2', tradeRevision: '0', character, playedMs: 0 })));

describe('foundation pills', () => {
  it('requires the exact realm, full cultivation and one owned pill before spending anything', () => {
    for (const [itemId] of pills) {
      const low = createCharacter(0, 19);
      low.inventory[itemId] = '2';
      const short = ready();
      short.cultivation = text(dec(cost).minus('0.1'));
      const empty = ready();
      delete empty.inventory[itemId];
      for (const [state, quantity] of [[low, 1], [short, 1], [empty, 1], [ready(), 2]] as const) {
        const before = structuredClone(state);
        expect(() => executeCharacterCommand(state, { type: 'use', itemId, quantity })).toThrow();
        expect(state).toEqual(before);
      }
      expect(getCharacterView(short).inventory.find(item => item.itemId === itemId)!.use!.issue).not.toBeNull();
    }
  });

  it('promotes deterministically, stores one root and rejects further pills by realm', () => {
    for (const [itemId, item] of pills) {
      const before = ready();
      const after = executeCharacterCommand(before, { type: 'use', itemId, quantity: 1 });
      expect(after.level).toBe(FOUNDATION_LEVEL);
      expect(after.cultivation).toBe('0');
      expect(after.foundationRoot).toBe(item.foundationRoot);
      expect(after.inventory[itemId]).toBe('1');
      expect(after.inventory[FOUNDATION.insightItemId]).toBe(before.inventory[FOUNDATION.insightItemId]);
      expect(after.instances).toEqual(before.instances);
      expect(after.learnedDivineArts).toEqual([FOUNDATION_DIVINE_ART]);
      expect(after.activeDivineArt).toBeNull();
      expect(after.nextInstanceId).toBe(before.nextInstanceId);
      expect(after.simulation.rng).toBe(before.simulation.rng);
      expect(after.simulation.player.base).toEqual(foundationBase(FOUNDATION_LEVEL, item.foundationRoot!));
      expect(after.simulation.player.hp).toBe(getCharacterView(after).stats.maxHp);
      expect(getCharacterView(after).foundationName).toBe(FOUNDATION_ROOTS[item.foundationRoot!].name);
      expect(saved(after).character).toEqual(after);
      expect(() => checkProgress(saved(before), saved(after), 0, 1000)).not.toThrow();
      for (const [nextPill] of pills) {
        const original = structuredClone(after);
        expect(() => executeCharacterCommand(after, { type: 'use', itemId: nextPill, quantity: 1 })).toThrow('仅限炼气十二层');
        expect(after).toEqual(original);
      }
      const changed = structuredClone(after);
      changed.foundationRoot = item.foundationRoot === 'heaven' ? 'earth' : 'heaven';
      synchronizeCharacter(changed);
      expect(() => checkProgress(saved(after), saved(changed), 0, 1000)).toThrow('成长进度发生回退');
    }
  });

  it('adds only a fixed realm-base delta and rejects missing, mismatched or forged root snapshots', () => {
    const basis = realmAt(FOUNDATION_LEVEL).stats;
    for (const [itemId, item] of pills) {
      const state = ready();
      state.marrow = { attack: '12345', defense: '23456', agility: '34567', maxHp: '456789' };
      synchronizeCharacter(state);
      const weaponId = Object.keys(ITEMS).find(id => ITEMS[id].slot === 'weapon')!;
      const instanceId = addInstance(state, state.instances, weaponId, 100);
      const equipped = executeCharacterCommand(state, { type: 'equip', instanceId });
      const after = executeCharacterCommand(equipped, { type: 'use', itemId, quantity: 1 });
      const human = structuredClone(after);
      human.foundationRoot = 'human';
      synchronizeCharacter(human);
      expect(after.simulation.player.sources).toEqual(human.simulation.player.sources);
      const bonus = foundationBonus(item.foundationRoot!);
      for (const key of ['maxHp', 'attack', 'defense', 'agility'] as const) {
        const expected = text(dec(basis[key]).mul(dec(1).plus(FOUNDATION_ROOTS[item.foundationRoot!].bonusRate)).ceil());
        expect(after.simulation.player.base[key]).toBe(expected);
        expect(text(dec(after.simulation.player.base[key]).minus(human.simulation.player.base[key]))).toBe(bonus[key]);
      }
      for (const key of ['attackSpeed', 'critChance', 'critMultiplier', 'attackMultiplier', 'hpRegen', 'hpRegenPercent'] as const) {
        expect(after.simulation.player.base[key]).toBe(basis[key]);
      }
      expect(() => readCharacter({ ...after, foundationRoot: null })).toThrow('Foundation root');
      const forged = structuredClone(after);
      forged.simulation.player.base.attack = text(dec(forged.simulation.player.base.attack).plus(1));
      expect(() => readCharacter(forged)).toThrow('Character stats are not settled');
    }
    const initial = ready();
    expect(() => readCharacter({ ...initial, foundationRoot: 'earth' })).toThrow('Foundation root');
    expect(() => readCharacter({ ...initial, foundationRoot: undefined })).toThrow();
    expect(() => readCharacter({ ...initial, schemaVersion: 'neko-character-2' })).toThrow();
  });

  it('uses insight only for capped cultivation before foundation and retains it as a resource afterward', () => {
    let state = ready();
    state.cultivation = text(dec(cost).minus(1));
    state = executeCharacterCommand(state, { type: 'use', itemId: FOUNDATION.insightItemId, quantity: 2 });
    expect(state.level).toBe(FOUNDATION_LEVEL - 1);
    expect(state.foundationRoot).toBeNull();
    expect(state.cultivation).toBe(cost);
    expect(state.inventory[FOUNDATION.insightItemId]).toBeUndefined();
    state = executeCharacterCommand(state, { type: 'use', itemId: pills[0][0], quantity: 1 });
    state.inventory[FOUNDATION.insightItemId] = '2';
    const root = state.foundationRoot;
    const later = executeCharacterCommand(state, { type: 'use', itemId: FOUNDATION.insightItemId, quantity: 2 });
    expect(later.cultivation).toBe(text(dec(ITEMS[FOUNDATION.insightItemId].experience!.amount).mul(2)));
    expect(later.foundationRoot).toBe(root);
    expect(later.level).toBe(FOUNDATION_LEVEL);
  });
});
