import { createHash } from 'node:crypto';
import type { Content } from './content';
import { createRules } from './game';
import { equipmentFoundation, equipmentPaths, type EquipmentPath } from './equipment-scenarios';
import { catchUpWith } from './dwelling-scenarios';
import { dec } from './numbers';
import type { GameCommand, GameState } from './types';
import { EQUIPMENT_SLOTS } from '../shared/contracts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const sessionOrders = {
  'weapon-first': ['weapon', 'armor', 'footwear', 'accessory'],
  'armor-first': ['armor', 'weapon', 'footwear', 'accessory'],
  'footwear-first': ['footwear', 'weapon', 'armor', 'accessory'],
  'accessory-first': ['accessory', 'weapon', 'armor', 'footwear'],
} as const;
export type SessionOrder = keyof typeof sessionOrders;
export type StaffPolicy = 'low' | 'high' | 'supplied';
export type SessionOptions = {
  order: SessionOrder;
  reserveStones: number;
  staffPolicy: StaffPolicy;
  manaPurchaseLimit: number;
  travelPolicy?: 'short' | 'attrition';
  growthPolicy?: 'none' | 'available';
  upgradeWindowSeconds?: number;
  compareAtEnd?: boolean;
  preparation?: { level: number; reserveStones: number };
};

// Counterfactual branches own the same paid equipment and inventory; only the equipped slot differs.
function equipmentSustainWindow(
  content: Content, original: GameState, slot: typeof EQUIPMENT_SLOTS[number],
  instanceId: string | null, regionId: string, duration: number,
) {
  const rules = createRules(content);
  let state = original;
  const commands: { atMs: number; command: GameCommand }[] = [];
  const act = (command: GameCommand) => {
    commands.push({ atMs: state.clockMs, command });
    state = rules.applyCommand(state, command);
  };
  act({ type: 'activity', kind: 'idle' });
  act({ type: 'equip', slot, instanceId });
  const stats = rules.getPlayerStats(state);
  while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) {
    state = rules.advanceGame(state, state.clockMs + 1000);
    if (state.clockMs - original.clockMs > 3_600_000) throw new Error('换装对照休整超时');
  }
  act({ type: 'supply', enabled: false, hpThreshold: 0.5 });
  if (content.settings.manaSupply) act({ type: 'mana-supply', enabled: false, mpThreshold: 0.3 });
  act({ type: 'activity', kind: 'dungeon', targetId: regionId });
  const start = state;
  let firstKillSeconds: number | undefined;
  let firstFallbackSeconds: number | undefined;
  let actions = 0;
  let fallbacks = 0;
  const preferred = content.actions.find((a) => a.id === content.techniques.find((t) => t.id === state.techniqueId)!.actionId)!;
  while (state.activity.kind === 'dungeon' && state.clockMs < start.clockMs + duration * 1000) {
    const previous = state;
    const currentStats = rules.getPlayerStats(previous);
    // Supplies are disabled: the core restores this tick before choosing the player's action.
    const readyMana = dec(previous.player.mp).plus(currentStats.mpRegen);
    const availableMana = readyMana.lt(currentStats.maxMp) ? readyMana : dec(currentStats.maxMp);
    state = rules.advanceGame(state, state.clockMs + 1000);
    if (state.player.nextActionMs !== previous.player.nextActionMs) {
      actions++;
      if (availableMana.lt(preferred.mpCost)) {
        fallbacks++;
        firstFallbackSeconds ??= (state.clockMs - start.clockMs) / 1000;
      }
    }
    if (state.totals.kills !== start.totals.kills) firstKillSeconds ??= (state.clockMs - start.clockMs) / 1000;
  }
  let replay = original;
  for (const { atMs, command } of commands) {
    replay = catchUpWith(rules, replay, atMs);
    replay = rules.applyCommand(replay, command);
  }
  replay = catchUpWith(rules, replay, state.clockMs);
  if (hash(replay) !== hash(state)) throw new Error('换装对照命令重放不一致');
  return {
    regionId, duration, stats, startingHp: start.player.hp, startingMp: start.player.mp,
    restSeconds: (start.clockMs - original.clockMs) / 1000,
    activeSeconds: (state.clockMs - start.clockMs) / 1000,
    kills: (BigInt(state.totals.kills) - BigInt(start.totals.kills)).toString(),
    actions, fallbacks, firstKillSeconds, firstFallbackSeconds,
    hp: state.player.hp, mp: state.player.mp, stop: state.activity.stopReason,
    originStateHash: hash(original), startingRng: start.rng, startingEnemyId: start.battle!.enemyId,
    stateHash: hash(state), replayVerified: true,
  };
}

