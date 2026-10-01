import { describe, expect, it } from 'vitest';
import { content, loadContent, type Content } from './content';
import { createRules } from './game';
import { EQUIPMENT_SLOTS, type EquipmentSlot, type GameCommand } from '../shared/contracts';
import { gameCommandSchema } from '../server/validation';

function fixture() {
  const c = structuredClone(content);
  c.settings.starterEquipmentId = null;
  c.equipmentQualities = [
    { id: 'plain', name: '普通', rarity: 'common', weight: 0, statMultiplier: '1', effectMultiplier: '1' },
    { id: 'fine', name: '精良', rarity: 'uncommon', weight: 1, statMultiplier: '2', effectMultiplier: '1.5' },
  ];
  c.settings.starterItems.herb = '20';
  c.settings.manaSupply = { itemId: 'mana-pill', cooldownMs: 10000 };
  c.effects.push({ id: 'loadout-mana', name: '回灵', trigger: 'action', kind: 'restore', resource: 'mp', amount: '2' });
  c.techniques[0].weaponType = 'sword';
  c.techniques[0].effects = [];
  c.techniques[0].practiceBonuses = [];
  c.techniques[0].weaponMatch = {
    modifiers: [{ stat: 'attack', mode: 'flat', value: '5' }], effects: [], actionDamagePercent: '0',
  };
  Object.assign(c.baseStats, { hpRegen: '0', mpRegen: '0' });
  c.settings.baseMpRegenFraction = '0';
  const definitions: Content['equipment'] = [
    { id: 'test-weapon', name: '试剑', slot: 'weapon', category: 'sword', modifiers: [{ stat: 'attack', mode: 'flat', value: '3' }], effects: ['loadout-mana'], affixPool: [], affixCount: 0 },
    { id: 'test-armor', name: '试甲', slot: 'armor', modifiers: [{ stat: 'defense', mode: 'flat', value: '2' }, { stat: 'magicDefense', mode: 'flat', value: '4' }, { stat: 'maxHp', mode: 'flat', value: '10' }], effects: ['loadout-mana'], affixPool: [], affixCount: 0 },
    { id: 'test-footwear', name: '试履', slot: 'footwear', modifiers: [{ stat: 'agility', mode: 'flat', value: '3' }], effects: ['loadout-mana'], affixPool: [], affixCount: 0 },
    { id: 'test-accessory', name: '试佩', slot: 'accessory', modifiers: [{ stat: 'mpRegen', mode: 'flat', value: '2' }], effects: ['loadout-mana'], affixPool: [], affixCount: 0 },
  ];
  c.equipment.push(...definitions);
  for (const definition of definitions) c.recipes.push({
    id: `forge-${definition.id}`, name: '测试制法', unlock: { level: 0 },
    costs: [{ itemId: 'herb', quantity: '1' }], stones: '1',
    outputId: definition.id, outputQuantity: '1', outputKind: 'equipment',
    training: { difficulty: 1, xp: '1' },
  });
  const rules = createRules(c);
  let state = rules.createGame(0, 1);
  for (const slot of EQUIPMENT_SLOTS) state = rules.applyCommand(state, { type: 'craft', recipeId: `forge-test-${slot}`, quantity: 1 });
  const ids = Object.fromEntries(EQUIPMENT_SLOTS.map((slot, i) => [slot, state.equipment[i].instanceId])) as Record<EquipmentSlot, string>;
  return { c, rules, state, ids };
}

