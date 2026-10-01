import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { economyProfile } from '../core/economy-candidate';
import { createRules } from '../core/game';
import { catchUpWith } from '../core/dwelling-scenarios';
import { equipmentFoundation, equipmentPaths, type EquipmentPath } from '../core/equipment-scenarios';
import { pillInvestment } from '../core/investment-scenarios';
import { dec } from '../core/numbers';
import type { GameState } from '../core/types';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const seed = Number(arg('seed') ?? 1);
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('非法种子');
const mode = arg('mode') ?? 'overnight';
if (!['overnight', 'tiers', 'pressure'].includes(mode)) throw new Error('模式须为 overnight、tiers 或 pressure');
const paths = arg('path') ? [arg('path') as EquipmentPath] : Object.keys(equipmentPaths) as EquipmentPath[];
if (paths.some((path) => !equipmentPaths[path])) throw new Error('未知武器路线');
const content = economyProfile();
const rules = createRules(content);
const preparations: {
  path: EquipmentPath; stage: string; stateHash: string; atSeconds: number; level: number;
  commandCount: number; commandHash: string; ledger: unknown;
  upgrades: unknown;
}[] = [];
const failures: { path: EquipmentPath; stage: string; reason: string }[] = [];
const overnight = [];
const investments = [];

function prepare(path: EquipmentPath, stage: 'early' | 'foundation') {
  console.error(`B6 preparing ${path}/${stage}/${seed}`);
  try {
    const result = equipmentFoundation(path, seed, true, {
      profile: content, consumeGrowth: true, tripKills: 1, compareUpgrades: false,
      latePreparationLevel: 12, stopAt: stage === 'early' ? 'early-setup' : 'foundation-ready',
    });
    preparations.push({
      path, stage, stateHash: hash(result.state), atSeconds: result.state.clockMs / 1000,
      level: result.state.level, commandCount: result.commands.length, commandHash: hash(result.commands),
      ledger: result.ledger,
      upgrades: result.upgrades,
    });
    return result;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('战败')) throw error;
    failures.push({ path, stage, reason: error.message });
    return null;
  }
}
function rest(original: GameState) {
  let state = rules.applyCommand(original, { type: 'activity', kind: 'idle' });
  const stats = rules.getPlayerStats(state);
  while (dec(state.player.hp).lt(stats.maxHp) || dec(state.player.mp).lt(stats.maxMp)) {
    state = rules.advanceGame(state, state.clockMs + 1000);
  }
  return state;
}
function sleep(path: EquipmentPath, stage: string, original: GameState, regionId: string, stockTarget?: number) {
  let state = rest(original);
  let purchasedHealing = 0;
  if (stockTarget) {
    const healing = content.items.find((item) => item.id === content.settings.supplyItemId)!;
    const deficit = BigInt(stockTarget) - BigInt(state.inventory[healing.id] ?? '0');
    const missing = deficit > 0n ? deficit : 0n;
    const affordable = BigInt(state.stones) / BigInt(healing.buyPrice!);
    purchasedHealing = Number(missing < affordable ? missing : affordable);
    if (purchasedHealing > 0) state = rules.applyCommand(state, {
      type: 'buy', itemId: healing.id, quantity: purchasedHealing,
    });
  }
  state = rules.applyCommand(state, { type: 'supply', enabled: true, hpThreshold: 0.5 });
  state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: regionId });
  const start = state;
  const snapshots = [];
  for (const hours of [1, 6]) {
    state = catchUpWith(rules, state, start.clockMs + hours * 3600000);
    const delta = (id: string) => (BigInt(state.inventory[id] ?? '0') - BigInt(start.inventory[id] ?? '0')).toString();
    const materials = Object.fromEntries(content.items.filter((item) => item.kind === 'material').map((item) => [item.id, delta(item.id)]));
    const pills = Object.fromEntries(content.items.filter((item) => item.kind === 'growth').map((item) => [item.id, delta(item.id)]));
    const failed = state.activity.kind !== 'dungeon';
    snapshots.push({
      hours, level: state.level,
      activeSeconds: (BigInt(state.totals.activeSeconds) - BigInt(start.totals.activeSeconds)).toString(),
      kills: (BigInt(state.totals.kills) - BigInt(start.totals.kills)).toString(),
      stonesEarned: (BigInt(state.stones) - BigInt(start.stones)).toString(),
      materials, materialTotal: Object.values(materials).reduce((sum, n) => sum + BigInt(n), 0n).toString(),
      pills, pillTotal: Object.values(pills).reduce((sum, n) => sum + BigInt(n), 0n).toString(),
      healingUsed: (BigInt(state.totals.pillsUsed) - BigInt(start.totals.pillsUsed)).toString(),
      healingRemaining: state.inventory[content.settings.supplyItemId] ?? '0',
      ...(failed ? {
        stop: state.activity.stopReason, stoppedAfterSeconds: (state.activity.stoppedAt! - start.clockMs) / 1000,
        pendingEnemy: state.pendingEncounters![regionId],
      } : {}),
    });
  }
  return {
    path, stage, regionId, seed, startLevel: start.level, startStats: rules.getPlayerStats(start),
    startingHealing: start.inventory[content.settings.supplyItemId] ?? '0',
    purchasedHealing, startingStones: start.stones,
    startStateHash: hash(start), endStateHash: hash(state), snapshots,
  };
}
for (const path of paths) {
  if (mode === 'pressure') {
    const early = prepare(path, 'early');
    if (early) {
      const region = arg('region') ?? 'ruins';
      overnight.push(sleep(path, 'early', early.state, region));
      overnight.push(sleep(path, 'early-stocked', early.state, region, 100));
    }
    continue;
  }
  if (mode === 'overnight') {
    const early = prepare(path, 'early');
    if (early) for (const region of ['bamboo', 'quarry', 'ruins']) overnight.push(sleep(path, 'early', early.state, region));
  }
  const late = prepare(path, 'foundation');
  if (!late) continue;
  if (mode === 'overnight') {
    for (const region of ['bamboo', 'quarry', 'ruins']) overnight.push(sleep(path, 'foundation', late.state, region));
  } else {
    for (const tier of ['early', 'middle', 'late'] as const) {
      console.error(`B6 investing ${path}/${tier}/${seed}`);
      const result = pillInvestment(path, seed, 'foundation', 'fixed', [3600, 21600], tier, {
        profile: content, prepared: late,
      });
      const { state, initial, finalBeforeBreakthrough, content: _, commands, ...details } = result;
      const last = result.snapshots.at(-1)!;
      for (const item of content.items) {
        const ledger = last.ledger;
        let expected = BigInt(initial.inventory[item.id] ?? '0') + BigInt(ledger.dropped[item.id] ?? '0') +
          BigInt(ledger.crafted[item.id] ?? '0') + BigInt(ledger.purchased[item.id] ?? '0') -
          BigInt(ledger.materials[item.id] ?? '0') - BigInt(ledger.sold[item.id] ?? '0') -
          BigInt(ledger.consumed[item.id] ?? '0');
        if (item.id === content.settings.supplyItemId) expected -= BigInt(last.healingPillsUsed);
        if (expected !== BigInt(finalBeforeBreakthrough.inventory[item.id] ?? '0')) throw new Error(`物品收支不一致：${item.id}`);
      }
      const cash = BigInt(initial.stones) + Object.values(last.ledger.stones).reduce((sum, n) => sum + BigInt(n), 0n);
      if (cash.toString() !== finalBeforeBreakthrough.stones) throw new Error('灵石收支不一致');
      investments.push({
        ...details, initialStateHash: hash(initial), finalStateHash: hash(state),
        commandCount: commands.length, commandHash: hash(commands),
        initialGrowth: { attack: initial.player.pillAttack, defense: initial.player.pillDefense, maxHp: initial.player.pillMaxHp },
        initialNextGains: rules.getGameView(initial).inventory.filter((item) => item.growth).map((item) => ({ id: item.id, ...item.growth })),
        ledgerVerified: true,
      });
    }
  }
}
const report = {
  scope: 'B6 1/6-hour ordinary windows; real preparation; unattended runs never craft, buy, rest voluntarily or resume; active investment reported separately; not full balance acceptance',
  mode, seed, contentVersion: content.version, contentHash: hash(content),
  preparationPolicy: 'ordinary quality; actual paid crafting/manuals; one-kill manual preparation trips; meditate to 12 before late materials; consume actual dropped growth pills',
  preparations, failures, overnight, investments,
};
const outputArg = arg('output');
if (outputArg) {
  const output = resolve(outputArg);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
}
for (const r of overnight) for (const s of r.snapshots) console.log(JSON.stringify({
  path: r.path, stage: r.stage, startLevel: r.startLevel, region: r.regionId,
  hours: s.hours, active: s.activeSeconds, materials: s.materialTotal, pills: s.pillTotal,
  healingUsed: s.healingUsed, healingRemaining: s.healingRemaining, stop: s.stoppedAfterSeconds,
  lastEnemy: s.pendingEnemy,
}));
for (const r of investments) for (const s of r.snapshots) console.log(JSON.stringify({
  path: r.path, tier: r.tierId, seconds: s.elapsedSeconds,
  crafted: Object.values(s.ledger.crafted).reduce((sum, n) => sum + BigInt(n), 0n).toString(),
  growth: Object.fromEntries(Object.entries(s.growth).map(([key, n]) => [key, Number(n).toFixed(3)])),
  craftStones: s.ledger.stones.craft, materialCost: s.materialResaleCost,
  stop: r.failure,
}));
console.log(JSON.stringify({ preparations: preparations.map(({ path, stage, atSeconds, level }) => ({ path, stage, atSeconds, level })), failures }));
