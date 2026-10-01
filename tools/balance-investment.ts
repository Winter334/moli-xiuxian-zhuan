import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRules } from '../core/game';
import { investmentCandidate } from '../core/investment-candidate';
import { monsterCandidate } from '../core/monster-candidate';
import { equipmentPaths, type EquipmentPath } from '../core/equipment-scenarios';
import { pillInvestment, type InvestmentStart, type WeaponMode, type PillTier } from '../core/investment-scenarios';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seeds = seedArg ? [Number(seedArg.slice(7))] : [1, 42, 20260926];
if (seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) throw new Error('非法随机种子');
const tierComparison = process.argv.includes('--tier-comparison');
const plans: {
  seed: number; path: EquipmentPath; start: InvestmentStart; weaponMode: WeaponMode;
  checkpoints: number[]; tierId?: PillTier;
}[] = tierComparison ? (['early', 'middle', 'late'] as const).map((tierId) => ({
  seed: seeds[0], path: 'sword', start: 'foundation', weaponMode: 'fixed', checkpoints: [3600, 21600], tierId,
})) : seeds.flatMap((seed) => (Object.keys(equipmentPaths) as EquipmentPath[]).flatMap((path) => [
  { seed, path, start: 'early' as InvestmentStart, weaponMode: 'fixed' as WeaponMode, checkpoints: [3600, 21600] },
  ...(['fixed', 'panel'] as const).map((weaponMode) => ({
    seed, path, start: 'foundation' as InvestmentStart, weaponMode,
    checkpoints: seed === seeds[0] ? [3600, 21600, 86400] : [3600, 21600],
  })),
]));
const results = [];
for (const plan of plans) {
  console.error(`B5 ${plan.path}/${plan.start}/${plan.weaponMode}/${plan.seed}/${plan.tierId ?? 'default-tier'}`);
  const { state, content, initial, finalBeforeBreakthrough, ...result } = pillInvestment(
    plan.path, plan.seed, plan.start, plan.weaponMode, plan.checkpoints, plan.tierId,
  );
  const rules = createRules(content);
  let replay = rules.createGame(0, plan.seed);
  for (const { atSeconds, command } of result.commands) {
    while (replay.clockMs < atSeconds * 1000) replay = rules.advanceGame(replay, atSeconds * 1000, 17);
    replay = rules.applyCommand(replay, command);
  }
  while (replay.clockMs < state.clockMs) replay = rules.advanceGame(replay, state.clockMs, 17);
  if (hash(replay) !== hash(state)) throw new Error(`命令重放不一致：${JSON.stringify(plan)}`);
  const last = result.snapshots.at(-1)!;
  const ledger = last.ledger;
  for (const item of content.items) {
    let expected = BigInt(initial.inventory[item.id] ?? '0') + BigInt(ledger.dropped[item.id] ?? '0') +
      BigInt(ledger.crafted[item.id] ?? '0') + BigInt(ledger.purchased[item.id] ?? '0') -
      BigInt(ledger.sold[item.id] ?? '0') - BigInt(ledger.materials[item.id] ?? '0') -
      BigInt(ledger.consumed[item.id] ?? '0');
    if (item.id === content.settings.supplyItemId) expected -= BigInt(last.healingPillsUsed);
    if (expected !== BigInt(finalBeforeBreakthrough.inventory[item.id] ?? '0')) throw new Error(`库存收支不一致：${item.id}`);
  }
  const stones = BigInt(initial.stones) + Object.values(ledger.stones).reduce((sum, value) => sum + BigInt(value), 0n);
  if (stones !== BigInt(last.stones)) throw new Error('灵石收支不一致');
  if (last.seconds.dungeon + last.seconds.idle !== last.elapsedSeconds) throw new Error('活动时间收支不一致');
  results.push({
    ...result, contentVersion: content.version, contentHash: hash(content), stateHash: hash(state),
    replayVerified: true, inventoryVerified: true,
    initial: {
      level: initial.level, stones: initial.stones, inventory: initial.inventory,
      growth: { attack: initial.player.pillAttack, defense: initial.player.pillDefense, maxHp: initial.player.pillMaxHp },
      stats: rules.getPlayerStats(initial),
    },
    final: { level: state.level, reserve: state.reserve, cultivation: state.cultivation },
  });
}
if (tierComparison && new Set(results.map((result) => hash(result.initial))).size !== 1) {
  throw new Error('丹药换档对照必须来自完全相同的真实起点');
}
const report = {
  scope: `B5 ${tierComparison ? 'matched-start pill tiers' : 'resource-limited greedy growth; active low-zone farming and delayed foundation; fixed traits versus higher panel'}; no dwelling/full supply integration; not a balance sign-off`,
  decisions: {
    knownFalloffFormula: false, potionReserveStones: '20 healing pills', visitSeconds: 60,
    growthSelection: 'round-robin attack/defense/maxHp; all obtainable pills consumed, no potency stop rule',
    purchases: 'buy missing NPC materials when affordable; preserve selected growth ingredients, sell other materials',
    stopOnDefeat: true, earlyLevelLock: false, randomAffixes: false,
  },
  b4ContentHash: hash(monsterCandidate), candidateContentHash: hash(investmentCandidate),
  results,
};
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
if (outputArg) {
  const output = resolve(outputArg.slice(9));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
}
console.log('| 武器 | 起点 | 类型 | 丹档 | 种子 | 停留秒 | 境界 | 攻/防/血丹贡献 | 炼制颗数 | 药耗 | 停止 |');
console.log('| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | --- |');
for (const result of results) for (const s of result.snapshots) {
  const crafted = Object.values(s.ledger.crafted).reduce((sum, n) => sum + BigInt(n), 0n);
  console.log(`| ${result.path} | ${result.start} | ${result.weaponMode} | ${result.tierId} | ${result.seed} | ${s.elapsedSeconds} | ${s.level} | ${Object.values(s.growth).map((n) => Number(n).toFixed(2)).join('/')} | ${crafted} | ${s.healingPillsUsed} | ${result.failure?.reason ?? '-'} |`);
}
console.log(`${results.length} 条命令重放、库存与灵石账本已核验；停止 ${results.filter((result) => result.failure).length} 条。`);
