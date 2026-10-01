import { createRules } from './game';
import { investmentProfile, panelWeaponIds } from './investment-candidate';
import { equipmentFoundation, type EquipmentPath } from './equipment-scenarios';
import { catchUpWith } from './dwelling-scenarios';
import { dec } from './numbers';
import type { GameCommand } from './types';
import type { Content, Unlock } from './content';

export type InvestmentStart = 'early' | 'foundation';
export type WeaponMode = 'fixed' | 'panel';
export type PillTier = 'early' | 'middle' | 'late';
type Ledger = Record<string, Record<string, string>>;
const add = (table: Record<string, string>, id: string, value: bigint) => {
  if (value !== 0n) table[id] = (BigInt(table[id] ?? '0') + value).toString();
};

// A scripted, actively managed player. No access to the potency/falloff formula in decisions.
export function pillInvestment(
  path: EquipmentPath, seed: number, start: InvestmentStart, weaponMode: WeaponMode,
  checkpoints = [3600, 6 * 3600],
  tierId: PillTier = start === 'early' ? 'early' : 'late',
  options: {
    profile?: Content; tripKills?: number; latePreparationLevel?: number;
    prepared?: ReturnType<typeof equipmentFoundation>;
  } = {},
) {
  if (!checkpoints.length || checkpoints.some((n, i) =>
    !Number.isSafeInteger(n) || n <= (checkpoints[i - 1] ?? 0) || n > 30 * 86400)) {
    throw new Error('炼丹观察时间须递增且不超过三十日');
  }
  const baseline = options.prepared ?? equipmentFoundation(path, seed, true, {
    ...options, profile: options.profile ?? investmentProfile(), consumeGrowth: true,
    compareUpgrades: options.profile ? false : undefined,
    lateWeaponId: weaponMode === 'panel' ? panelWeaponIds[path] : undefined,
    stopAt: start === 'early' ? 'early-setup' : 'foundation-ready',
  });
  const rules = createRules(baseline.content);
  const content = rules.content;
  let state = baseline.state;
  const startedAt = state.clockMs;
  const commands = [...baseline.commands];
  const initial = structuredClone(state);
  const pills = content.items.filter((item) => item.kind === 'growth');
  const selected = content.recipes.filter((recipe) => pills.some((pill) =>
    pill.id === recipe.outputId && pill.use?.kind === 'growth' && pill.use.tierId === tierId));
  if (selected.length !== 3) throw new Error('炼丹策略须选择完整的三类同档丹药');
  const needed = new Set(selected.flatMap((recipe) => recipe.costs.map((cost) => cost.itemId)));
  const ledger: Ledger = {
    dropped: {}, crafted: {}, consumed: {}, materials: {}, purchased: {}, sold: {}, stones: {},
  };
  const seconds = { dungeon: 0, idle: 0 };
  let nextRecipe = 0;
  let failure: { atSeconds: number; reason: string; regionId?: string } | undefined;
  const snapshots: ReturnType<typeof snapshot>[] = [];
  const count = (id: string) => BigInt(state.inventory[id] ?? '0');
  const unlocked = (gate: Unlock) => 'level' in gate ? state.level >= gate.level
    : BigInt(state.regionKills[gate.regionId] ?? '0') >= BigInt(gate.kills);
  const act = (command: GameCommand) => {
    const before = state;
    state = rules.applyCommand(state, command);
    commands.push({ atSeconds: state.clockMs / 1000, command });
    if (command.type === 'buy' || command.type === 'sell') {
      add(ledger[command.type === 'buy' ? 'purchased' : 'sold'], command.itemId, BigInt(command.quantity));
      add(ledger.stones, command.type, BigInt(state.stones) - BigInt(before.stones));
    }
    if (command.type === 'craft') {
      const recipe = selected.find((entry) => entry.id === command.recipeId)!;
      add(ledger.crafted, recipe.outputId, count(recipe.outputId) - BigInt(before.inventory[recipe.outputId] ?? '0'));
      add(ledger.stones, 'craft', BigInt(state.stones) - BigInt(before.stones));
      for (const cost of recipe.costs) add(ledger.materials, cost.itemId, BigInt(cost.quantity) * BigInt(command.quantity));
    }
    if (command.type === 'consume') {
      add(ledger.consumed, command.itemId, BigInt(before.inventory[command.itemId] ?? '0') - count(command.itemId));
    }
  };
  const advance = (targetMs: number) => {
    const before = state;
    state = catchUpWith(rules, state, targetMs);
    const active = Number(BigInt(state.totals.activeSeconds) - BigInt(before.totals.activeSeconds));
    seconds.dungeon += active;
    seconds.idle += (state.clockMs - before.clockMs) / 1000 - active;
    for (const item of content.items) {
      const received = count(item.id) - BigInt(before.inventory[item.id] ?? '0');
      if (received > 0n) add(ledger.dropped, item.id, received);
    }
    add(ledger.stones, 'combat', BigInt(state.stones) - BigInt(before.stones));
    if (before.activity.kind === 'dungeon' && state.activity.kind !== 'dungeon') {
      failure = { atSeconds: state.activity.stoppedAt! / 1000, reason: state.activity.stopReason!, regionId: before.activity.targetId };
    }
  };
  const consume = () => {
    for (const pill of pills) while (count(pill.id) > 0n) {
      act({ type: 'consume', itemId: pill.id, quantity: Number(count(pill.id) > 10000n ? 10000n : count(pill.id)) });
    }
  };
  const healing = content.items.find((item) => item.id === content.settings.supplyItemId)!;
  const reserve = BigInt(healing.buyPrice!) * 20n;
  function manageInventory() {
    consume();
    for (const item of content.items) {
      if (item.kind !== 'material' || !item.sellPrice || needed.has(item.id)) continue;
      while (count(item.id) > 0n) act({
        type: 'sell', itemId: item.id, quantity: Number(count(item.id) > 10000n ? 10000n : count(item.id)),
      });
    }
    const affordable = BigInt(state.stones) / BigInt(healing.buyPrice!);
    const missing = 20n - count(healing.id);
    if (missing > 0n && affordable > 0n) act({
      type: 'buy', itemId: healing.id, quantity: Number(missing < affordable ? missing : affordable),
    });
    // Round-robin allocation prevents a fixed attack-first loop from consuming every shared herb.
    let blocked = 0;
    while (blocked < selected.length) {
      const recipe = selected[nextRecipe];
      nextRecipe = (nextRecipe + 1) % selected.length;
      if (!unlocked(recipe.unlock)) { blocked++; continue; }
      const purchases = recipe.costs.flatMap((cost) => {
        const item = content.items.find((item) => item.id === cost.itemId)!;
        const missing = BigInt(cost.quantity) - count(cost.itemId);
        return missing > 0n && item.buyPrice && unlocked(item.unlock) ? [{ item, missing }] : [];
      });
      const purchaseCost = purchases.reduce((sum, { item, missing }) => sum + BigInt(item.buyPrice!) * missing, 0n);
      if (BigInt(state.stones) >= reserve + BigInt(recipe.stones) + purchaseCost) {
        for (const { item, missing } of purchases) act({ type: 'buy', itemId: item.id, quantity: Number(missing) });
      }
      if (BigInt(state.stones) < reserve + BigInt(recipe.stones) ||
          recipe.costs.some((cost) => count(cost.itemId) < BigInt(cost.quantity))) {
        blocked++;
        continue;
      }
      act({ type: 'craft', recipeId: recipe.id, quantity: 1 });
      consume();
      blocked = 0;
    }
  }
  const sources: Record<string, string> = {
    herb: 'bamboo', blood: 'bamboo', 'stone-marrow': 'quarry',
    heartwood: 'ruins', 'dense-ore': 'quarry', 'dew-flower': 'pool',
  };
  function chooseRegion() {
    const recipe = selected[nextRecipe];
    if (!unlocked(recipe.unlock) && 'regionId' in recipe.unlock) return recipe.unlock.regionId;
    const cost = recipe.costs.find((cost) => count(cost.itemId) < BigInt(cost.quantity));
    return cost ? sources[cost.itemId] : start === 'early' ? 'bamboo' : 'ruins';
  }
  function snapshot() {
    const growthUsed = Object.values(ledger.consumed).reduce((sum, value) => sum + BigInt(value), 0n);
    const nextGains = Object.fromEntries(rules.getGameView(state).inventory.filter((item) => item.growth)
      .map((item) => [item.id, item.growth!.nextGain]));
    return {
      elapsedSeconds: (state.clockMs - startedAt) / 1000, atSeconds: state.clockMs / 1000,
      level: state.level, cultivation: state.cultivation, reserve: state.reserve, stones: state.stones,
      growth: { attack: state.player.pillAttack, defense: state.player.pillDefense!, maxHp: state.player.pillMaxHp! },
      stats: rules.getPlayerStats(state), nextGains,
      kills: (BigInt(state.totals.kills) - BigInt(initial.totals.kills)).toString(),
      healingPillsUsed: (BigInt(state.totals.pillsUsed) - BigInt(initial.totals.pillsUsed) - growthUsed).toString(),
      ledger: structuredClone(ledger), seconds: { ...seconds }, inventory: { ...state.inventory },
      materialResaleCost: Object.entries(ledger.materials).reduce((sum, [id, n]) =>
        sum + BigInt(n) * BigInt(content.items.find((item) => item.id === id)!.sellPrice ?? '0'), 0n).toString(),
    };
  }
  for (const checkpoint of checkpoints) {
    const deadline = startedAt + checkpoint * 1000;
    while (state.clockMs < deadline && !failure) {
      manageInventory();
      const stats = rules.getPlayerStats(state);
      while (state.clockMs < deadline && (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp))) {
        advance(state.clockMs + 1000);
      }
      if (state.clockMs === deadline) break;
      const regionId = chooseRegion();
      act({ type: 'supply', enabled: true, hpThreshold: 0.5 });
      act({ type: 'activity', kind: 'dungeon', targetId: regionId });
      advance(Math.min(state.clockMs + 60_000, deadline));
      if (!failure) act({ type: 'activity', kind: 'idle' });
    }
    if (!failure) manageInventory();
    snapshots.push(snapshot());
    if (failure) break;
  }
  const finalBeforeBreakthrough = structuredClone(state);
  if (!failure && start === 'foundation') act({ type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
  return {
    path, seed, start, weaponMode, tierId, checkpoints, startedAtSeconds: startedAt / 1000,
    baseline: { seconds: baseline.seconds, ledger: baseline.ledger, upgrades: baseline.upgrades },
    initial, finalBeforeBreakthrough, state, content, commands, snapshots, failure,
  };
}
