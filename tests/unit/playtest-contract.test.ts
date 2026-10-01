import { describe, expect, it } from 'vitest';
import { content, createRules } from '../../core/index';
import type { GameState } from '../../core/types';
import { GameService } from '../../server/game-service';
import type { GameRepository } from '../../server/repository';

function fixture() {
  const c = structuredClone(content);
  c.version = 'fixture-playtest';
  c.dwelling = {
    tiers: [{ id: 'home', name: 'Home', meditationBonus: '0', practiceBonus: '0', requiredGathering: 0, stones: '0', costs: [] }],
    gathering: [{ requiredTier: 0, bonus: '0.1', stones: '3', costs: [{ itemId: 'herb', quantity: '2' }] }],
    study: [{ requiredTier: 0, bonus: '0.1', stones: '0', costs: [] }],
  };
  const rules = createRules(c);
  let state = rules.createGame(0, 1);
  const fates = [...state.opening!.candidates];
  for (let slot = 0; slot < state.opening!.selected.length; slot++) {
    state = rules.applyCommand(state, { type: 'fate-select', lifeId: state.lifeId, slot, fateId: fates[slot] });
  }
  state = rules.applyCommand(state, { type: 'enter-life', lifeId: state.lifeId });
  return { c, rules, state };
}

describe('playable view and content profile contracts', () => {
  it('derives upgrade readiness and costs from the same conditions as the command without changing state', () => {
    const { rules, state } = fixture();
    state.stones = '3';
    state.inventory.herb = '2';
    const before = structuredClone(state);
    const offer = rules.getGameView(state).dwelling!.upgrades.find((entry) => entry.track === 'gathering')!;
    expect(offer.ready).toBe(true);
    expect(state).toEqual(before);
    const next = rules.applyCommand(state, { type: 'upgrade-dwelling', track: offer.track });
    for (const cost of offer.costs) {
      expect(BigInt(cost.owned) - BigInt(cost.itemId === 'stones' ? next.stones : next.inventory[cost.itemId] ?? '0')).toBe(BigInt(cost.quantity));
    }
    expect(rules.getGameView(next).dwelling!.upgrades.find((entry) => entry.track === offer.track)).toMatchObject({ completed: true, ready: false });
    state.inventory.herb = '0';
    expect(rules.getGameView(state).dwelling!.upgrades.find((entry) => entry.track === offer.track)!.ready).toBe(false);
    expect(() => rules.applyCommand(state, { type: 'upgrade-dwelling', track: offer.track })).toThrow();
    state.inventory.herb = '2';
    const fighting = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: rules.content.regions[0].id });
    expect(rules.getGameView(fighting).dwelling!.upgrades.every((entry) => !entry.ready)).toBe(true);
  });

  it('uses the selected profile for session creation and views and rejects foreign saves', async () => {
    const { c, rules, state } = fixture();
    let stored = structuredClone(state);
    let created: GameState | undefined;
    const repository = {
      async createSession(value: GameState) { created = value; return { characterId: 'fixture', token: 'fixture' }; },
      async load() { return { state: structuredClone(stored), revision: '1' }; },
    } as unknown as GameRepository;
    const service = new GameService(repository, { content: c, now: () => 0 });
    await service.createSession();
    expect(created!.contentVersion).toBe(c.version);
    expect(created!.phase).toBe('preparing');
    expect((await service.getGame('fixture')).game).toEqual(rules.getGameView(state));
    stored = createRules().createGame(0, 1);
    await expect(service.getGame('fixture')).rejects.toMatchObject({ code: 'SAVE_VERSION_MISMATCH' });
  });
});