describe('equipment slots share the same instance and effect rules', () => {
  it('adds only equipped instances, replaces one slot and uses only the weapon for affinity', () => {
    const { rules, ids, state: initial } = fixture();
    let state = initial;
    const naked = rules.getPlayerStats(state);
    for (const slot of EQUIPMENT_SLOTS) state = rules.applyCommand(state, { type: 'equip', slot, instanceId: ids[slot] });
    expect(rules.getPlayerStats(state)).toMatchObject({
      attack: String(Number(naked.attack) + 11),
      defense: String(Number(naked.defense) + 4),
      magicDefense: String(Number(naked.magicDefense) + 8),
      agility: String(Number(naked.agility) + 6), mpRegen: '3',
    });
    state = rules.applyCommand(state, { type: 'craft', recipeId: 'forge-test-armor', quantity: 1 });
    const before = rules.getPlayerStats(state);
    const oldSlots = { ...state.loadout };
    state = rules.applyCommand(state, { type: 'equip', slot: 'armor', instanceId: state.equipment.at(-1)!.instanceId });
    expect(state.loadout).toEqual({ ...oldSlots, armor: state.equipment.at(-1)!.instanceId });
    expect(rules.getPlayerStats(state)).toEqual(before);
    state = rules.applyCommand(state, { type: 'equip', slot: 'weapon', instanceId: null });
    expect(rules.getGameView(state).techniques[0].weaponMatch?.conditionMet).toBe(false);
    expect(rules.getPlayerStats(state).attack).toBe(naked.attack);
    expect(rules.getGameView(state).equipment.filter((entry) => entry.equipped).map((entry) => entry.slot)).toEqual(['footwear', 'accessory', 'armor']);
  });

  it('rejects missing, duplicate and misplaced references without changing the original', () => {
    const { rules, state, ids } = fixture();
    const before = structuredClone(state);
    const invalid = [
      { type: 'equip', slot: 'armor', instanceId: ids.weapon },
      { type: 'equip', slot: 'armor', instanceId: 'not-owned' },
      { type: 'equip', slot: 'invalid', instanceId: null },
      { type: 'equip', instanceId: ids.weapon },
    ];
    for (const command of invalid) {
      expect(() => rules.applyCommand(state, command as GameCommand)).toThrow();
      expect(state).toEqual(before);
    }
    expect(gameCommandSchema.safeParse(invalid[2]).success).toBe(false);
    expect(gameCommandSchema.safeParse(invalid[3]).success).toBe(false);
    for (const mutate of [
      (s: typeof state) => { s.loadout.armor = ids.weapon; },
      (s: typeof state) => { s.loadout.weapon = 'missing'; },
      (s: typeof state) => { s.equipment.push(structuredClone(s.equipment[0])); },
      (s: typeof state) => { Object.assign(s, { loadout: undefined, equippedId: ids.weapon }); },
    ]) {
      const bad = structuredClone(state);
      mutate(bad);
      expect(() => rules.getGameView(bad)).toThrow();
    }
  });

  it('keeps HP, MP, cooldowns, RNG and quality snapshots when changing slots', () => {
    const { rules, state, ids } = fixture();
    state.player.hp = '11';
    state.player.mp = '7';
    state.supply.readyAt = 8000;
    state.manaSupply!.readyAt = 9000;
    let after = rules.applyCommand(state, { type: 'equip', slot: 'armor', instanceId: ids.armor });
    after = rules.applyCommand(after, { type: 'equip', slot: 'accessory', instanceId: ids.accessory });
    after = rules.applyCommand(after, { type: 'equip', slot: 'armor', instanceId: null });
    expect(after.player).toEqual(state.player);
    expect(after.supply).toEqual(state.supply);
    expect(after.manaSupply).toEqual(state.manaSupply);
    expect(after.equipment).toEqual(state.equipment);
    expect(after.rng).toBe(state.rng);
    const restored = JSON.parse(JSON.stringify(after));
    expect(rules.getPlayerStats(restored)).toEqual(rules.getPlayerStats(after));
    after.player.hp = '110';
    after = rules.applyCommand(after, { type: 'equip', slot: 'armor', instanceId: null });
    expect(after.player.hp).toBe(rules.getPlayerStats(after).maxHp);
  });

  it('combines effects from all slots in deterministic order and rejects combat swaps', () => {
    const { rules, ids, state: initial } = fixture();
    let state = initial;
    for (const slot of EQUIPMENT_SLOTS) state = rules.applyCommand(state, { type: 'equip', slot, instanceId: ids[slot] });
    state.player.mp = '0';
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    expect(() => rules.applyCommand(state, { type: 'equip', slot: 'armor', instanceId: null })).toThrow(/脱战/);
    const atTwo = rules.advanceGame(state, 2000);
    // Two seconds of regen (6) and four independently snapshotted action effects (12).
    expect(atTwo.player.mp).toBe('18');
    expect(rules.advanceGame(state, 6000)).toEqual(rules.advanceGame(atTwo, 6000));
  });

  it('requires a slot and reserves weapon categories for weapons', () => {
    const { c } = fixture();
    for (const patch of [
      { slot: undefined }, { slot: 'armor', category: 'sword' }, { category: undefined },
    ]) {
      const bad = structuredClone(c);
      Object.assign(bad.equipment[0], patch);
      expect(() => loadContent(bad)).toThrow();
    }
  });
});
