import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { balanceCandidate } from '../core/balance-candidate';
import { craftingOpening, craftingRules } from '../core/crafting-scenarios';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seeds = seedArg ? [Number(seedArg.slice('--seed='.length))] : [1, 42, 20260926];
const results = seeds.flatMap((seed) => [false, true].map((retreat) => {
  const { state, ...result } = craftingOpening(seed, retreat);
  return {
    ...result,
    stateHash: hash(state),
    final: {
      level: state.level, cultivation: state.cultivation,
      stones: state.stones, inventory: state.inventory, totals: state.totals,
      equipmentCount: state.equipment.length, equipment: state.equipment,
      regionKills: state.regionKills, clear: craftingRules.getGameView(state).regions[0].clear,
    },
  };
}));
const report = {
  contentVersion: craftingRules.content.version,
  rulesVersion: craftingRules.content.rulesVersion,
  schemaVersion: craftingRules.content.schemaVersion,
  contentHash: hash(craftingRules.content),
  a1ContentHash: hash(balanceCandidate),
  scope: 'B1 opening mechanics only: paid crafting, no equipment drops, cumulative clears; not quality, foundation or dwelling rebalance acceptance',
  results,
};
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
if (outputArg) {
  const output = resolve(outputArg.slice('--output='.length));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.error(`Report written: ${output}`);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`# B1 打造与累计波次 ${report.contentVersion}`);
  console.log(`配置 SHA256: ${report.contentHash}`);
  console.log('工作参数；仅起步流程，不代表品质、首次筑基或洞府新经济通过。');
  console.log('| 种子 | 途中休整 | 首轮/s | 休整/s | 起步装备总成本 | 剩余灵石 | 用药 | 装备数 |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    console.log(`| ${r.seed} | ${r.retreat ? '是' : '否'} | ${r.firstClearSeconds} | ${r.restSeconds} | ${r.equipmentCost} | ${r.final.stones} | ${r.final.totals.pillsUsed} | ${r.final.equipmentCount} |`);
  }
}
