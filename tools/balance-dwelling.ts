import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { candidateLongSamples, candidateRules, dwellingFoundation, investmentPaths, pathNames } from '../core/dwelling-scenarios';

const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.slice('--seed='.length)) : 1;
const results = investmentPaths.map((path) => {
  console.error(`Simulating ${path}, seed=${seed}`);
  return dwellingFoundation(path, seed);
});
const long = process.argv.includes('--long')
  ? candidateLongSamples(results.find((result) => result.path === 'gathering')!) : undefined;
const report = {
  contentVersion: candidateRules.content.version, rulesVersion: candidateRules.content.rulesVersion,
  schemaVersion: candidateRules.content.schemaVersion,
  contentHash: createHash('sha256').update(JSON.stringify(candidateRules.content)).digest('hex'),
  seed,
  scope: 'A1 candidate: shared core, no database, legacy four techniques/weapons; not full balance acceptance',
  results: results.map(({ state, beforeBreakthrough: _beforeBreakthrough, ...result }) => ({
    ...result, secondsVsNoInvestment: result.foundationSeconds - results[0].foundationSeconds,
    final: {
      dwelling: state.dwelling, level: state.level, cultivation: state.cultivation,
      stones: state.stones, inventory: state.inventory, totals: state.totals, equipmentCount: state.equipment.length,
    },
    stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
  })),
  ...(long ? { long } : {}),
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
  console.log(`# A1 洞府候选 ${report.contentVersion} / seed=${seed}`);
  console.log(`配置 SHA256: ${report.contentHash}`);
  console.log('工作默认；未接入存档；旧四功法/武器仍为对照，未实现系统不计作通过。');
  console.log('| 路径 | 十二层满/s | 筑基/s | 较无改造/s | 打坐/s | 专修/s | 取材战斗/s | 休整/s | 洞府灵石 | 消耗药数 |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of report.results) {
    console.log(`| ${pathNames[r.path]} | ${r.fullAtSeconds} | ${r.foundationSeconds} | ${r.secondsVsNoInvestment} | ${r.seconds.meditate} | ${r.seconds.practice} | ${r.seconds.dungeon} | ${r.seconds.idle} | ${r.ledger.dwellingStones} | ${r.final.totals.pillsUsed} |`);
  }
  if (long) console.log('\n长期明细：\n' + JSON.stringify(long, null, 2));
  console.log('\n--json 输出逐次改造、材料支出、买卖与里程碑；--long 追加 1/7/30 日真实推进。');
}
