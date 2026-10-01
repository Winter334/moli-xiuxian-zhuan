import { describe, expect, it } from 'vitest';
import { combatProfile } from './combat-candidate';
import { content, loadContent } from './content';
import { createRules } from './game';
import { gameCommandSchema } from '../server/validation';

function duel() {
  const c = structuredClone(combatProfile());
  c.baseStats.hpRegen = '0';
  c.baseStats.mpRegen = '0';
  c.settings.baseMpRegenFraction = '0';
  const rules = createRules(c);
  let state = rules.createGame(0, 1);
  state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
  state.player.nextActionMs = 3_600_000;
  state.battle!.nextActionMs = 3_600_000;
  state.player.hp = '1';
  state.player.mp = '0';
  state.inventory[c.settings.supplyItemId] = '2';
  state.inventory[c.settings.manaSupply!.itemId] = '2';
  return { rules, state, hpId: c.settings.supplyItemId, mpId: c.settings.manaSupply!.itemId };
}

describe('independent, authorized mana supply', () => {
  it('does not consume while disabled, full, resting or empty', () => {
    const { rules, state, mpId } = duel();
    expect(rules.advanceGame(state, 1000).inventory[mpId]).toBe('2');
    const enabled = rules.applyCommand(state, { type: 'mana-supply', enabled: true, mpThreshold: 1 });
    const full = structuredClone(enabled);
    full.player.mp = rules.getPlayerStats(full).maxMp;
    expect(rules.advanceGame(full, 1000).inventory[mpId]).toBe('2');
    const rest = rules.applyCommand(enabled, { type: 'activity', kind: 'idle' });
    expect(rules.advanceGame(rest, 1000).inventory[mpId]).toBe('2');
    const empty = structuredClone(enabled);
    empty.inventory[mpId] = '0';
    empty.inventory.herb = '100';
    const after = rules.advanceGame(empty, 1000);
    expect(after.player.mp).toBe('0');
    expect(after.inventory.herb).toBe('100');
    expect(after.totals.pillsUsed).toBe('0');
  });

  it('uses HP and MP independently and toggling does not reset cooldown', () => {
    const { rules, state, hpId, mpId } = duel();
    let enabled = rules.applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 1 });
    enabled = rules.applyCommand(enabled, { type: 'mana-supply', enabled: true, mpThreshold: 1 });
    const first = rules.advanceGame(enabled, 1000);
    expect(first.inventory[hpId]).toBe('1');
    expect(first.inventory[mpId]).toBe('1');
    expect(first.totals.pillsUsed).toBe('2');
    first.player.mp = '0';
    let toggled = rules.applyCommand(first, { type: 'mana-supply', enabled: false, mpThreshold: 0.5 });
    toggled = rules.applyCommand(toggled, { type: 'mana-supply', enabled: true, mpThreshold: 1 });
    const readyAt = first.manaSupply!.readyAt;
    expect(toggled.manaSupply!.readyAt).toBe(readyAt);
    expect(rules.advanceGame(toggled, readyAt - 1000).inventory[mpId]).toBe('1');
    expect(rules.advanceGame(toggled, readyAt).inventory[mpId]).toBe('0');
    expect(state.inventory[mpId]).toBe('2');
  });

  it('rejects unsupported commands, invalid thresholds and non-mana supplies', () => {
    const { rules, state } = duel();
    for (const mpThreshold of [NaN, -0.1, 1.1]) {
      const command = { type: 'mana-supply' as const, enabled: true, mpThreshold };
      expect(() => rules.applyCommand(state, command)).toThrow();
      expect(gameCommandSchema.safeParse(command).success).toBe(false);
    }
    const unsupported = createRules(content);
    expect(() => unsupported.applyCommand(unsupported.createGame(0), {
      type: 'mana-supply', enabled: true, mpThreshold: 0.3,
    })).toThrow();
    const bad = structuredClone(combatProfile());
    bad.settings.manaSupply!.itemId = bad.settings.supplyItemId;
    expect(() => loadContent(bad)).toThrow(/灵力/);
    const missing = structuredClone(state);
    delete missing.manaSupply;
    expect(() => rules.advanceGame(missing, 1000)).toThrow(/回灵补给/);
  });

  it('keeps online and batched inventory, cooldown and state identical', () => {
    const { rules, state } = duel();
    let start = rules.applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 1 });
    start = rules.applyCommand(start, { type: 'mana-supply', enabled: true, mpThreshold: 1 });
    const target = 90_000;
    const batch = rules.advanceGame(start, target);
    for (const ticks of [1, 7]) {
      let chunked = start;
      while (chunked.clockMs < target) chunked = rules.advanceGame(chunked, target, ticks);
      expect(chunked).toEqual(batch);
    }
  });
});