// Active first session: explicit purchases and short trips, never an unattended policy.
function runFirstSession(
  content: Content, path: EquipmentPath, seed: number, duration = 1800,
  techniqueId: string = equipmentPaths[path].technique,
  loadoutPolicy: 'weapon-only' | 'distributed' | 'ordered' = 'weapon-only',
  options?: SessionOptions,
) {
  if (loadoutPolicy === 'ordered' && (!options || !sessionOrders[options.order] ||
      !['low', 'high', 'supplied'].includes(options.staffPolicy) ||
      !Number.isSafeInteger(options.reserveStones) || options.reserveStones < 0 ||
      !Number.isSafeInteger(options.manaPurchaseLimit) || options.manaPurchaseLimit < 0 ||
      options.manaPurchaseLimit > 1000 ||
      !['short', 'attrition'].includes(options.travelPolicy ?? 'short') ||
      !['none', 'available'].includes(options.growthPolicy ?? 'none') ||
      !Number.isSafeInteger(options.upgradeWindowSeconds ?? 0) ||
      (options.upgradeWindowSeconds ?? 0) < 0 || (options.upgradeWindowSeconds ?? 0) > 3600 ||
      (options.preparation !== undefined && (!Number.isSafeInteger(options.preparation.level) ||
        options.preparation.level < 3 || options.preparation.level > 12 ||
        !Number.isSafeInteger(options.preparation.reserveStones) || options.preparation.reserveStones < 0)) ||
      (options.compareAtEnd !== undefined && typeof options.compareAtEnd !== 'boolean'))) throw new Error('有序投入策略参数非法');
  if (loadoutPolicy !== 'ordered' && options) throw new Error('有序投入参数不能用于旧短途策略');
  const rules = createRules(content);
  const plan = equipmentPaths[path];
  const technique = content.techniques.find((t) => t.id === techniqueId);
  if (!technique?.manualItemId) throw new Error('短时路线须选择有书册来源的功法');
  if (options && path === 'staff' && (techniqueId !== 'flame' ||
      !content.techniques.some((t) => t.id === 'kindling') || !content.settings.manaSupply)) {
    throw new Error('法杖有序投入须使用引火诀、灵焰诀与回灵补给候选');
  }
  let state = rules.createGame(0, seed);
  const commands: { atSeconds: number; command: GameCommand }[] = [];
  const events: { atSeconds: number; event: string }[] = [];
  const snapshots: ReturnType<typeof snapshot>[] = [];
  const upgrades: {
    atSeconds: number; equipmentId: string;
    before: ReturnType<typeof rules.getPlayerStats>; after: ReturnType<typeof rules.getPlayerStats>;
    growth?: ReturnType<typeof snapshot>['growth'];
    comparison?: { before: ReturnType<typeof equipmentSustainWindow>; after: ReturnType<typeof equipmentSustainWindow> };
  }[] = [];
  const growthCrafted: Record<string, number> = {};
  const growthConsumed: Record<string, number> = {};
  const growthItems = content.items.filter((item) => item.use?.kind === 'growth');
  const growthRecipes = content.recipes.filter((recipe) => growthItems.some((item) =>
    item.id === recipe.outputId && item.use?.kind === 'growth' && item.use.tierId === 'early'));
  let nextGrowthRecipe = 0;
  let purchaseReserve = 0n;
  const transactions: { atSeconds: number; command: GameCommand; stones: string; inventory: Record<string, string> }[] = [];
  const drops: Record<string, string> = {};
  const consumed: Record<string, string> = {};
  const combatSecondsByTechnique: Record<string, number> = {};
  const restSeconds = { hpOnly: 0, mpOnly: 0, both: 0 };
  const trips: {
    startedAtSeconds: number; endedAtSeconds: number; regionId: string; techniqueId: string;
    kills: string; manaUsed: string; hp: string; mp: string;
    endReason: string; unfinishedEnemy: boolean;
  }[] = [];
  const techniqueSwitches: {
    atSeconds: number; from: string; to: string; reason: string; manaRemaining: string;
  }[] = [];
  const budgetDecisions: {
    atSeconds: number; equipmentId: string; unlocked: boolean; availableStones: string;
    cashCost: string; reserveStones: string; cashShortfall: string;
    unavailableMaterials: string[]; inventoryUsed: Record<string, string>;
    inventoryReplacementValue: string; inventorySaleValue: string; allBoughtCost: string;
    decision: 'locked' | 'materials' | 'cash' | 'reserve' | 'buy';
  }[] = [];
  const learningCheckpoints: { atSeconds: number; techniqueId: string; stateHash: string; stones: string }[] = [];
  const orderedEquipment = options ? sessionOrders[options.order].map((slot) => ({
    weapon: plan.weapons[1], armor: 'hide-coat', footwear: 'soft-boots',
    accessory: path === 'staff' ? 'spirit-pendant' : 'vitality-pendant',
  })[slot]) : [];
  let earnedStones = 0n;
  const checkpoints = [60, 300, 900, 1800, 3600].filter((t) => t <= duration);
  const times = { dungeon: 0, meditate: 0, practice: 0, idle: 0 };
  const budget = new Error('session-budget');
  const count = (id: string) => BigInt(state.inventory[id] ?? '0');
  const mark = (event: string) => events.push({ atSeconds: state.clockMs / 1000, event });
  const act = (command: GameCommand) => {
    const before = state;
    state = rules.applyCommand(state, command);
    commands.push({ atSeconds: state.clockMs / 1000, command });
    const delta: Record<string, string> = {};
    for (const item of content.items) {
      const change = count(item.id) - BigInt(before.inventory[item.id] ?? '0');
      if (change) delta[item.id] = change.toString();
    }
    const stones = BigInt(state.stones) - BigInt(before.stones);
    if (stones || Object.keys(delta).length) transactions.push({
      atSeconds: state.clockMs / 1000, command, stones: stones.toString(), inventory: delta,
    });
    if (command.type === 'consume' && growthItems.some((i) => i.id === command.itemId)) {
      growthConsumed[command.itemId] = (growthConsumed[command.itemId] ?? 0) - Number(delta[command.itemId] ?? 0);
    }
    if (command.type === 'craft') {
      const recipe = growthRecipes.find((r) => r.id === command.recipeId);
      if (recipe) growthCrafted[recipe.outputId] = (growthCrafted[recipe.outputId] ?? 0) + Number(delta[recipe.outputId] ?? 0);
    }
  };
  const unlocked = (gate: Content['recipes'][number]['unlock']) => 'level' in gate ? state.level >= gate.level
    : BigInt(state.regionKills[gate.regionId] ?? '0') >= BigInt(gate.kills);
  function quote(recipe: Content['recipes'][number]) {
    if (!unlocked(recipe.unlock)) return undefined;
    let cash = BigInt(recipe.stones);
    const purchases: { itemId: string; quantity: number }[] = [];
    for (const cost of recipe.costs) {
      const missing = BigInt(cost.quantity) - count(cost.itemId);
      if (missing <= 0n) continue;
      const item = content.items.find((i) => i.id === cost.itemId)!;
      if (!item.buyPrice || !unlocked(item.unlock)) return undefined;
      cash += missing * BigInt(item.buyPrice);
      purchases.push({ itemId: item.id, quantity: Number(missing) });
    }
    return { cash, purchases };
  }
  function growthReserve() {
    const next = orderedEquipment.find((id) => !state.equipment.some((entry) => entry.definitionId === id));
    const recipe = next && content.recipes.find((entry) => entry.outputKind === 'equipment' && entry.outputId === next);
    const equipmentCash = recipe ? quote(recipe)?.cash ?? 0n : 0n;
    return purchaseReserve > equipmentCash ? purchaseReserve : equipmentCash;
  }
  function growthReady() {
    return options?.growthPolicy === 'available' && (
      growthItems.some((item) => unlocked(item.unlock) && count(item.id) > 0n) ||
      growthRecipes.some((recipe) => {
        const price = quote(recipe);
        return price && BigInt(state.stones) >= price.cash + growthReserve();
      })
    );
  }
  function manageGrowth() {
    if (options?.growthPolicy !== 'available') return;
    const consume = () => {
      for (const item of growthItems) if (unlocked(item.unlock)) {
        while (count(item.id) > 0n) act({
          type: 'consume', itemId: item.id, quantity: Number(count(item.id) > 10000n ? 10000n : count(item.id)),
        });
      }
    };
    consume();
    let blocked = 0;
    while (blocked < growthRecipes.length) {
      const recipe = growthRecipes[nextGrowthRecipe];
      nextGrowthRecipe = (nextGrowthRecipe + 1) % growthRecipes.length;
      const price = quote(recipe);
      if (!price || BigInt(state.stones) < price.cash + growthReserve()) { blocked++; continue; }
      for (const purchase of price.purchases) act({ type: 'buy', ...purchase });
      act({ type: 'craft', recipeId: recipe.id, quantity: 1 });
      consume();
      blocked = 0;
    }
  }
  function equipmentReady() {
    const id = orderedEquipment.find((id) => !state.equipment.some((e) => e.definitionId === id));
    if (!id) return false;
    const recipe = content.recipes.find((r) => r.outputKind === 'equipment' && r.outputId === id)!;
    const price = quote(recipe);
    const reserve = id !== plan.weapons[1] && !state.equipment.some((e) => e.definitionId === plan.weapons[1])
      ? BigInt(options!.reserveStones) : 0n;
    return price && BigInt(state.stones) >= price.cash + reserve;
  }
  function snapshot() {
    return {
      atSeconds: state.clockMs / 1000, level: state.level, stones: state.stones,
      kills: state.totals.kills, inventory: { ...state.inventory }, times: { ...times },
      equipped: Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [
        slot, state.equipment.find((e) => e.instanceId === state.loadout[slot])?.definitionId ?? null,
      ])),
      technique: state.techniqueId, stats: rules.getPlayerStats(state),
      ...(options ? { techniqueXp: { ...state.techniqueXp }, hp: state.player.hp, mp: state.player.mp } : {}),
      growth: {
        attack: state.player.pillAttack, magicAttack: state.player.pillMagicAttack,
        defense: state.player.pillDefense, magicDefense: state.player.pillMagicDefense, maxHp: state.player.pillMaxHp,
      },
      proficiencies: rules.getGameView(state).proficiencies.map(({ id, xp, level }) => ({ id, xp, level })),
      crafting: structuredClone(state.crafting),
    };
  }
  function step() {
    if (state.clockMs >= duration * 1000) throw budget;
    const previous = state;
    times[state.activity.kind]++;
    if (state.activity.kind === 'dungeon') {
      combatSecondsByTechnique[state.techniqueId] = (combatSecondsByTechnique[state.techniqueId] ?? 0) + 1;
    }
    state = rules.advanceGame(state, state.clockMs + 1000);
    earnedStones += BigInt(state.stones) - BigInt(previous.stones);
    for (const item of content.items) {
      const delta = count(item.id) - BigInt(previous.inventory[item.id] ?? '0');
      if (!delta) continue;
      const table = delta > 0n ? drops : consumed;
      table[item.id] = (BigInt(table[item.id] ?? '0') + (delta > 0n ? delta : -delta)).toString();
    }
    if (state.level !== previous.level) mark(`realm:${state.level}`);
    if (previous.totals.kills === '0' && state.totals.kills !== '0') mark('first-kill');
    for (const region of content.regions) {
      const before = BigInt(previous.regionKills[region.id] ?? '0');
      const after = BigInt(state.regionKills[region.id] ?? '0');
      if (region.clear && before < BigInt(region.clear.waves) && after >= BigInt(region.clear.waves)) mark(`first-clear:${region.id}`);
      const gate = region.unlock;
      if ('regionId' in gate &&
          BigInt(previous.regionKills[gate.regionId] ?? '0') < BigInt(gate.kills) &&
          BigInt(state.regionKills[gate.regionId] ?? '0') >= BigInt(gate.kills)) mark(`unlock:${region.id}`);
    }
    if (!events.some((e) => e.event === 'first-material') &&
        content.items.some((i) => i.kind === 'material' && count(i.id) > BigInt(previous.inventory[i.id] ?? '0'))) mark('first-material');
    if (checkpoints.includes(state.clockMs / 1000)) snapshots.push(snapshot());
    if (previous.activity.kind === 'dungeon' && state.activity.kind !== 'dungeon') {
      mark(`stopped:${state.activity.stopReason}`);
      throw new Error(state.activity.stopReason);
    }
  }
  function rest() {
    act({ type: 'activity', kind: 'idle' });
    const stats = rules.getPlayerStats(state);
    while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) {
      const hp = dec(state.player.hp).lt(stats.maxHp);
      const mp = dec(state.player.mp).lt(stats.maxMp);
      step();
      restSeconds[hp && mp ? 'both' : hp ? 'hpOnly' : 'mpOnly']++;
    }
  }
  function selectTechnique(id: string, reason: string) {
    if (state.techniqueId === id) return;
    const from = state.techniqueId;
    act({ type: 'technique', techniqueId: id });
    techniqueSwitches.push({
      atSeconds: state.clockMs / 1000, from, to: id, reason,
      manaRemaining: content.settings.manaSupply ? count(content.settings.manaSupply.itemId).toString() : '0',
    });
  }
  function trip(regionId: string, kills = 5, stonesTarget?: bigint) {
    if (state.clockMs >= duration * 1000) throw budget;
    if (options && path === 'staff' && state.learnedTechniques?.includes(techniqueId)) {
      const supplied = count(content.settings.manaSupply!.itemId) > 0n;
      const useHigh = options.staffPolicy === 'high' || (options.staffPolicy === 'supplied' && supplied);
      selectTechnique(useHigh ? techniqueId : 'kindling',
        options.staffPolicy === 'supplied' ? (supplied ? 'supply-in-stock' : 'supply-exhausted') : options.staffPolicy);
    }
    manageGrowth();
    rest();
    const start = state;
    const usedBefore = content.settings.manaSupply ? BigInt(consumed[content.settings.manaSupply.itemId] ?? '0') : 0n;
    const goal = BigInt(state.totals.kills) + BigInt(kills);
    const attrition = options?.travelPolicy === 'attrition';
    const firstClearPending = BigInt(state.regionKills[regionId] ?? '0') < 20n;
    const end = attrition ? duration * 1000 : state.clockMs + 60_000;
    act({ type: 'supply', enabled: true, hpThreshold: 0.5 });
    act({ type: 'activity', kind: 'dungeon', targetId: regionId });
    let endReason = 'kill-target';
    try {
      while ((attrition || BigInt(state.totals.kills) < goal) && state.clockMs < end) {
        const previousKills = state.totals.kills;
        step();
        if (dec(state.player.hp).lt(dec(rules.getPlayerStats(state).maxHp).mul(0.25))) {
          endReason = 'low-hp';
          break;
        }
        if (attrition) {
          const stats = rules.getPlayerStats(state);
          const action = content.actions.find((a) => a.id === content.techniques.find((t) => t.id === state.techniqueId)!.actionId)!;
          const untilAction = Math.max(1, (state.player.nextActionMs - state.clockMs) / 1000);
          const hasManaSupply = state.manaSupply?.enabled && content.settings.manaSupply &&
            count(content.settings.manaSupply.itemId) > 0n;
          if (!hasManaSupply && dec(state.player.mp).plus(dec(stats.mpRegen).mul(untilAction)).lt(action.mpCost)) {
            endReason = 'low-mp';
            break;
          }
          if (state.totals.kills !== previousKills && (
            (firstClearPending && BigInt(state.regionKills[regionId] ?? '0') >= 20n) ||
            equipmentReady() || growthReady() || (stonesTarget !== undefined && BigInt(state.stones) >= stonesTarget)
          )) {
            endReason = 'management-ready';
            break;
          }
        }
      }
      if (state.clockMs >= end) endReason = attrition ? 'session-time-limit' : 'trip-time-limit';
    } catch (error) {
      endReason = error === budget ? 'session-time-limit' : state.activity.stopReason ?? 'error';
      throw error;
    } finally {
      if (options) trips.push({
        startedAtSeconds: start.clockMs / 1000, endedAtSeconds: state.clockMs / 1000,
        regionId, techniqueId: start.techniqueId,
        kills: (BigInt(state.totals.kills) - BigInt(start.totals.kills)).toString(),
        manaUsed: ((content.settings.manaSupply ? BigInt(consumed[content.settings.manaSupply.itemId] ?? '0') : 0n) - usedBefore).toString(),
        hp: state.player.hp, mp: state.player.mp, endReason,
        unfinishedEnemy: Boolean(state.battle &&
          dec(state.battle.hp).lt(content.enemies.find((enemy) => enemy.id === state.battle!.enemyId)!.maxHp)),
      });
    }
    act({ type: 'activity', kind: 'idle' });
  }
  function funds(amount: bigint, regionId = 'bamboo') {
    purchaseReserve = amount;
    try {
      while (BigInt(state.stones) < amount) trip(regionId, 5, amount);
    } finally {
      purchaseReserve = 0n;
    }
  }
  function forgeIfAffordable(equipmentId: string, compare = true) {
    const recipe = rules.getGameView(state).recipes.find((r) => r.outputKind === 'equipment' && r.outputId === equipmentId);
    if (!recipe?.unlocked) return false;
    const missing = recipe.costs.filter((cost) => cost.itemId !== 'stones' && count(cost.itemId) < BigInt(cost.quantity));
    const view = rules.getGameView(state);
    if (missing.some((cost) => !view.inventory.some((item) => item.id === cost.itemId && item.unlocked && item.buyPrice))) return false;
    const price = BigInt(recipe.costs.find((cost) => cost.itemId === 'stones')!.quantity) + missing.reduce((sum, cost) =>
      sum + (BigInt(cost.quantity) - count(cost.itemId)) * BigInt(content.items.find((i) => i.id === cost.itemId)!.buyPrice!), 0n);
    if (BigInt(state.stones) < price) return false;
    for (const cost of missing) act({ type: 'buy', itemId: cost.itemId, quantity: Number(BigInt(cost.quantity) - count(cost.itemId)) });
    const previousCount = state.equipment.length;
    act({ type: 'craft', recipeId: recipe.id, quantity: 1 });
    if (state.equipment.length === previousCount) {
      mark(`craft-failed:${equipmentId}`);
      return false;
    }
    const paid = state;
    const before = rules.getPlayerStats(state);
    act({ type: 'equip', slot: recipe.equipmentSlot!, instanceId: state.equipment.at(-1)!.instanceId });
    const window = compare ? options?.upgradeWindowSeconds ?? 0 : 0;
    const regionId = BigInt(state.regionKills.foothill ?? '0') >= 20n && state.level >= 3 ? 'bamboo' : 'foothill';
    upgrades.push({
      atSeconds: state.clockMs / 1000, equipmentId, before, after: rules.getPlayerStats(state), growth: snapshot().growth,
      ...(window ? { comparison: {
        before: equipmentSustainWindow(content, paid, recipe.equipmentSlot!, paid.loadout[recipe.equipmentSlot!], regionId, window),
        after: equipmentSustainWindow(content, paid, recipe.equipmentSlot!, state.loadout[recipe.equipmentSlot!], regionId, window),
      } } : {}),
    });
    mark(`crafted:${equipmentId}`);
    return true;
  }
  function investInOrder() {
    manageGrowth();
    for (const equipmentId of orderedEquipment) {
      if (state.equipment.some((e) => e.definitionId === equipmentId)) continue;
      const view = rules.getGameView(state);
      const recipe = view.recipes.find((r) => r.outputKind === 'equipment' && r.outputId === equipmentId);
      if (!recipe) throw new Error(`有序投入缺少配方：${equipmentId}`);
      const inventoryUsed: Record<string, string> = {};
      const unavailableMaterials: string[] = [];
      let cashCost = BigInt(recipe.costs.find((c) => c.itemId === 'stones')!.quantity);
      let inventoryReplacementValue = 0n;
      let inventorySaleValue = 0n;
      let allBoughtCost = cashCost;
      for (const cost of recipe.costs.filter((c) => c.itemId !== 'stones')) {
        const item = content.items.find((i) => i.id === cost.itemId)!;
        if (!item.buyPrice) throw new Error(`短途购买策略不支持无售价材料：${item.id}`);
        const quantity = BigInt(cost.quantity);
        const used = count(item.id) < quantity ? count(item.id) : quantity;
        inventoryUsed[item.id] = used.toString();
        inventoryReplacementValue += used * BigInt(item.buyPrice);
        inventorySaleValue += used * BigInt(item.sellPrice ?? '0');
        allBoughtCost += quantity * BigInt(item.buyPrice);
        const missing = quantity - used;
        cashCost += missing * BigInt(item.buyPrice);
        if (missing > 0n && !view.inventory.some((i) => i.id === item.id && i.unlocked)) unavailableMaterials.push(item.id);
      }
      // The reserve is a spending floor for extras before the weapon, not a free grant or a weapon price estimate.
      const reserve = equipmentId !== plan.weapons[1] && !state.equipment.some((e) => e.definitionId === plan.weapons[1])
        ? BigInt(options!.reserveStones) : 0n;
      const gap = cashCost + reserve - BigInt(state.stones);
      const decision = !recipe.unlocked ? 'locked' : unavailableMaterials.length ? 'materials'
        : BigInt(state.stones) < cashCost ? 'cash' : gap > 0n ? 'reserve' : 'buy';
      budgetDecisions.push({
        atSeconds: state.clockMs / 1000, equipmentId, unlocked: recipe.unlocked, availableStones: state.stones,
        cashCost: cashCost.toString(), reserveStones: reserve.toString(), cashShortfall: (gap > 0n ? gap : 0n).toString(),
        unavailableMaterials, inventoryUsed, inventoryReplacementValue: inventoryReplacementValue.toString(),
        inventorySaleValue: inventorySaleValue.toString(), allBoughtCost: allBoughtCost.toString(), decision,
      });
      if (decision !== 'buy') return;
      if (!forgeIfAffordable(equipmentId)) return;
    }
  }
  let stop: string | undefined;
  try {
    const first = content.recipes.find((r) => r.outputId === plan.weapons[0])!;
    while (!forgeIfAffordable(first.outputId, false)) trip('foothill');
    const healing = content.recipes.find((recipe) => recipe.id === 'healing')!;
    const healingCost = quote(healing);
    if (healingCost && BigInt(state.stones) >= healingCost.cash) {
      for (const purchase of healingCost.purchases) act({ type: 'buy', ...purchase });
      const before = count(healing.outputId);
      act({ type: 'craft', recipeId: healing.id, quantity: 1 });
      mark(`${count(healing.outputId) > before ? 'crafted' : 'craft-failed'}:healing-pill`);
    }
    act({ type: 'activity', kind: 'meditate' });
    while (state.level < 1) step();
    if (path === 'staff' && content.techniques.some((t) => t.id === 'kindling')) {
      funds(BigInt(content.items.find((item) => item.id === 'kindling-manual')!.buyPrice!), 'foothill');
      act({ type: 'buy', itemId: 'kindling-manual', quantity: 1 });
      act({ type: 'learn-technique', techniqueId: 'kindling' });
      act({ type: 'technique', techniqueId: 'kindling' });
      mark('learned:kindling');
    }
    if (options) investInOrder();
    while (BigInt(state.regionKills.foothill ?? '0') < 20n) {
      trip('foothill');
      if (loadoutPolicy === 'distributed' && !state.loadout.armor) forgeIfAffordable('hide-coat');
      if (options) investInOrder();
    }
    if (loadoutPolicy === 'distributed') forgeIfAffordable('soft-boots');
    act({ type: 'activity', kind: 'meditate' });
    while (state.level < 3) step();
    while (BigInt(state.regionKills.bamboo ?? '0') < 20n) {
      trip('bamboo');
      if (options && BigInt(state.regionKills.bamboo ?? '0') < 20n) investInOrder();
    }
    const manual = content.items.find((i) => i.id === technique.manualItemId)!;
    funds(BigInt(manual.buyPrice!));
    act({ type: 'buy', itemId: manual.id, quantity: 1 });
    act({ type: 'learn-technique', techniqueId: technique.id });
    if (!options) act({ type: 'technique', techniqueId: technique.id });
    else {
      learningCheckpoints.push({
        atSeconds: state.clockMs / 1000, techniqueId: technique.id, stones: state.stones, stateHash: hash(state),
      });
      if (path !== 'staff') selectTechnique(technique.id, 'learned');
    }
    mark(`learned:${technique.id}`);
    if (technique.id === 'flame' && content.settings.manaSupply) {
      const mana = content.items.find((i) => i.id === content.settings.manaSupply!.itemId)!;
      const affordable = Number(BigInt(state.stones) / BigInt(mana.buyPrice!));
      const limit = options?.manaPurchaseLimit ?? 2;
      if (affordable > 0 && limit > 0) act({ type: 'buy', itemId: mana.id, quantity: Math.min(limit, affordable) });
      act({ type: 'mana-supply', enabled: !options || options.staffPolicy !== 'low', mpThreshold: 0.3 });
    }
    if (options) {
      while (true) {
        investInOrder();
        if (options.preparation && BigInt(state.stones) >= BigInt(options.preparation.reserveStones) &&
            orderedEquipment.every((id) => state.equipment.some((e) => e.definitionId === id))) {
          act({ type: 'activity', kind: 'meditate' });
          while (state.level < options.preparation.level) step();
          act({ type: 'activity', kind: 'idle' });
          break;
        }
        trip('bamboo');
      }
    }
    const next = content.recipes.find((r) => r.outputId === plan.weapons[1])!;
    while (!options) {
      const missing = next.costs.filter((cost) => count(cost.itemId) < BigInt(cost.quantity));
      const canBuy = missing.every((cost) => content.items.find((i) => i.id === cost.itemId)!.buyPrice);
      const price = BigInt(next.stones) + missing.reduce((sum, cost) => {
        const item = content.items.find((i) => i.id === cost.itemId)!;
        return sum + (BigInt(cost.quantity) - count(cost.itemId)) * BigInt(item.buyPrice ?? '0');
      }, 0n);
      if (canBuy && BigInt(state.stones) >= price) {
        for (const cost of missing) act({ type: 'buy', itemId: cost.itemId, quantity: Number(BigInt(cost.quantity) - count(cost.itemId)) });
        const previousCount = state.equipment.length;
        act({ type: 'craft', recipeId: next.id, quantity: 1 });
        if (state.equipment.length === previousCount) {
          mark(`craft-failed:${next.outputId}`);
          continue;
        }
        const before = rules.getPlayerStats(state);
        act({ type: 'equip', slot: 'weapon', instanceId: state.equipment.at(-1)!.instanceId });
        upgrades.push({
          atSeconds: state.clockMs / 1000, equipmentId: next.outputId,
          before, after: rules.getPlayerStats(state),
        });
        mark(`crafted:${next.outputId}`);
        break;
      }
      trip('bamboo');
    }
    const extras = path === 'staff' ? ['spirit-pendant', 'iron-scale-armor'] : ['vitality-pendant', 'iron-scale-armor'];
    while (!options) {
      if (loadoutPolicy === 'distributed') {
        const nextId = extras.find((id) => !state.equipment.some((entry) => entry.definitionId === id));
        if (nextId) forgeIfAffordable(nextId);
      }
      trip('bamboo');
    }
  } catch (error) {
    if (error !== budget) {
      if (!(error instanceof Error) || !error.message.includes('战败')) throw error;
      stop = error.message;
    }
  }
  const endComparisons = options?.compareAtEnd && options.upgradeWindowSeconds && !stop
    ? (['weapon', 'accessory'] as const).flatMap((slot) => {
      const current = state.equipment.find((e) => e.instanceId === state.loadout[slot]);
      if (!current) return [];
      const previous = state.equipment.find((e) => e.instanceId !== current.instanceId &&
        content.equipment.find((definition) => definition.id === e.definitionId)!.slot === slot);
      if (slot === 'weapon' && !previous) return [];
      return [{
        slot, equipmentId: current.definitionId, atSeconds: state.clockMs / 1000, growth: snapshot().growth,
        before: equipmentSustainWindow(content, state, slot, previous?.instanceId ?? null, 'bamboo', options.upgradeWindowSeconds!),
        after: equipmentSustainWindow(content, state, slot, current.instanceId, 'bamboo', options.upgradeWindowSeconds!),
      }];
    }) : [];
  const meaningful = events.filter((e) => /^(realm|unlock|learned|crafted|first-clear):/.test(e.event));
  const edges = [0, ...meaningful.map((e) => e.atSeconds), state.clockMs / 1000];
  let replay = rules.createGame(0, seed);
  for (const { atSeconds, command } of commands) {
    replay = catchUpWith(rules, replay, atSeconds * 1000);
    replay = rules.applyCommand(replay, command);
  }
  replay = catchUpWith(rules, replay, state.clockMs);
  if (hash(replay) !== hash(state)) throw new Error('短时路线命令重放不一致');
  const accountedStones = BigInt(content.settings.starterStones) + earnedStones +
    transactions.reduce((sum, entry) => sum + BigInt(entry.stones), 0n);
  if (accountedStones !== BigInt(state.stones)) throw new Error('短时路线灵石收支不一致');
  for (const item of content.items) {
    const accounted = BigInt(content.settings.starterItems[item.id] ?? '0') + BigInt(drops[item.id] ?? '0') -
      BigInt(consumed[item.id] ?? '0') + transactions.reduce((sum, entry) => sum + BigInt(entry.inventory[item.id] ?? '0'), 0n);
    if (accounted !== count(item.id)) throw new Error(`短时路线物品收支不一致：${item.id}`);
  }
  if (Object.values(times).reduce((sum, seconds) => sum + seconds, 0) !== state.clockMs / 1000) {
    throw new Error('短时路线活动时间不一致');
  }
  if (options && (Object.values(restSeconds).reduce((sum, seconds) => sum + seconds, 0) !== times.idle ||
      trips.reduce((sum, trip) => sum + trip.endedAtSeconds - trip.startedAtSeconds, 0) !== times.dungeon ||
      trips.reduce((sum, trip) => sum + BigInt(trip.kills), 0n) !== BigInt(state.totals.kills))) {
    throw new Error('短时路线行程或休整时间不一致');
  }
  return { state, report: {
    path, techniqueId, loadoutPolicy, seed, contentVersion: content.version, duration, stop, events, snapshots, upgrades,
    growthPolicy: options?.growthPolicy === 'available'
      ? 'Consume every unlocked growth pill; reserve cash for explicit purchase goals and the next unlocked ordered equipment; craft affordable early-tier pills round-robin from real stock and paid materials. Failed attempts consume costs; no potency-based stopping or quantity cap.'
      : 'Short-session control: no growth crafting or consumption; natural pill drops remain in inventory.',
    growthCrafted, growthConsumed, endComparisons,
    longestMilestoneGapSeconds: Math.max(...edges.slice(1).map((end, i) => end - edges[i])),
    purchases: commands.flatMap(({ atSeconds, command }) => command.type === 'buy'
      ? [{ atSeconds, itemId: command.itemId, quantity: command.quantity }] : []),
    ledger: { startingStones: content.settings.starterStones, earnedStones: earnedStones.toString(), drops, consumed, transactions, reconciled: true },
    replayVerified: true,
    ...(options ? {
      strategy: options, orderedEquipment, budgetDecisions, trips, techniqueSwitches, learningCheckpoints,
      combatSecondsByTechnique, restSeconds, timeReconciled: true,
    } : {}),
    end: snapshot(), commandCount: commands.length, commandHash: hash(commands), stateHash: hash(state),
  } };
}

