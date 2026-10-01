import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { balanceCandidate } from '../core/balance-candidate';
import { craftingCandidate } from '../core/crafting-candidate';
import { equipmentCandidate } from '../core/equipment-candidate';
import { equipmentFoundation, equipmentPaths, type EquipmentPath } from '../core/equipment-scenarios';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seeds = seedArg ? [Number(seedArg.slice('--seed='.length))] : [1, 42, 20260926];
const results = [];
for (const plainOnly of [true, false]) {
  for (const seed of seeds) {
    for (const path of Object.keys(equipmentPaths) as EquipmentPath[]) {
      console.error(`Simulating B2 ${path}, seed=${seed}, plainOnly=${plainOnly}`);
      const { state, content, ...result } = equipmentFoundation(path, seed, plainOnly);
      results.push({
        ...result, contentVersion: content.version, contentHash: hash(content), stateHash: hash(state),
        final: {
          level: state.level, cultivation: state.cultivation, stones: state.stones,
          inventory: state.inventory, totals: state.totals, regionKills: state.regionKills,
          equipment: state.equipment, learnedTechniques: state.learnedTechniques,
          inventoryResaleValue: content.items.reduce((sum, item) =>
            sum + BigInt(state.inventory[item.id] ?? '0') * BigInt(item.sellPrice ?? '0'), 0n).toString(),
        },
      });
    }
  }
}
const failures = [
  { path: 'sword' as const, seed: 1, ruinsSupply: 8 },
  { path: 'staff' as const, seed: 20260926, ruinsSupply: 20 },
].map(({ path, seed, ruinsSupply }) => {
  try {
    equipmentFoundation(path, seed, true, { ruinsSupply, latePreparationLevel: 8 });
    throw new Error('Expected earlier preparation sample to fail');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('战败')) throw error;
    return { ruinsSupply, ...JSON.parse(error.message) };
  }
});
const report = {
  rulesVersion: equipmentCandidate.rulesVersion, schemaVersion: equipmentCandidate.schemaVersion,
  scope: 'B2 equipment/technique self-sufficiency only; no dwelling investment, no market, no high-quality requirement; not full balance acceptance',
  a1ContentHash: hash(balanceCandidate), b1ContentHash: hash(craftingCandidate),
  earlierPreparationFailures: failures, results,
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
  console.log('# B2 品质、换代与功法取得');
  console.log('工作默认；普通对照禁用高品质和随机词条；药圃补给目标 20 颗，全部实际支付。');
  console.log('| 种子 | 品质模式 | 武器路线 | 首次筑基/s | 三件品质 | 用药 | 功法灵石 | 最终灵石 |');
  console.log('| --- | --- | --- | ---: | --- | ---: | ---: | ---: |');
  for (const r of results) {
    console.log(`| ${r.seed} | ${r.plainOnly ? '普通无词条' : '候选分布'} | ${r.path} | ${r.foundationSeconds} | ${r.upgrades.map((entry) => entry.quality).join(', ')} | ${r.final.totals.pillsUsed} | ${r.ledger.manualStones} | ${r.final.stones} |`);
  }
  console.log('未投入洞府；三档旧洞府仅为测试底座。1/7/30 日联合经济随完整配置重测。');
}
