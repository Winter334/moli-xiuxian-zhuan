import { createRules } from './game';
import { equipmentProfile } from './equipment-candidate';
import { dec } from './numbers';
import { catchUpWith } from './dwelling-scenarios';
import type { Content } from './content';
import type { GameCommand, GameState } from './types';

export const equipmentPaths = {
  sword: { weapons: ['wood-sword', 'iron-sword', 'bamboo-edge'], technique: 'verdant' },
  gauntlet: { weapons: ['leather-gauntlet', 'stone-gauntlet', 'sand-gauntlet'], technique: 'mountain' },
  staff: { weapons: ['jujube-staff', 'green-staff', 'jade-staff'], technique: 'flame' },
} as const;
export type EquipmentPath = keyof typeof equipmentPaths;
type Rules = ReturnType<typeof createRules>;

function battleSample(rules: Rules, original: GameState, instanceId: string, regionId: string) {
  let state = rules.applyCommand(original, { type: 'equip', slot: 'weapon', instanceId });
  state = rules.applyCommand(state, { type: 'activity', kind: 'idle' });
  const stats = rules.getPlayerStats(state);
  while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) {
    state = rules.advanceGame(state, state.clockMs + 1000);
    if (state.clockMs - original.clockMs > 3_600_000) throw new Error('战斗比较休整超时');
  }
  state = rules.applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 0.5 });
  state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: regionId });
  const start = state;
  state = catchUpWith(rules, state, state.clockMs + 600_000);
  return {
    kills: (BigInt(state.totals.kills) - BigInt(start.totals.kills)).toString(),
    pillsUsed: (BigInt(state.totals.pillsUsed) - BigInt(start.totals.pillsUsed)).toString(),
    activeSeconds: (BigInt(state.totals.activeSeconds) - BigInt(start.totals.activeSeconds)).toString(),
    finalHp: state.player.hp, stopped: state.activity.kind === 'idle',
  };
}