export function firstSession(...args: Parameters<typeof runFirstSession>) {
  return runFirstSession(...args).report;
}

export function challengePreparation(
  content: Content, path: EquipmentPath, seed: number, level: number, duration: number, order: SessionOrder, manaStock: number,
) {
  const reserveStones = path === 'staff' ? manaStock * Number(content.items.find((i) =>
    i.id === content.settings.manaSupply!.itemId)!.buyPrice!) : 0;
  const prepared = runFirstSession(content, path, seed, duration, undefined, 'ordered', {
    order, staffPolicy: 'low', manaPurchaseLimit: 0, reserveStones: 0,
    travelPolicy: 'attrition', growthPolicy: 'available', preparation: { level, reserveStones },
  });
  if (prepared.report.stop || prepared.state.level !== level ||
      EQUIPMENT_SLOTS.some((slot) => !prepared.state.loadout[slot]) || BigInt(prepared.state.stones) < BigInt(reserveStones)) {
    throw new Error(`挑战准备不足：${path}/${seed}，实际炼气${prepared.state.level}层，耗时${prepared.state.clockMs / 1000}秒`);
  }
  return prepared;
}

// Short single-enemy challenges include full recovery cost, not an optimal farming policy.
export function challengeTrials(
  content: Content, original: GameState, techniqueId: string, regionId: string, fights: number, manaStock: number,
) {
  const rules = createRules(content);
  let state = original;
  const commands: { atMs: number; command: GameCommand }[] = [];
  const act = (command: GameCommand) => {
    commands.push({ atMs: state.clockMs, command });
    state = rules.applyCommand(state, command);
  };
  const manaId = content.settings.manaSupply!.itemId;
  const manaPrice = BigInt(content.items.find((item) => item.id === manaId)!.buyPrice!);
  const manaBought = Math.min(Math.max(0, manaStock - Number(state.inventory[manaId] ?? '0')),
    Number(BigInt(state.stones) / manaPrice));
  act({ type: 'activity', kind: 'idle' });
  act({ type: 'technique', techniqueId });
  if (manaBought) act({ type: 'buy', itemId: manaId, quantity: manaBought });
  act({ type: 'supply', enabled: false, hpThreshold: 0.5 });
  act({ type: 'mana-supply', enabled: manaStock > 0, mpThreshold: 0.3 });
  const paidStateHash = hash(state);
  const inventory = { ...state.inventory };
  const startingStones = state.stones;
  const drops: Record<string, string> = {};
  const used: Record<string, string> = {};
  const times = { combat: 0, recovery: 0 };
  let earnedStones = 0n;
  const step = (kind: keyof typeof times) => {
    const before = state;
    state = rules.advanceGame(state, state.clockMs + 1000);
    times[kind]++;
    earnedStones += BigInt(state.stones) - BigInt(before.stones);
    for (const item of content.items) {
      const delta = BigInt(state.inventory[item.id] ?? '0') - BigInt(before.inventory[item.id] ?? '0');
      if (!delta) continue;
      const table = delta > 0n ? drops : used;
      table[item.id] = (BigInt(table[item.id] ?? '0') + (delta > 0n ? delta : -delta)).toString();
    }
  };
  const rest = () => {
    act({ type: 'activity', kind: 'idle' });
    const stats = rules.getPlayerStats(state);
    const started = state.clockMs;
    while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) {
      step('recovery');
      if (state.clockMs - started > 3_600_000) throw new Error('挑战休整超时');
    }
  };
  rest();
  const initialRecoverySeconds = times.recovery;
  const stats = rules.getPlayerStats(state);
  const groups: Record<string, {
    enemyId: string; enemyLevel: number; rank: string; playerLevel: number; levelGap: number;
    attempts: number; wins: number; seconds: number; maxSeconds: number;
    minHpPercent: number; endingHpPercentSum: number; fallbacks: number;
  }> = {};
  let first: { enemyId: string; rng: number; seconds?: number; won?: boolean; minHpPercent?: number } | undefined;
  let stop = 'fight-limit';
  for (let index = 0; index < fights; index++) {
    act({ type: 'activity', kind: 'dungeon', targetId: regionId });
    const start = state;
    const enemy = content.enemies.find((e) => e.id === start.battle!.enemyId)!;
    first ??= { enemyId: enemy.id, rng: start.rng };
    const key = `${enemy.id}/${state.level}`;
    const group = groups[key] ??= {
      enemyId: enemy.id, enemyLevel: enemy.allocation!.level, rank: enemy.allocation!.rank,
      playerLevel: state.level, levelGap: enemy.allocation!.level - state.level,
      attempts: 0, wins: 0, seconds: 0, maxSeconds: 0, minHpPercent: 100, endingHpPercentSum: 0, fallbacks: 0,
    };
    let minimumHp = 100;
    const action = content.actions.find((a) => a.id === content.techniques.find((t) => t.id === techniqueId)!.actionId)!;
    while (state.activity.kind === 'dungeon' && state.totals.kills === start.totals.kills &&
        state.clockMs - start.clockMs < 120_000) {
      const before = state;
      const current = rules.getPlayerStats(state);
      const readyMana = dec(before.player.mp).plus(current.mpRegen);
      step('combat');
      if (state.player.nextActionMs !== before.player.nextActionMs) {
        const supplied = BigInt(before.inventory[manaId] ?? '0') > BigInt(state.inventory[manaId] ?? '0');
        const available = readyMana.lt(current.maxMp) ? readyMana : dec(current.maxMp);
        if (!supplied && available.lt(action.mpCost)) group.fallbacks++;
      }
      minimumHp = Math.min(minimumHp, dec(state.player.hp).div(current.maxHp).mul(100).toNumber());
    }
    const seconds = (state.clockMs - start.clockMs) / 1000;
    const won = state.totals.kills !== start.totals.kills;
    group.attempts++;
    group.wins += Number(won);
    group.seconds += seconds;
    group.maxSeconds = Math.max(group.maxSeconds, seconds);
    group.minHpPercent = Math.min(group.minHpPercent, minimumHp);
    group.endingHpPercentSum += dec(state.player.hp).div(rules.getPlayerStats(state).maxHp).mul(100).toNumber();
    if (index === 0) Object.assign(first!, { seconds, won, minHpPercent: minimumHp });
    if (!won) { stop = state.activity.stopReason ?? 'single-fight-time-limit'; break; }
    rest();
    if (state.level !== original.level) { stop = 'level-changed'; break; }
  }
  let replay = original;
  for (const { atMs, command } of commands) {
    replay = catchUpWith(rules, replay, atMs);
    replay = rules.applyCommand(replay, command);
  }
  replay = catchUpWith(rules, replay, state.clockMs);
  if (hash(replay) !== hash(state)) throw new Error('挑战重放不一致');
  for (const item of content.items) {
    if (BigInt(inventory[item.id] ?? '0') + BigInt(drops[item.id] ?? '0') - BigInt(used[item.id] ?? '0') !==
        BigInt(state.inventory[item.id] ?? '0')) throw new Error('挑战物品账本不一致');
  }
  if (BigInt(startingStones) + earnedStones !== BigInt(state.stones) ||
      times.combat + times.recovery !== (state.clockMs - original.clockMs) / 1000) throw new Error('挑战收支或时间不一致');
  return {
    techniqueId, regionId, playerLevel: original.level, stats, practiceXp: original.techniqueXp[techniqueId],
    manaStock, manaBought, manaCost: (BigInt(manaBought) * manaPrice).toString(),
    initialRecoverySeconds, times, kills: (BigInt(state.totals.kills) - BigInt(original.totals.kills)).toString(),
    cultivation: dec(state.totals.cultivationGained).minus(original.totals.cultivationGained).toFixed(),
    earnedStones: earnedStones.toString(), drops, suppliesUsed: used, groups: Object.values(groups), first, stop,
    originStateHash: hash(original), paidStateHash, stateHash: hash(state),
    replayVerified: true, ledgerReconciled: true,
  };
}

