import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRules } from '../core/game';
import { equipmentCandidate } from '../core/equipment-candidate';
import { equipmentPaths, type EquipmentPath } from '../core/equipment-scenarios';
import { growthCandidate } from '../core/growth-candidate';
import { growthFoundation, growthPolicies, type GrowthPolicy } from '../core/growth-scenarios';
import { monsterCandidate } from '../core/monster-candidate';
import { monsterFoundation } from '../core/monster-scenarios';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const monsters = process.argv.includes('--monsters');
const candidate = monsters ? monsterCandidate : growthCandidate;
const simulate = monsters ? monsterFoundation : growthFoundation;
const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seeds = seedArg ? [Number(seedArg.slice(7))] : [1, 42, 20260926];
if (seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) throw new Error('非法随机种子');
const results = [];
const failures = [];
const plans = [
  ...Object.keys(growthPolicies).flatMap((policy) => seeds.flatMap((seed) =>
    (Object.keys(equipmentPaths) as EquipmentPath[]).map((path) => ({ path, policy: policy as GrowthPolicy, seed, zeroDrops: false })))),
  ...(Object.keys(equipmentPaths) as EquipmentPath[]).map((path) => ({ path, policy: 'modest' as const, seed: seeds[0], zeroDrops: true })),
];
for (const plan of plans) {
  console.error(`${monsters ? 'B4' : 'B3'} ${plan.path}/${plan.policy}/${plan.seed}/zeroDrops=${plan.zeroDrops}`);
  let outcome: ReturnType<typeof growthFoundation>;
  try {
    outcome = simulate(plan.path, plan.policy, plan.seed, plan.zeroDrops);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('{"path"') || !error.message.includes('战败')) throw error;
    failures.push({ ...plan, failure: JSON.parse(error.message) });
    continue;
  }
  const { state, content, ...result } = outcome;
  const rules = createRules(content);
  let replay = rules.createGame(0, plan.seed);
  for (const { atSeconds, command } of result.commands) {
    while (replay.clockMs < atSeconds * 1000) replay = rules.advanceGame(replay, atSeconds * 1000, 17);
    replay = rules.applyCommand(replay, command);
  }
  if (hash(replay) !== hash(state)) throw new Error(`命令重放不一致：${JSON.stringify(plan)}`);
  for (const item of content.items.filter((item) => item.kind === 'growth')) {
    const expected = BigInt(content.settings.starterItems[item.id] ?? '0') +
      BigInt(result.ledger.growthDropped[item.id] ?? '0') + BigInt(result.ledger.growthCrafted[item.id] ?? '0') -
      BigInt(result.ledger.growthConsumed[item.id] ?? '0');
    if (expected !== BigInt(state.inventory[item.id] ?? '0')) throw new Error(`属性丹收支不平：${item.id}`);
  }
  const growthUsed = Object.values(result.ledger.growthConsumed).reduce((sum, n) => sum + BigInt(n), 0n);
  results.push({
    ...plan, ...result, contentVersion: content.version, contentHash: hash(content), stateHash: hash(state), replayVerified: true,
    final: {
      level: state.level, stones: state.stones, inventory: state.inventory, regionKills: state.regionKills,
      growth: { attack: state.player.pillAttack, defense: state.player.pillDefense, maxHp: state.player.pillMaxHp },
      healingPillsUsed: (BigInt(state.totals.pillsUsed) - growthUsed).toString(), stats: rules.getPlayerStats(state),
      ...(monsters ? {
        eliteKills: content.enemies.filter((enemy) => enemy.eliteOf).reduce((sum, enemy) =>
          sum + BigInt(result.ledger.enemyKills[enemy.id] ?? '0'), 0n).toString(),
      } : {}),
    },
  });
}
const report = {
  scope: `${monsters ? 'B4 realm-based monsters, weighted persistent elites and sparse independent effects' : 'B3 tiered permanent growth'}; ordinary equipment; real drops/crafting/consumption; no dwelling investment or full supply integration; not full balance acceptance`,
  b2ContentHash: hash(equipmentCandidate), candidateContentHash: hash(candidate),
  rulesVersion: candidate.rulesVersion, schemaVersion: candidate.schemaVersion,
  ...(monsters ? {
    b3ContentHash: hash(growthCandidate),
    enemies: candidate.enemies.map((enemy) => ({
      id: enemy.id, name: enemy.name, allocation: enemy.allocation, eliteOf: enemy.eliteOf,
      stats: { hp: enemy.maxHp, mp: enemy.maxMp, attack: enemy.attack, defense: enemy.defense, agility: enemy.agility, hpRegen: enemy.hpRegen, mpRegen: enemy.mpRegen, intervalMs: enemy.attackIntervalMs },
      action: candidate.actions.find((action) => action.id === enemy.actionId), effects: enemy.effects, drops: enemy.drops,
    })),
    encounterWeights: candidate.regions.map((region) => ({ id: region.id, weights: region.enemyWeights })),
    weaponAffixes: candidate.equipment.map((entry) => ({ id: entry.id, count: entry.affixCount, pool: entry.affixPool, effects: entry.effects })),
  } : {}),
  results, failures,
};
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
if (outputArg) {
  const output = resolve(outputArg.slice(9));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
}
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log('| 武器 | 策略 | 种子 | 零掉药 | 筑基秒数 | 攻击丹贡献 | 防御丹贡献 | 气血丹贡献 | 回春丹耗 | 炼属性丹工料费 |');
  console.log('| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) console.log(`| ${r.path} | ${r.policy} | ${r.seed} | ${r.zeroDrops} | ${r.foundationSeconds} | ${Number(r.final.growth.attack).toFixed(3)} | ${Number(r.final.growth.defense).toFixed(3)} | ${Number(r.final.growth.maxHp).toFixed(3)} | ${r.final.healingPillsUsed} | ${r.ledger.growthCraftStones} |`);
  console.log(`完成 ${results.length}，保留战败 ${failures.length}；全部成功路线已逐命令分块重放。`);
  if (failures.length) console.log(JSON.stringify(failures, null, 2));
}