// Explicit player decisions, not new automatic farming/resume behavior.
export function equipmentFoundation(
  path: EquipmentPath, seed = 1, plainOnly = false,
  options: {
    ruinsSupply?: number; latePreparationLevel?: number; profile?: Content;
    growthCraftsPerTier?: number; consumeGrowth?: boolean;
    lateWeaponId?: string; stopAt?: 'early-setup' | 'late-preparation' | 'foundation-ready';
    tripKills?: number; compareUpgrades?: boolean;
  } = {},
) {
  const { ruinsSupply = 20, latePreparationLevel = 9, growthCraftsPerTier = 0, consumeGrowth = false } = options;
  if (!Number.isSafeInteger(ruinsSupply) || ruinsSupply < 0 || ruinsSupply > 1000) throw new Error('样本补给目标非法');
  if (!Number.isSafeInteger(latePreparationLevel) || latePreparationLevel < 3 || latePreparationLevel > 12) throw new Error('样本取材境界非法');
  if (!Number.isSafeInteger(growthCraftsPerTier) || growthCraftsPerTier < 0 || growthCraftsPerTier > 100) throw new Error('属性丹投入数量非法');
  const tripKills = options.tripKills ?? 20;
  if (!Number.isSafeInteger(tripKills) || tripKills < 1 || tripKills > 1000) throw new Error('取材行程目标非法');
  const rules = createRules(options.profile ?? equipmentProfile(plainOnly));
  if ((consumeGrowth || growthCraftsPerTier) && !rules.content.growthPillTiers) throw new Error('当前测算配置不支持分级属性丹');
  const plan = equipmentPaths[path];
  let state = rules.createGame(0, seed);
  const seconds = { idle: 0, dungeon: 0, meditate: 0, practice: 0 };
  const commands: { atSeconds: number; command: GameCommand }[] = [];
  const ledger = {
    purchased: {} as Record<string, string>, sold: {} as Record<string, string>,
    purchaseStones: '0', saleStones: '0', forgingStones: '0', pillCraftStones: '0', manualStones: '0',
    forgingMaterials: {} as Record<string, string>,
    growthCrafted: {} as Record<string, string>, growthConsumed: {} as Record<string, string>,
    growthDropped: {} as Record<string, string>, growthMaterials: {} as Record<string, string>, growthCraftStones: '0',
    enemyKills: {} as Record<string, string>,
  };
  const growthItems = rules.content.items.filter((item) => item.kind === 'growth');
  const growthCheckpoints: {
    tierId: string; atSeconds: number; preparationSeconds: number;
    attack: string; defense: string; maxHp: string;
  }[] = [];
  const milestones: { event: string; atSeconds: number; level: number }[] = [];
  const upgrades: {
    definitionId: string; quality: string; level: number; atSeconds: number; preparationSeconds: number;
    statsBefore: ReturnType<Rules['getPlayerStats']>; statsAfter: ReturnType<Rules['getPlayerStats']>;
    comparison?: { regionId: string; before: ReturnType<typeof battleSample>; after: ReturnType<typeof battleSample> };
  }[] = [];
  const count = (id: string) => BigInt(state.inventory[id] ?? '0');
  const addCount = (table: Record<string, string>, id: string, n: bigint) => {
    table[id] = (BigInt(table[id] ?? '0') + n).toString();
  };
  const act = (command: GameCommand) => {
    const before = state;
    state = rules.applyCommand(state, command);
    commands.push({ atSeconds: state.clockMs / 1000, command });
    if (command.type === 'buy' || command.type === 'sell') {
      const buying = command.type === 'buy';
      addCount(buying ? ledger.purchased : ledger.sold, command.itemId, BigInt(command.quantity));
      const field = buying ? 'purchaseStones' : 'saleStones';
      const amount = buying ? BigInt(before.stones) - BigInt(state.stones) : BigInt(state.stones) - BigInt(before.stones);
      ledger[field] = (BigInt(ledger[field]) + amount).toString();
      if (buying && rules.content.items.find((item) => item.id === command.itemId)!.kind === 'manual') {
        ledger.manualStones = (BigInt(ledger.manualStones) + amount).toString();
      }
    }
    if (command.type === 'craft') {
      const recipe = rules.content.recipes.find((entry) => entry.id === command.recipeId)!;
      const field = recipe.outputKind ? 'forgingStones' : 'pillCraftStones';
      ledger[field] = (BigInt(ledger[field]) + BigInt(recipe.stones) * BigInt(command.quantity)).toString();
      if (recipe.outputKind) for (const cost of recipe.costs) {
        addCount(ledger.forgingMaterials, cost.itemId, BigInt(cost.quantity) * BigInt(command.quantity));
      }
      if (!recipe.outputKind && growthItems.some((item) => item.id === recipe.outputId)) {
        addCount(ledger.growthCrafted, recipe.outputId, count(recipe.outputId) - BigInt(before.inventory[recipe.outputId] ?? '0'));
        ledger.growthCraftStones = (BigInt(ledger.growthCraftStones) + BigInt(recipe.stones) * BigInt(command.quantity)).toString();
        for (const cost of recipe.costs) addCount(ledger.growthMaterials, cost.itemId, BigInt(cost.quantity) * BigInt(command.quantity));
      }
    }
    if (command.type === 'consume' && growthItems.some((item) => item.id === command.itemId)) {
      addCount(ledger.growthConsumed, command.itemId, BigInt(before.inventory[command.itemId]) - count(command.itemId));
    }
  };
  const step = (n = 1) => {
    const kind = state.activity.kind;
    const before = state;
    state = catchUpWith(rules, state, state.clockMs + n * 1000);
    if (before.battle && state.totals.kills !== before.totals.kills) {
      if (BigInt(state.totals.kills) - BigInt(before.totals.kills) !== 1n) throw new Error('逐秒战斗样本不能跨过多次击败');
      addCount(ledger.enemyKills, before.battle.enemyId, 1n);
    }
    if (rules.content.growthPillTiers) for (const item of growthItems) {
      const received = count(item.id) - BigInt(before.inventory[item.id] ?? '0');
      if (received > 0n) addCount(ledger.growthDropped, item.id, received);
    }
    seconds[kind] += n;
    if (state.clockMs > 7 * 86_400_000) throw new Error(`${path}/${seed}: 样本超过七日预算`);
  };
  const mark = (event: string) => milestones.push({ event, atSeconds: state.clockMs / 1000, level: state.level });
  const consumeGrowthInventory = () => {
    if (!consumeGrowth) return;
    for (const item of growthItems) {
      while (count(item.id) > 0n) {
        act({ type: 'consume', itemId: item.id, quantity: Number(count(item.id) > 10_000n ? 10_000n : count(item.id)) });
      }
    }
  };
  const rest = () => {
    act({ type: 'activity', kind: 'idle' });
    const stats = rules.getPlayerStats(state);
    while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) step();
  };
  const meditateTo = (level: number, full = false) => {
    act({ type: 'activity', kind: 'meditate' });
    while (state.level < level || (full && dec(state.cultivation).lt(rules.content.realms[level].required))) step(30);
    act({ type: 'activity', kind: 'idle' });
    mark(full ? '十二层修满' : `到达炼气${level}层`);
  };
  const sellSurplus = (keep: Record<string, bigint>) => {
    for (const item of rules.content.items) {
      if (item.kind !== 'material' || !item.sellPrice) continue;
      let excess = count(item.id) - (keep[item.id] ?? 0n);
      while (excess > 0n) {
        const quantity = Number(excess > 10_000n ? 10_000n : excess);
        act({ type: 'sell', itemId: item.id, quantity });
        excess -= BigInt(quantity);
      }
    }
  };
  function farmTrip(regionId: string, keep: Record<string, bigint> = {}) {
    if (regionId !== 'foothill') {
      const missing = BigInt(regionId === 'ruins' ? ruinsSupply : 8) - count('healing-pill');
      if (missing > 0n) {
        funds(missing * 8n, keep);
        act({ type: 'buy', itemId: 'healing-pill', quantity: Number(missing) });
      }
    }
    rest();
    act({ type: 'supply', enabled: true, hpThreshold: 0.5 });
    const goal = BigInt(state.regionKills[regionId] ?? '0') + BigInt(tripKills);
    act({ type: 'activity', kind: 'dungeon', targetId: regionId });
    while (BigInt(state.regionKills[regionId] ?? '0') < goal) {
      step();
      if (state.activity.kind !== 'dungeon') throw new Error(JSON.stringify({
        path, seed, regionId, reason: state.activity.stopReason, level: state.level,
        kills: state.regionKills[regionId], goal: goal.toString(), remainingPills: count('healing-pill').toString(),
        stats: rules.getPlayerStats(state), usedPills: state.totals.pillsUsed,
      }));
    }
    act({ type: 'activity', kind: 'idle' });
    consumeGrowthInventory();
  }
  function funds(target: bigint, keep: Record<string, bigint>) {
    sellSurplus(keep);
    while (BigInt(state.stones) < target) {
      farmTrip('foothill', keep);
      sellSurplus(keep);
    }
  }
  const sources: Record<string, string> = {
    hide: 'foothill', herb: 'foothill', armor: 'bamboo', 'spirit-bamboo': 'bamboo',
    'dense-ore': 'quarry', heartwood: 'ruins', 'warm-jade': 'pool',
    'dew-flower': 'pool', 'moon-fungus': 'ruins', essence: 'ruins',
    blood: 'bamboo', 'stone-marrow': 'quarry',
  };
  const prepare = (costs: { itemId: string; quantity: string }[], stones: string) => {
    const keep = Object.fromEntries(costs.map((cost) => [cost.itemId, BigInt(cost.quantity)]));
    keep.herb = (keep.herb ?? 0n) > 30n ? keep.herb : 30n;
    for (const cost of costs) {
      if (count(cost.itemId) >= BigInt(cost.quantity)) continue;
      if (['timber', 'copper', 'ore'].includes(cost.itemId)) {
        const item = rules.content.items.find((entry) => entry.id === cost.itemId)!;
        const missing = BigInt(cost.quantity) - count(item.id);
        funds(BigInt(stones) + missing * BigInt(item.buyPrice!), keep);
        act({ type: 'buy', itemId: item.id, quantity: Number(missing) });
      } else {
        const source = sources[cost.itemId];
        if (!source) throw new Error(`缺少材料策略：${cost.itemId}`);
        while (count(cost.itemId) < BigInt(cost.quantity)) farmTrip(source, keep);
      }
    }
    funds(BigInt(stones), keep);
  };
  const grow = (tierId: string) => {
    if (!growthCraftsPerTier) return;
    const start = state.clockMs;
    for (const item of growthItems.filter((entry) => entry.use?.kind === 'growth' && entry.use.tierId === tierId)) {
      const recipe = rules.content.recipes.find((entry) => !entry.outputKind && entry.outputId === item.id)!;
      while ('regionId' in recipe.unlock && BigInt(state.regionKills[recipe.unlock.regionId] ?? '0') < BigInt(recipe.unlock.kills)) {
        farmTrip(recipe.unlock.regionId);
      }
      prepare(recipe.costs.map((cost) => ({
        ...cost, quantity: (BigInt(cost.quantity) * BigInt(growthCraftsPerTier)).toString(),
      })), (BigInt(recipe.stones) * BigInt(growthCraftsPerTier)).toString());
      act({ type: 'craft', recipeId: recipe.id, quantity: growthCraftsPerTier });
      consumeGrowthInventory();
    }
    growthCheckpoints.push({
      tierId, atSeconds: state.clockMs / 1000, preparationSeconds: (state.clockMs - start) / 1000,
      attack: state.player.pillAttack, defense: state.player.pillDefense!, maxHp: state.player.pillMaxHp!,
    });
    mark(`完成${tierId}属性丹投入`);
  };
  const forge = (definitionId: string, first = false) => {
    const start = state.clockMs;
    const recipe = rules.content.recipes.find((entry) => entry.outputKind && entry.outputId === definitionId)!;
    if (first) {
      for (const cost of recipe.costs) act({ type: 'buy', itemId: cost.itemId, quantity: Number(cost.quantity) });
    } else prepare(recipe.costs, recipe.stones);
    const oldId = state.loadout.weapon;
    const statsBefore = rules.getPlayerStats(state);
    const previousCount = state.equipment.length;
    act({ type: 'craft', recipeId: recipe.id, quantity: 1 });
    while (state.equipment.length === previousCount) {
      mark(`炼制失败：${recipe.name}`);
      prepare(recipe.costs, recipe.stones);
      act({ type: 'craft', recipeId: recipe.id, quantity: 1 });
    }
    const instance = state.equipment.at(-1)!;
    const comparisonRegion = upgrades.length === 1 ? 'quarry' : 'ruins';
    const comparison = oldId && options.compareUpgrades !== false ? {
      regionId: comparisonRegion,
      before: battleSample(rules, state, oldId, comparisonRegion),
      after: battleSample(rules, state, instance.instanceId, comparisonRegion),
    } : undefined;
    act({ type: 'equip', slot: 'weapon', instanceId: instance.instanceId });
    upgrades.push({
      definitionId, quality: instance.quality!.id, level: state.level,
      atSeconds: state.clockMs / 1000, preparationSeconds: (state.clockMs - start) / 1000,
      statsBefore, statsAfter: rules.getPlayerStats(state), ...(comparison ? { comparison } : {}),
    });
    mark(`打造并装备${recipe.name.replace('制法', '')}`);
  };

  forge(plan.weapons[0], true);
  meditateTo(3);
  do { farmTrip('foothill'); } while (BigInt(state.regionKills.foothill) < 5n);
  do { farmTrip('bamboo'); } while (BigInt(state.regionKills.bamboo) < 20n);
  forge(plan.weapons[1]);
  const technique = rules.content.techniques.find((entry) => entry.id === plan.technique)!;
  const manual = rules.content.items.find((entry) => entry.id === technique.manualItemId)!;
  funds(BigInt(manual.buyPrice!), { herb: 30n });
  act({ type: 'buy', itemId: manual.id, quantity: 1 });
  act({ type: 'learn-technique', techniqueId: technique.id });
  act({ type: 'technique', techniqueId: technique.id });
  mark(`取得并学习${technique.name}`);
  act({ type: 'activity', kind: 'practice', targetId: technique.id });
  while (dec(state.techniqueXp[technique.id]).lt(600)) step(30);
  act({ type: 'activity', kind: 'idle' });
  if (options.stopAt !== 'early-setup') {
    grow('early');
    if (growthCraftsPerTier) {
      meditateTo(6);
      grow('middle');
    }
    meditateTo(latePreparationLevel);
    if (options.stopAt !== 'late-preparation') {
      forge(options.lateWeaponId ?? plan.weapons[2]);
      grow('late');
      meditateTo(12, true);
      const foundation = rules.content.recipes.find((entry) => entry.id === 'foundation')!;
      prepare(foundation.costs, foundation.stones);
      act({ type: 'craft', recipeId: foundation.id, quantity: 1 });
      while (count(foundation.outputId) < BigInt(rules.content.settings.breakthroughQuantity)) {
        prepare(foundation.costs, foundation.stones);
        act({ type: 'craft', recipeId: foundation.id, quantity: 1 });
      }
      if (options.stopAt !== 'foundation-ready') {
        act({ type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
        mark('首次筑基');
      } else mark('筑基准备就绪，暂不突破');
    } else mark('后期取材前，仍持中期器物');
  } else {
    mark('起步配装与功法就绪，留在低区取材');
  }
  return {
    path, seed, plainOnly, ruinsSupply, latePreparationLevel, state, seconds, ledger, milestones, upgrades, commands,
    growthCheckpoints,
    foundationSeconds: state.clockMs / 1000, content: rules.content,
  };
}
