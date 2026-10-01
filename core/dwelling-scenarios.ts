import { createRules } from './game';
import { balanceCandidate } from './balance-candidate';
import { dec, floorTime } from './numbers';
import type { GameCommand, GameState } from './types';

export const candidateRules = createRules(balanceCandidate);
type Rules = ReturnType<typeof createRules>;
type Track = Extract<GameCommand, { type: 'upgrade-dwelling' }>['track'];
export const investmentPaths = ['none', 'light', 'balanced', 'gathering', 'study', 'tier'] as const;
export type InvestmentPath = typeof investmentPaths[number];
export const pathNames: Record<InvestmentPath, string> = {
  none: '不改造对照', light: '少量改造', balanced: '均衡投入',
  gathering: '优先聚灵', study: '优先专修', tier: '优先品阶',
};

export function catchUpWith(rules: Rules, original: GameState, targetMs: number, budget = 100_000) {
  let state = original;
  const target = floorTime(targetMs);
  while (state.clockMs < target) {
    const next = rules.advanceGame(state, target, budget);
    if (next.clockMs <= state.clockMs) throw new Error('模拟时钟未前进');
    state = next;
  }
  return state;
}

// These are explicit player decisions in a test harness, never offline automation.
export function dwellingFoundation(path: InvestmentPath, seed = 1, rules = candidateRules) {
  let state = rules.createGame(0, seed);
  const seconds = { meditate: 0, practice: 0, dungeon: 0, idle: 0 };
  const cultivation = { meditation: '0', combat: '0' };
  const ledger = { bought: {} as Record<string, string>, sold: {} as Record<string, string>, dwellingStones: '0', dwellingMaterials: {} as Record<string, string> };
  const milestones: { atSeconds: number; event: string; level: number }[] = [];
  const investments: { atSeconds: number; track: Track; preparationSeconds: number; stones: string; materialResaleValue: string; rates: ReturnType<Rules['getActivityRates']> }[] = [];
  const count = (id: string) => BigInt(state.inventory[id] ?? '0');
  const addCount = (table: Record<string, string>, id: string, n: bigint) => {
    table[id] = (BigInt(table[id] ?? '0') + n).toString();
  };
  const act = (command: GameCommand) => {
    state = rules.applyCommand(state, command);
    if (command.type === 'buy' || command.type === 'sell') {
      addCount(ledger[command.type === 'buy' ? 'bought' : 'sold'], command.itemId, BigInt(command.quantity));
    }
  };
  const step = (n = 1) => {
    const kind = state.activity.kind;
    const before = state.totals.cultivationGained;
    state = catchUpWith(rules, state, state.clockMs + n * 1000);
    seconds[kind] += n;
    if (kind === 'meditate' || kind === 'dungeon') {
      const source = kind === 'meditate' ? 'meditation' : 'combat';
      cultivation[source] = dec(cultivation[source]).plus(dec(state.totals.cultivationGained).minus(before)).toFixed();
    }
    if (state.clockMs > 7 * 86_400_000) throw new Error(`${path}: 自给策略超过七日，须检查依赖或成本`);
  };
  const mark = (event: string) => milestones.push({ atSeconds: state.clockMs / 1000, event, level: state.level });
  const rest = () => {
    act({ type: 'activity', kind: 'idle' });
    const stats = rules.getPlayerStats(state);
    while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) step();
  };
  const meditateTo = (level: number, full = false) => {
    act({ type: 'activity', kind: 'meditate' });
    while (state.level < level || (full && dec(state.cultivation).lt(rules.content.realms[level].required))) step();
    act({ type: 'activity', kind: 'idle' });
    mark(full ? '十二层修满' : `到达炼气${level}层`);
  };
  const farmTrip = (regionId: string, wins: number) => {
    rest();
    const techniqueId = regionId === 'foothill' || regionId === 'bamboo'
      ? (BigInt(state.regionKills.bamboo ?? '0') >= 5n ? 'verdant' : 'breathing')
      : 'flame';
    act({ type: 'technique', techniqueId });
    act({ type: 'supply', enabled: true, hpThreshold: 0.5 });
    const goal = BigInt(state.regionKills[regionId] ?? '0') + BigInt(wins);
    act({ type: 'activity', kind: 'dungeon', targetId: regionId });
    while (BigInt(state.regionKills[regionId] ?? '0') < goal) {
      step();
      if (state.activity.kind !== 'dungeon') {
        throw new Error(`${path}/${seed}/${regionId} 在 ${state.clockMs / 1000}s 停止：${state.activity.stopReason}`);
      }
    }
    act({ type: 'activity', kind: 'idle' });
    // Only the guaranteed first-clear sword is used; random later gear is not selected.
    const sword = state.equipment.find((entry) => entry.definitionId === 'iron-sword');
    if (sword && state.loadout.weapon !== sword.instanceId) act({ type: 'equip', slot: 'weapon', instanceId: sword.instanceId });
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
  const funds = (target: bigint, keep: Record<string, bigint>) => {
    sellSurplus(keep);
    while (BigInt(state.stones) < target) {
      farmTrip('bamboo', 20);
      sellSurplus(keep);
    }
  };
  const stock = (keep: Record<string, bigint>) => {
    const missing = 8n - count('healing-pill');
    if (missing <= 0n) return;
    funds(missing * BigInt(rules.content.items.find((item) => item.id === 'healing-pill')!.buyPrice!) + 30n, keep);
    act({ type: 'buy', itemId: 'healing-pill', quantity: Number(missing) });
  };
  const source: Record<string, string> = {
    herb: 'bamboo', hide: 'foothill', 'spirit-bamboo': 'bamboo', ore: 'quarry',
    copper: 'quarry', 'stone-marrow': 'quarry', 'warm-jade': 'pool',
    'dew-flower': 'pool', 'moon-fungus': 'ruins', essence: 'ruins',
  };
  const prepare = (costs: { itemId: string; quantity: string }[], stones: string) => {
    const keep = Object.fromEntries(costs.map((cost) => [cost.itemId, BigInt(cost.quantity)]));
    keep.herb = (keep.herb ?? 0n) > 30n ? keep.herb : 30n;
    for (const cost of costs) {
      if (count(cost.itemId) >= BigInt(cost.quantity)) continue;
      // Early copper and optional breakthrough flowers have a real NPC route.
      if ((cost.itemId === 'copper' && state.level < 6) || cost.itemId === 'dew-flower') {
        const missing = BigInt(cost.quantity) - count(cost.itemId);
        const item = rules.content.items.find((entry) => entry.id === cost.itemId)!;
        funds(BigInt(stones) + missing * BigInt(item.buyPrice!) + 80n, keep);
        act({ type: 'buy', itemId: item.id, quantity: Number(missing) });
      } else {
        const regionId = source[cost.itemId];
        if (!regionId) throw new Error(`样本缺少材料策略：${cost.itemId}`);
        while (count(cost.itemId) < BigInt(cost.quantity)) {
          stock(keep);
          farmTrip(regionId, ['quarry', 'pool', 'ruins'].includes(regionId) ? 3 : 10);
        }
      }
    }
    funds(BigInt(stones) + 80n, keep);
  };
  const upgrade = (track: Track) => {
    const home = state.dwelling!;
    const definition = rules.content.dwelling!;
    const next = track === 'tier' ? definition.tiers[home.tier + 1] : definition[track][home[track]];
    const started = state.clockMs;
    prepare(next.costs, next.stones);
    act({ type: 'upgrade-dwelling', track });
    ledger.dwellingStones = (BigInt(ledger.dwellingStones) + BigInt(next.stones)).toString();
    let resale = 0n;
    for (const cost of next.costs) {
      addCount(ledger.dwellingMaterials, cost.itemId, BigInt(cost.quantity));
      resale += BigInt(cost.quantity) * BigInt(rules.content.items.find((item) => item.id === cost.itemId)!.sellPrice ?? '0');
    }
    investments.push({
      atSeconds: state.clockMs / 1000, track, preparationSeconds: (state.clockMs - started) / 1000,
      stones: next.stones, materialResaleValue: resale.toString(), rates: rules.getActivityRates(state),
    });
    mark(`改造 ${track}`);
  };

  meditateTo(3);
  farmTrip('foothill', 5);
  farmTrip('bamboo', 5);
  farmTrip('bamboo', 15);
  if (path === 'study') upgrade('study');
  if (path !== 'none') upgrade('gathering');
  if (path === 'balanced') upgrade('study');
  meditateTo(6);
  if (!['none', 'light'].includes(path)) upgrade('tier');
  if (['balanced', 'gathering'].includes(path)) upgrade('gathering');
  if (['balanced', 'study'].includes(path)) upgrade('study');
  if (path === 'tier') upgrade('tier');
  act({ type: 'activity', kind: 'practice', targetId: 'flame' });
  while (dec(state.techniqueXp.flame).lt('1800')) step();
  act({ type: 'activity', kind: 'idle' });
  mark('灵焰诀修习达到1800（对照目标）');
  meditateTo(9);
  if (['balanced', 'gathering', 'study'].includes(path)) upgrade('tier');
  if (path === 'gathering') upgrade('gathering');
  if (path === 'study') upgrade('study');
  meditateTo(12, true);
  const fullAtSeconds = state.clockMs / 1000;
  const recipe = rules.content.recipes.find((entry) => entry.id === 'foundation')!;
  prepare(recipe.costs, recipe.stones);
  act({ type: 'craft', recipeId: recipe.id, quantity: 1 });
  const beforeBreakthrough = state;
  act({ type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
  mark('首次筑基');
  return {
    path, seed, state, beforeBreakthrough, seconds, cultivation, ledger, investments, milestones, fullAtSeconds,
    foundationSeconds: state.clockMs / 1000,
  };
}

export function candidateLongSamples(foundation: ReturnType<typeof dwellingFoundation>, rules = candidateRules) {
  let meditator = rules.applyCommand(rules.createGame(0, foundation.seed), { type: 'activity', kind: 'meditate' });
  let unattended = rules.applyCommand(rules.createGame(0, foundation.seed), { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
  let exhausted = rules.applyCommand(rules.createGame(0, foundation.seed), { type: 'supply', enabled: true, hpThreshold: 0.5 });
  exhausted = rules.applyCommand(exhausted, { type: 'activity', kind: 'dungeon', targetId: 'foothill' });
  let farmer = rules.applyCommand(foundation.state, { type: 'technique', techniqueId: 'breathing' });
  farmer = rules.applyCommand(farmer, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
  let delayed = rules.applyCommand(foundation.beforeBreakthrough, { type: 'activity', kind: 'meditate' });
  const rows: object[] = [];
  for (const days of [1, 7, 30]) {
    const target = days * 86_400_000;
    meditator = catchUpWith(rules, meditator, target);
    unattended = catchUpWith(rules, unattended, target);
    exhausted = catchUpWith(rules, exhausted, target);
    farmer = catchUpWith(rules, farmer, target);
    delayed = catchUpWith(rules, delayed, target);
    for (const [name, state] of [['无改造打坐', meditator], ['无补给山麓', unattended], ['有限补给山麓', exhausted], ['聚灵路径暂缓筑基', delayed], ['聚灵路径筑基后青竹林', farmer]] as const) {
      rows.push({
        name, days, level: state.level, cultivation: state.cultivation, reserve: state.reserve,
        stones: state.stones, inventory: state.inventory, equipmentCount: state.equipment.length,
        totals: state.totals, activity: state.activity,
        inventoryResaleValue: rules.content.items.reduce((sum, item) =>
          sum + BigInt(state.inventory[item.id] ?? '0') * BigInt(item.sellPrice ?? '0'), 0n).toString(),
      });
    }
  }
  return rows;
}
