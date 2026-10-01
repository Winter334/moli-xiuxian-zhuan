import { performance } from 'node:perf_hooks';
import { content } from '../core/index';
import { runLongSamples } from '../core/scenarios';
import { dec } from '../core/numbers';

const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.slice('--seed='.length)) : 1;
const started = performance.now();
console.error(`Running deterministic core samples; seed=${seed}, content=${content.version}`);
const result = runLongSamples(seed);
const elapsedMs = Math.round(performance.now() - started);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    contentVersion: content.version, rulesVersion: content.rulesVersion,
    schemaVersion: content.schemaVersion, elapsedMs, ...result,
  }, null, 2));
} else {
  console.log(`# 首段数值实算：${content.version} / ${content.rulesVersion}`);
  console.log(`\n种子 ${seed}；运行耗时 ${elapsedMs} ms。所有样本调用与服务相同的规则核心。`);
  console.log('\n## 境界表（当前层升至下一层的成本；十二层满后主动筑基）');
  console.log('| 境界 | 修为成本 | 打坐每秒 | 气血 | 灵力 | 攻击 | 防御 | 身法 |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const realm of content.realms) {
    console.log(`| ${realm.name} | ${realm.required} | ${realm.meditation} | ${realm.maxHp} | ${realm.maxMp} | ${realm.attack} | ${realm.defense} | ${realm.agility} |`);
  }
  console.log('\n## 丹方成本与常备商店回收');
  console.log('| 丹方 | 材料 | 灵石 | 成品 | 全购料成本 | 回收收入 |');
  console.log('| --- | --- | ---: | --- | ---: | ---: |');
  for (const recipe of content.recipes) {
    const output = content.items.find((item) => item.id === recipe.outputId)!;
    const materials = recipe.costs.map((cost) => ({
      ...cost, item: content.items.find((item) => item.id === cost.itemId)!,
    }));
    const allBuyable = materials.every((cost) => cost.item.buyPrice !== undefined);
    const buyCost = allBuyable ? materials.reduce(
      (total, cost) => total.plus(dec(cost.item.buyPrice!).mul(cost.quantity)), dec(recipe.stones),
    ).toFixed() : '含必须探索材料';
    console.log(`| ${recipe.name} | ${materials.map((cost) => `${cost.item.name} ×${cost.quantity}`).join('、')} | ${recipe.stones} | ${output.name} ×${recipe.outputQuantity} | ${buyCost} | ${dec(output.sellPrice ?? '0').mul(recipe.outputQuantity).toFixed()} |`);
  }
  console.log('\n## 自给路径');
  for (const milestone of result.foundation) console.log(`- ${milestone.event}：${milestone.atSeconds} 秒`);
  console.log('\n## 长期样本');
  console.log('| 样本 | 日 | 境界 | 修为 | 储备 | 击败 | 灵石 | 药耗 | 活动秒 | 装备数 | 状态 |');
  console.log('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const row of result.samples) {
    console.log(`| ${row.sample} | ${row.days} | ${row.realm} | ${row.cultivation} | ${row.reserve} | ${row.kills} | ${row.stones} | ${row.pillsUsed} | ${row.activeSeconds} | ${row.equipmentCount} | ${row.stopReason ?? row.activity} |`);
  }
  console.log('\n样本不是离线上限或最终平衡证明；筑基后继续刷取是运行器显式选择，不是核心自动续刷。');
}
