import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRules } from './game';
import { investmentCandidate, investmentProfile, panelWeaponIds } from './investment-candidate';
import { monsterCandidate } from './monster-candidate';
import { equipmentPaths } from './equipment-scenarios';
import { pillInvestment } from './investment-scenarios';
import { dec } from './numbers';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Funded state is restricted to unit fixtures, never used by the investment scenarios.
function funded(rules: ReturnType<typeof createRules>) {
  const state = rules.createGame(0, 42);
  state.stones = '1000000';
  for (const item of rules.content.items) state.inventory[item.id] = '10000';
  for (const region of rules.content.regions) state.regionKills[region.id] = '20';
  return state;
}

describe('fixed traits and equal-cost panel alternatives', () => {
  it('retains the historical B4 content and rejects cross-candidate saves', () => {
    expect(hash(monsterCandidate)).toBe('351a684dbf03adf06696e027499d7c5c396821d13171eee98ea67ebacf0310a2');
    expect(investmentCandidate.equipment.every((weapon) => weapon.affixCount === 0 && !weapon.affixPool.length)).toBe(true);
    const old = createRules(monsterCandidate);
    const current = createRules(investmentCandidate);
    expect(() => current.getGameView(old.createGame(0))).toThrow(/版本/);
    expect(() => old.getGameView(current.createGame(0))).toThrow(/版本/);
  });
  it.each(['sword', 'gauntlet', 'staff'] as const)('%s has a higher-panel same-tier choice, not a lower quality label', (path) => {
    const fixedId = equipmentPaths[path].weapons[2];
    const panelId = panelWeaponIds[path];
    const fixedRecipe = investmentCandidate.recipes.find((r) => r.outputId === fixedId)!;
    const panelRecipe = investmentCandidate.recipes.find((r) => r.outputId === panelId)!;
    expect(panelRecipe.costs).toEqual(fixedRecipe.costs);
    expect(panelRecipe.stones).toEqual(fixedRecipe.stones);
    expect(panelRecipe.unlock).toEqual(fixedRecipe.unlock);
    for (const quality of investmentCandidate.equipmentQualities!) {
      const c = structuredClone(investmentCandidate);
      c.equipmentQualities!.forEach((q) => { q.weight = q.id === quality.id ? 1 : 0; });
      const rules = createRules(c);
      let state = funded(rules);
      state = rules.applyCommand(state, { type: 'craft', recipeId: fixedRecipe.id, quantity: 1 });
      state = rules.applyCommand(state, { type: 'craft', recipeId: panelRecipe.id, quantity: 1 });
      const [fixed, panel] = state.equipment;
      expect(panel.quality!.id).toBe(fixed.quality!.id);
      expect(panel.quality!.effects).toEqual([]);
      expect(panel.quality!.modifiers.every((m) => !['hpRegen', 'mpRegen'].includes(m.stat))).toBe(true);
      expect(fixed.quality!.effects.length).toBeGreaterThan(0);
      const attack = (instance: typeof fixed) => instance.quality!.modifiers.find((m) => m.stat === 'attack')!.value;
      expect(dec(attack(panel)).gt(attack(fixed))).toBe(true);
      expect(panel.affixes).toEqual([]);
      expect(fixed.affixes).toEqual([]);
    }
  });
  it('keeps high-quality fixed effects stable through batches and save/load', () => {
    const rules = createRules(investmentCandidate);
    const initial = funded(rules);
    const batch = rules.applyCommand(initial, { type: 'craft', recipeId: 'forge-bamboo-edge', quantity: 12 });
    let sequential = initial;
    for (let i = 0; i < 12; i++) sequential = rules.applyCommand(sequential, {
      type: 'craft', recipeId: 'forge-bamboo-edge', quantity: 1,
    });
    expect(batch.equipment).toEqual(sequential.equipment);
    expect(batch.rng).toBe(sequential.rng);
    expect(batch.inventory).toEqual(sequential.inventory);
    expect(batch.equipment.every((e) => e.affixes.length === 0)).toBe(true);
    expect(new Set(batch.equipment.map((e) => e.quality!.id)).size).toBeGreaterThan(1);
    expect(rules.getGameView(JSON.parse(JSON.stringify(batch)))).toEqual(rules.getGameView(batch));
  });
});

describe('resource-limited pill investment without a known falloff stopping rule', () => {
  it('spends real inventory, exceeds six pills, retains growth on breakthrough and replays', () => {
    const result = pillInvestment('sword', 1, 'foundation', 'fixed', [3600]);
    expect(result.failure).toBeUndefined();
    expect(result.initial.level).toBe(12);
    expect(result.finalBeforeBreakthrough.level).toBe(12);
    expect(result.state.level).toBe(13);
    const s = result.snapshots[0];
    expect(Object.values(s.ledger.crafted).reduce((sum, n) => sum + BigInt(n), 0n)).toBeGreaterThan(18n);
    expect(BigInt(s.ledger.stones.craft)).toBeLessThan(0n);
    expect(Object.keys(s.ledger.materials).length).toBeGreaterThan(0);
    expect(s.seconds.dungeon + s.seconds.idle).toBe(3600);
    expect(result.state.player.pillAttack).toBe(result.finalBeforeBreakthrough.player.pillAttack);
    const rules = createRules(result.content);
    let replay = rules.createGame(0, 1);
    for (const { atSeconds, command } of result.commands) {
      while (replay.clockMs < atSeconds * 1000) replay = rules.advanceGame(replay, atSeconds * 1000, 17);
      replay = rules.applyCommand(replay, command);
    }
    expect(replay).toEqual(result.state);
    for (const pill of result.content.items.filter((item) => item.kind === 'growth')) {
      const expected = BigInt(result.initial.inventory[pill.id] ?? '0') + BigInt(s.ledger.dropped[pill.id] ?? '0') +
        BigInt(s.ledger.crafted[pill.id] ?? '0') - BigInt(s.ledger.consumed[pill.id] ?? '0');
      expect(expected.toString()).toBe(result.state.inventory[pill.id] ?? '0');
    }
    expect(investmentProfile().version).not.toBe(investmentCandidate.version);
  }, 30000);
  it('does not freeze the realm while farming low-tier pills or require knowing diminishing returns', () => {
    const result = pillInvestment('sword', 1, 'early', 'fixed', [3600]);
    expect(result.initial.level).toBe(3);
    expect(result.state.level).toBeGreaterThanOrEqual(3);
    expect(result.commands.some(({ command }) => command.type === 'breakthrough')).toBe(false);
    expect(Object.keys(result.snapshots[0].ledger.crafted).every((id) => !id.includes('-middle') && !id.includes('-late'))).toBe(true);
    expect(result.state.equipment).toHaveLength(2);
  }, 30000);
  it('compares pill tiers from exactly the same legally obtained starting state', () => {
    const results = (['early', 'middle', 'late'] as const).map((tier) =>
      pillInvestment('sword', 1, 'foundation', 'fixed', [1], tier));
    expect(results[1].initial).toEqual(results[0].initial);
    expect(results[2].initial).toEqual(results[0].initial);
    expect(results.map((result) => result.tierId)).toEqual(['early', 'middle', 'late']);
  }, 30000);
  it('rejects invalid observation budgets rather than silently changing them', () => {
    for (const times of [[], [0], [10, 5], [1.5], [31 * 86400]]) {
      expect(() => pillInvestment('sword', 1, 'early', 'fixed', times)).toThrow(/观察时间/);
    }
  });
});
