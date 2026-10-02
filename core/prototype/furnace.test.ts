import { describe, expect, it } from 'vitest';
import { random } from '../numbers';
import { addInstance, createCharacter, readCharacter } from './character-state';
import { executeCharacterCommand, getCharacterView, type CharacterCommand } from './character';
import { ARMOR_ASSEMBLIES, ASSEMBLIES, ITEMS, RECIPES } from './content';
import { componentQuality } from './equipment';
import { refiningChance } from './economy';
import { FURNACES, furnaceTierSchema } from './furnace';

describe('personal furnace', () => {
  it('upgrades atomically with exact materials, no extra rewards, and a stale-target guard', () => {
    let state = createCharacter(0, 19);
    while (FURNACES[state.furnaceTier].upgrade) {
      const upgrade = FURNACES[state.furnaceTier].upgrade!;
      const command: CharacterCommand = { type: 'upgrade-furnace', tier: upgrade.tier };
      const costs = Object.entries(upgrade.materials);
      for (const [itemId, count] of costs) state.inventory[itemId] = String(count + 1);
      const short = structuredClone(state);
      const [lastId, lastCount] = costs.at(-1)!;
      short.inventory[lastId] = String(lastCount - 1);
      if (lastCount === 1) delete short.inventory[lastId];
      const rejected = structuredClone(short);
      expect(getCharacterView(short).workshop.upgrade!.available).toBe(false);
      expect(() => executeCharacterCommand(short, command)).toThrow('升鼎材料不足');
      expect(short).toEqual(rejected);
      const before = structuredClone(state);
      const expectedInventory = { ...state.inventory };
      for (const [itemId] of costs) expectedInventory[itemId] = '1';
      state = executeCharacterCommand(state, command);
      expect(state).toEqual({
        ...before, furnaceTier: upgrade.tier, inventory: expectedInventory, log: state.log,
      });
      expect(state.log).toHaveLength(before.log.length + 1);
      expect(state.log.at(-1)!.message).toContain(FURNACES[upgrade.tier].name);
      const upgraded = structuredClone(state);
      expect(() => executeCharacterCommand(state, command)).toThrow('不是当前可升级');
      expect(state).toEqual(upgraded);
      expect(readCharacter(JSON.parse(JSON.stringify(state)))).toEqual(state);
    }
    expect(getCharacterView(state).workshop.upgrade).toBeNull();
    expect(() => executeCharacterCommand(state, { type: 'upgrade-furnace', tier: state.furnaceTier }))
      .toThrow('不是当前可升级');
    expect(() => readCharacter({ ...state, furnaceTier: undefined })).toThrow();
    expect(() => readCharacter({ ...state, furnaceTier: 9999 })).toThrow();
    const initial = createCharacter(0, 19);
    expect(() => executeCharacterCommand(initial, { type: 'upgrade-furnace', tier: state.furnaceTier }))
      .toThrow('不是当前可升级');
  });

  it('uses the owned tier for ordinary success and component quality regardless of location', () => {
    for (const tier of Object.keys(FURNACES).map(Number)) {
      const home = createCharacter(0, 19);
      const regionId = getCharacterView(home).regions.find(region => region.arrivable)!.id;
      for (const state of [home, executeCharacterCommand(home, { type: 'arrive', regionId })]) {
        state.furnaceTier = furnaceTierSchema.parse(tier);
        for (const recipeId of ['smelt-iron', 'iron-blade']) {
          const prepared = structuredClone(state);
          const recipe = RECIPES[recipeId];
          for (const [itemId, count] of Object.entries(recipe.materials)) prepared.inventory[itemId] = String(count);
          const view = getCharacterView(prepared);
          expect(view.workshop).toMatchObject({ tier, available: true });
          const rng = { rng: prepared.simulation.rng };
          const crafted = executeCharacterCommand(prepared, { type: 'craft', recipeId, quantity: 1 });
          if (recipe.path === 'ordinary') {
            const chance = refiningChance(recipe.difficulty, prepared.skills.refining.level, tier);
            expect(view.recipes.find(entry => entry.id === recipeId)!.successChance).toBe(chance);
            const expected = random(rng) < Number(chance) ? '1' : '0';
            expect(crafted.inventory[recipe.output] ?? '0').toBe(expected);
          } else {
            const quality = componentQuality(rng, prepared.skills.refining.level, ITEMS[recipe.output].tier!, tier);
            expect(Object.values(crafted.instances)).toEqual([{ itemId: recipe.output, quality }]);
          }
          expect(crafted.simulation.rng).toBe(rng.rng);
          expect(crafted.furnaceTier).toBe(tier);
        }
      }
    }
  });

  it('interrupts meditation for furnace operations exactly like stopping first', () => {
    const state = createCharacter(0, 19);
    const commands: CharacterCommand[] = [];
    for (const recipeId of ['smelt-iron', 'iron-blade']) {
      for (const [itemId, count] of Object.entries(RECIPES[recipeId].materials)) state.inventory[itemId] = String(count);
      commands.push({ type: 'craft', recipeId, quantity: 1 });
    }
    const upgrade = FURNACES[state.furnaceTier].upgrade!;
    for (const [itemId, count] of Object.entries(upgrade.materials)) state.inventory[itemId] = String(count);
    commands.push({ type: 'upgrade-furnace', tier: upgrade.tier });
    const weapon = ASSEMBLIES[0];
    commands.push({
      type: 'assemble',
      bladeId: addInstance(state, state.instances, weapon.blade, 100),
      hiltId: addInstance(state, state.instances, weapon.hilt, 100),
    });
    const armor = ARMOR_ASSEMBLIES[0];
    commands.push({
      type: 'assemble-armor',
      interiorId: addInstance(state, state.instances, armor.interior, 100),
      exteriorId: addInstance(state, state.instances, armor.exterior, 100),
    });
    const meditating = executeCharacterCommand(state, { type: 'recover', mode: 'sleep' });
    const before = structuredClone(meditating);
    const view = getCharacterView(meditating);
    expect(view.workshop.available).toBe(true);
    expect(view.workshop.upgrade!.available).toBe(true);
    expect(view.recipes.every(recipe => recipe.available)).toBe(true);
    const stopped = executeCharacterCommand(meditating, { type: 'recover', mode: 'rest' });
    for (const command of commands) {
      const result = executeCharacterCommand(meditating, command);
      expect(result).toEqual(executeCharacterCommand(stopped, command));
      expect(result.simulation.mode).toBe('rest');
      expect(meditating).toEqual(before);
    }
  });

  it('blocks furnace operations during combat without consuming resources', () => {
    const state = createCharacter(0, 19);
    const upgrade = FURNACES[state.furnaceTier].upgrade!;
    for (const [itemId, count] of Object.entries(upgrade.materials)) state.inventory[itemId] = String(count);
    const regionId = getCharacterView(state).regions.find(region => region.enterable)!.id;
    const activity = executeCharacterCommand(state, { type: 'enter', regionId });
    const commands: CharacterCommand[] = [
      { type: 'upgrade-furnace', tier: upgrade.tier },
      { type: 'craft', recipeId: 'smelt-iron', quantity: 1 },
      { type: 'assemble', bladeId: 'missing', hiltId: 'missing' },
      { type: 'assemble-armor', interiorId: 'missing', exteriorId: 'missing' },
    ];
    const before = structuredClone(activity);
    const view = getCharacterView(activity);
    expect(view.workshop.available).toBe(false);
    expect(view.workshop.upgrade!.available).toBe(false);
    expect(view.recipes.every(recipe => !recipe.available)).toBe(true);
    for (const command of commands) {
      expect(() => executeCharacterCommand(activity, command)).toThrow('请先退出战斗');
      expect(activity).toEqual(before);
    }
  });
});
