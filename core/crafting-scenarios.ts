import { craftingCandidate } from './crafting-candidate';
import { createRules } from './game';
import { dec } from './numbers';
import type { GameCommand } from './types';

export const craftingRules = createRules(craftingCandidate);

// An opening smoke route using only public commands and virtual time, not a
// foundation-time benchmark. All later content/quality costs still need B2.
export function craftingOpening(seed = 1, retreat = false) {
  const rules = craftingRules;
  let state = rules.createGame(0, seed);
  const commands: { atSeconds: number; command: GameCommand }[] = [];
  const command = (input: GameCommand) => {
    commands.push({ atSeconds: state.clockMs / 1000, command: input });
    state = rules.applyCommand(state, input);
  };
  const recipe = rules.content.recipes.find((entry) => entry.id === 'forge-wood-sword')!;
  const initialStones = state.stones;
  for (const cost of recipe.costs) {
    const missing = BigInt(cost.quantity) - BigInt(state.inventory[cost.itemId] ?? '0');
    if (missing > 0n) command({ type: 'buy', itemId: cost.itemId, quantity: Number(missing) });
  }
  command({ type: 'craft', recipeId: recipe.id, quantity: 1 });
  if (!state.equipment.length) throw new Error('开局打造失败，已消耗成本，本首通样本未完成');
  command({ type: 'equip', slot: 'weapon', instanceId: state.equipment[0].instanceId });
  const equipmentCost = (BigInt(initialStones) - BigInt(state.stones)).toString();
  command({ type: 'supply', enabled: true, hpThreshold: 0.5 });
  command({ type: 'activity', kind: 'dungeon', targetId: 'foothill' });
  const region = rules.content.regions.find((entry) => entry.id === 'foothill')!;
  let interruptedAt: number | null = null;
  let restSeconds = 0;
  while (BigInt(state.regionKills.foothill ?? '0') < BigInt(region.clear!.waves)) {
    if (state.activity.kind !== 'dungeon' || state.clockMs >= 3_600_000) throw new Error('开局样本未能完成首轮，不能当作通过');
    state = rules.advanceGame(state, state.clockMs + 1000, 1);
    if (retreat && interruptedAt === null && state.regionKills.foothill === '7') {
      interruptedAt = state.clockMs / 1000;
      command({ type: 'activity', kind: 'idle' });
      while (dec(state.player.hp).lt(rules.getPlayerStats(state).maxHp)) {
        if (restSeconds >= 60) throw new Error('开局休整超出样本预算');
        state = rules.advanceGame(state, state.clockMs + 1000, 1);
        restSeconds++;
      }
      command({ type: 'activity', kind: 'dungeon', targetId: 'foothill' });
    }
  }
  return {
    seed, retreat, equipmentCost, interruptedAt, restSeconds,
    firstClearSeconds: state.clockMs / 1000, commands, state,
  };
}
