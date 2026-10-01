import { describe, expect, it } from 'vitest';
import { content, loadContent, type Content } from './content';
import { createRules } from './game';

// Synthetic values cover the resource contract, not a candidate's balance.
function fixture(edit: (c: Content) => void = () => {}) {
  const c = structuredClone(content);
  c.settings.starterEquipmentId = null;
  c.settings.baseMpRegenFraction = '0.02';
  c.baseStats.mpRegen = '1';
  c.realms[0].maxMp = '20';
  c.realms[1].maxMp = '75';
  Object.assign(c.techniques[0], { modifiers: [], effects: [], practiceBonuses: [] });
  c.equipment.push({
    id: 'mana-reservoir', name: 'Reservoir', slot: 'accessory',
    modifiers: [{ stat: 'maxMp', mode: 'flat', value: '40' }, { stat: 'maxMp', mode: 'percent', value: '0.5' }],
    effects: [], affixPool: [], affixCount: 0,
  });
  c.recipes.push({
    id: 'forge-reservoir', name: 'Reservoir recipe', unlock: { level: 0 },
    costs: [{ itemId: 'herb', quantity: '1' }], stones: '1',
    outputKind: 'equipment', outputId: 'mana-reservoir', outputQuantity: '1',
    training: { difficulty: 1, xp: '1' },
  });
  edit(c);
  const rules = createRules(c);
  return { c, rules, state: rules.createGame(0, 1) };
}

describe('mana regeneration from final capacity', () => {
  it('uses a minimum below the threshold and scales with realm capacity, not current mana', () => {
    const { rules, state } = fixture();
    state.player.mp = '0';
    expect(rules.getPlayerStats(state).mpRegen).toBe('1');
    state.level = 1;
    expect(rules.getPlayerStats(state).mpRegen).toBe('1.5');
    state.player.mp = '50';
    expect(rules.getPlayerStats(state).mpRegen).toBe('1.5');
  });

  it('resolves capacity before regeneration modifiers without refilling on equip or unequip', () => {
    const { rules, state } = fixture((c) => {
      c.techniques[0].modifiers = [
        { stat: 'mpRegen', mode: 'flat', value: '0.2' },
        { stat: 'mpRegen', mode: 'percent', value: '0.5' },
      ];
    });
    state.player.mp = '7';
    const crafted = rules.applyCommand(state, { type: 'craft', recipeId: 'forge-reservoir', quantity: 1 });
    const equipped = rules.applyCommand(crafted, {
      type: 'equip', slot: 'accessory', instanceId: crafted.equipment[0].instanceId,
    });
    // Capacity (20 + 40) * 1.5 = 90; regeneration (90 * .02 + .2) * 1.5 = 3.
    expect(rules.getPlayerStats(equipped)).toMatchObject({ maxMp: '90', mpRegen: '3' });
    expect(rules.getGameView(equipped).player.stats.mpRegen).toBe('3');
    expect(equipped.player).toEqual(crafted.player);
    const unequipped = rules.applyCommand(equipped, { type: 'equip', slot: 'accessory', instanceId: null });
    expect(rules.getPlayerStats(unequipped)).toMatchObject({ maxMp: '20', mpRegen: '1.8' });
    expect(unequipped.player.mp).toBe('7');
  });

  it('derives regeneration from the saved capacity snapshot, without applying quality twice', () => {
    const { c, rules, state } = fixture((c) => {
      c.equipment.at(-1)!.modifiers = [{ stat: 'maxMp', mode: 'flat', value: '30' }];
      c.equipmentQualities = [
        { id: 'plain', name: 'Plain', rarity: 'common', weight: 0, statMultiplier: '1', effectMultiplier: '1' },
        { id: 'fine', name: 'Fine', rarity: 'uncommon', weight: 1, statMultiplier: '2', effectMultiplier: '1.5' },
      ];
    });
    const crafted = rules.applyCommand(state, { type: 'craft', recipeId: 'forge-reservoir', quantity: 1 });
    const equipped = rules.applyCommand(crafted, {
      type: 'equip', slot: 'accessory', instanceId: crafted.equipment[0].instanceId,
    });
    expect(rules.getPlayerStats(equipped)).toMatchObject({ maxMp: '80', mpRegen: '1.6' });
    const saved = JSON.parse(JSON.stringify(equipped));
    c.equipment.at(-1)!.modifiers[0].value = '300';
    c.equipmentQualities![1].statMultiplier = '3';
    expect(createRules(c).getPlayerStats(saved)).toEqual(rules.getPlayerStats(equipped));
  });

  it('ticks in and out of combat, caps at capacity and keeps chunked advancement identical', () => {
    const { c, rules, state } = fixture((c) => {
      c.realms[0].maxMp = '80';
      c.enemies[0].maxMp = '100';
      c.enemies[0].mpRegen = '2';
      c.regions[0].enemies = [c.enemies[0].id];
    });
    state.player.mp = '0';
    expect(rules.advanceGame(state, 3000).player.mp).toBe('4.8');
    const fight = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: c.regions[0].id });
    fight.player.nextActionMs = 30_000;
    fight.battle!.nextActionMs = 30_000;
    fight.battle!.mp = '0';
    const batch = rules.advanceGame(fight, 3000);
    expect(batch.player.mp).toBe('4.8');
    expect(batch.battle!.mp).toBe('6');
    let chunked = fight;
    while (chunked.clockMs < 3000) chunked = rules.advanceGame(chunked, 3000, 1);
    expect(chunked).toEqual(batch);
    state.player.mp = '79.5';
    expect(rules.advanceGame(state, 1000).player.mp).toBe('80');
  });

  it('requires an explicit valid fraction and rejects old structures without converting them', () => {
    const { c, rules, state } = fixture();
    for (const fraction of [undefined, '-0.01', '1.01']) {
      const bad = structuredClone(c);
      Object.assign(bad.settings, { baseMpRegenFraction: fraction });
      expect(() => loadContent(bad)).toThrow();
    }
    const old = { ...state, schemaVersion: state.schemaVersion - 1 };
    expect(() => rules.advanceGame(old, 1000)).toThrow(/版本/);
    expect(old.schemaVersion).toBe(state.schemaVersion - 1);
  });
});