export function combatPreparation(content: Content, path: EquipmentPath, seed: number) {
  const prepared = equipmentFoundation(path, seed, true, {
    profile: content, tripKills: 1, compareUpgrades: false, consumeGrowth: false,
    latePreparationLevel: 12, stopAt: 'foundation-ready',
  });
  const rules = createRules(content);
  let state = rules.applyCommand(prepared.state, { type: 'activity', kind: 'practice', targetId: equipmentPaths[path].technique });
  const technique = content.techniques.find((t) => t.id === state.techniqueId)!;
  while (dec(state.techniqueXp[technique.id]).lt(technique.xpCap)) {
    state = catchUpWith(rules, state, state.clockMs + 1000);
  }
  state = rules.applyCommand(state, { type: 'activity', kind: 'idle' });
  const stats = rules.getPlayerStats(state);
  while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) {
    state = rules.advanceGame(state, state.clockMs + 1000);
  }
  return {
    state, summary: {
      path, seed, atSeconds: state.clockMs / 1000, level: state.level, stats,
      initialGrowth: { attack: state.player.pillAttack, defense: state.player.pillDefense, maxHp: state.player.pillMaxHp },
      techniqueXp: state.techniqueXp[technique.id], stones: state.stones,
      equipment: state.equipment.at(-1)!.definitionId, preparationLedger: prepared.ledger,
      stateHash: hash(state),
    },
  };
}

export function switchCombatTechnique(content: Content, original: GameState, techniqueId: string) {
  const rules = createRules(content);
  const technique = content.techniques.find((t) => t.id === techniqueId)!;
  let state = original;
  if (!state.learnedTechniques!.includes(techniqueId)) {
    state = rules.applyCommand(state, { type: 'buy', itemId: technique.manualItemId!, quantity: 1 });
    state = rules.applyCommand(state, { type: 'learn-technique', techniqueId });
  }
  state = rules.applyCommand(state, { type: 'technique', techniqueId });
  state = rules.applyCommand(state, { type: 'activity', kind: 'practice', targetId: techniqueId });
  while (dec(state.techniqueXp[techniqueId]).lt(technique.xpCap)) state = catchUpWith(rules, state, state.clockMs + 1000);
  state = rules.applyCommand(state, { type: 'activity', kind: 'idle' });
  const stats = rules.getPlayerStats(state);
  while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) {
    state = rules.advanceGame(state, state.clockMs + 1000);
  }
  return {
    state, preparation: {
      techniqueId, stonesSpent: (BigInt(original.stones) - BigInt(state.stones)).toString(),
      secondsSpent: (state.clockMs - original.clockMs) / 1000, stats, stateHash: hash(state),
    },
  };
}

export function combatWindow(
  content: Content, original: GameState, regionId: string, manaStock: number,
  checkpoints = [60, 300, 600, 1800, 3600],
) {
  const rules = createRules(content);
  let state = original;
  const purchases: Record<string, number> = {};
  const buy = (itemId: string, target: number) => {
    const item = content.items.find((i) => i.id === itemId)!;
    const missing = Math.max(0, target - Number(state.inventory[itemId] ?? '0'));
    const quantity = Math.min(missing, Number(BigInt(state.stones) / BigInt(item.buyPrice!)));
    if (quantity) state = rules.applyCommand(state, { type: 'buy', itemId, quantity });
    purchases[itemId] = quantity;
  };
  buy(content.settings.supplyItemId, 30);
  buy(content.settings.manaSupply!.itemId, manaStock);
  const initialInventory = { ...state.inventory };
  state = rules.applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 0.5 });
  state = rules.applyCommand(state, { type: 'mana-supply', enabled: manaStock > 0, mpThreshold: 0.3 });
  state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: regionId });
  const start = state;
  const snapshots = [];
  for (const seconds of checkpoints) {
    state = catchUpWith(rules, state, start.clockMs + seconds * 1000);
    const used = (id: string) => (BigInt(initialInventory[id] ?? '0') - BigInt(state.inventory[id] ?? '0')).toString();
    const healingUsed = used(content.settings.supplyItemId);
    const manaUsed = used(content.settings.manaSupply!.itemId);
    const supplyCost = BigInt(healingUsed) * BigInt(content.items.find((i) => i.id === content.settings.supplyItemId)!.buyPrice!) +
      BigInt(manaUsed) * BigInt(content.items.find((i) => i.id === content.settings.manaSupply!.itemId)!.buyPrice!);
    const activeSeconds = BigInt(state.totals.activeSeconds) - BigInt(start.totals.activeSeconds);
    snapshots.push({
      seconds, activeSeconds: activeSeconds.toString(),
      kills: (BigInt(state.totals.kills) - BigInt(start.totals.kills)).toString(),
      stonesEarned: (BigInt(state.stones) - BigInt(start.stones)).toString(), supplyReplacementCost: supplyCost.toString(),
      healingUsed, manaUsed, hp: state.player.hp, mp: state.player.mp,
      healingRemaining: state.inventory[content.settings.supplyItemId] ?? '0',
      manaRemaining: state.inventory[content.settings.manaSupply!.itemId] ?? '0',
      ...(state.activity.kind !== 'dungeon' ? {
        stop: state.activity.stopReason, stoppedAfterSeconds: (state.activity.stoppedAt! - start.clockMs) / 1000,
      } : {}),
    });
  }
  return {
    regionId, manaStock, purchases, purchaseCost: (BigInt(original.stones) - BigInt(start.stones)).toString(),
    startingHp: start.player.hp, startingMp: start.player.mp,
    startingHealing: initialInventory[content.settings.supplyItemId] ?? '0',
    startingMana: initialInventory[content.settings.manaSupply!.itemId] ?? '0',
    snapshots, startStateHash: hash(start), endStateHash: hash(state),
  };
}
