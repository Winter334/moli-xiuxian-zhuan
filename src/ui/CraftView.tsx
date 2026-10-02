import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, ArrowRight, ArrowUp, Check, Coins, Flame, Hammer, LoaderCircle, Shield, Sparkles, Swords, X } from 'lucide-react';
import { ITEMS } from '../../core/prototype/content';
import { equipmentSource, itemValue, rarityMultiplier } from '../../core/prototype/equipment';
import { decimal, formatAmount, formatNumericText, hasEnough, multiply, percent } from '../format';
import { Bonuses, Dialog, Empty, IconButton, ItemGlyph, Quantity, SearchField } from './common';
import { type Instance, type ViewProps } from './types';
import { CRAFT_SORT_MODES as SORT_MODES, type CraftSort } from './sort-settings';

type Recipe = ViewProps['game']['recipes'][number];
type Material = Recipe['materialCosts'][number];
const CATEGORIES = [
  { id: 'all', name: '全部' }, { id: 'food', name: '补给' }, { id: 'foundation-pill', name: '筑基丹' },
  { id: 'marrow', name: '灵髓' }, { id: 'material', name: '炼材' }, { id: 'equipment', name: '器物' },
  { id: 'weapon', name: '兵刃' }, { id: 'armor', name: '升炼' },
] as const;
type Category = (typeof CATEGORIES)[number]['id'];
type CraftEntry = {
  id: string; output: string; name: string; category: Category; maxBatch: number; value: string;
} & ({ kind: 'recipe'; recipe: Recipe } | { kind: 'weapon' | 'armor'; first: string; second: string });
const nameOrder = new Intl.Collator('zh-CN', { numeric: true });
const instanced = (itemId: string) => ['equipment', 'part'].includes(ITEMS[itemId].kind);
const referenceValue = (itemId: string, quality = 100) => itemValue(itemId, instanced(itemId) ? quality : undefined);
const referenceQuality = (entry: CraftEntry) => entry.kind === 'recipe' ? entry.recipe.outputQuality ?? 100 : 100;
const variableQuality = (entry: CraftEntry) => entry.kind !== 'recipe' || entry.recipe.path === 'component';
const successChance = (entry: CraftEntry) => entry.kind === 'recipe' ? entry.recipe.successChance : '1';
const methodName = (entry: CraftEntry) => entry.kind === 'recipe' ? entry.recipe.path === 'component' ? '精炼' : '普通炼制'
  : entry.kind === 'weapon' ? '兵刃合炼' : '防具升炼';
const outputCount = (entry: CraftEntry) => entry.kind === 'recipe' ? entry.recipe.outputCount ?? 1 : 1;
const supplyLabel = (entry: CraftEntry) => `材料可供 ${formatAmount(String(entry.maxBatch))} ${entry.kind === 'recipe' ? '炉' : '组'}`;
const canCraftBatch = (entry: CraftEntry, quantity: number) => entry.kind === 'recipe' && entry.recipe.available &&
  Number.isInteger(quantity) && quantity >= 1 && quantity <= entry.maxBatch;

function CraftQuickActions({ entry, disabled, craft }: {
  entry: CraftEntry; disabled: boolean; craft: (quantity: number) => void;
}) {
  if (entry.kind !== 'recipe') return null;
  // The view caps maxBatch; "all" must match the actual material limit.
  const allAllowed = entry.recipe.materialCosts.some(material =>
    BigInt(material.owned) / BigInt(material.required) === BigInt(entry.maxBatch));
  return <div className="craft-quick-actions" role="group" aria-label={`快捷炼制${entry.name}`}>
    {[1, 10, entry.maxBatch].map((amount, index) => {
      const all = index === 2;
      const label = all ? `炼制全部${entry.name}` : `炼制${entry.name}${amount}炉`;
      const issue = all && !allAllowed ? '每次最多炼制10,000炉'
        : amount > entry.maxBatch ? `材料不足${amount}炉` : null;
      return <button key={index} aria-label={label} title={issue ?? `${label}（${amount}炉）`}
        disabled={disabled || !canCraftBatch(entry, amount) || Boolean(issue)}
        onClick={() => craft(amount)}>{all ? '全部' : amount}</button>;
    })}
  </div>;
}

function catalog(game: ViewProps['game']): CraftEntry[] {
  const counts = new Map<string, number>();
  for (const item of game.instances) if (!item.equipped) counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + 1);
  const available = (itemId: string) => counts.get(itemId) ?? 0;
  return [
    ...game.recipes.map((recipe): CraftEntry => ({
      id: `recipe:${recipe.id}`, kind: 'recipe', recipe, output: recipe.output, name: recipe.outputName,
      category: ['food', 'foundation-pill', 'marrow', 'equipment'].includes(ITEMS[recipe.output].kind)
        ? ITEMS[recipe.output].kind as Category : 'material',
      maxBatch: recipe.maxBatch, value: referenceValue(recipe.output, recipe.outputQuality),
    })),
    ...game.assemblies.map((recipe): CraftEntry => ({
      id: `weapon:${recipe.blade}:${recipe.hilt}`, kind: 'weapon', output: recipe.output, name: recipe.outputName,
      category: 'weapon', first: recipe.blade, second: recipe.hilt,
      maxBatch: Math.min(available(recipe.blade), available(recipe.hilt)), value: referenceValue(recipe.output),
    })),
    ...game.armorAssemblies.map((recipe): CraftEntry => ({
      id: `armor:${recipe.interior}:${recipe.exterior}`, kind: 'armor', output: recipe.output, name: recipe.outputName,
      category: 'armor', first: recipe.interior, second: recipe.exterior,
      maxBatch: Math.min(available(recipe.interior), available(recipe.exterior)), value: referenceValue(recipe.output),
    })),
  ];
}

function Materials({ materials, quantity = 1 }: { materials: Material[]; quantity?: number }) {
  const count = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  return <table className="craft-materials">
    <thead><tr><th scope="col">材料</th><th scope="col">持有</th><th scope="col">本批消耗</th></tr></thead>
    <tbody>{materials.map(material => {
      const required = multiply(String(material.required), count);
      return <tr key={material.itemId}><th scope="row">{material.name}</th><td>{formatAmount(material.owned)}</td>
        <td className={hasEnough(material.owned, required) ? 'positive' : 'negative'}>{formatAmount(required)}</td></tr>;
    })}</tbody>
  </table>;
}

function CraftOutput({ entry }: { entry: CraftEntry }) {
  const item = ITEMS[entry.output];
  return <div className="item-detail-title craft-output"><ItemGlyph kind={item.kind} slot={item.slot} itemId={entry.output} size={30} />
      <div><span className="eyebrow">{methodName(entry)}</span><h2>{entry.name}</h2>
        {instanced(entry.output) && <span className="muted small">{variableQuality(entry) ? '成品品质浮动' : `成品品质 ${referenceQuality(entry)}`}</span>}
      </div>
    </div>;
}

function CraftEquipmentStats({ entry }: { entry: CraftEntry }) {
  const item = ITEMS[entry.output];
  if (item.kind !== 'equipment') return null;
  const floating = variableQuality(entry) && !item.fixedStats;
  return <section className="craft-equipment-stats" aria-label="成品属性">
    <div className="craft-equipment-heading"><h3>成品属性</h3>
      <span className="muted small">{floating ? '品质100参考' : item.fixedStats ? '固定属性' : `品质${referenceQuality(entry)}`}</span>
    </div>
    <Bonuses source={equipmentSource('craft-preview', { itemId: entry.output, quality: referenceQuality(entry) })} />
    {item.effectDescription && <p className="effect-description">{item.effectDescription}</p>}
    {floating && <p className="muted small">实际属性随成品品质变化。</p>}
  </section>;
}

function CraftConsumableEffects({ entry }: { entry: CraftEntry }) {
  const use = entry.kind === 'recipe' ? entry.recipe.outputUse : null;
  if (!use) return null;
  return <section className="craft-consumable-effects" aria-label="成品使用效果">
    <div className="craft-equipment-heading"><h3>使用效果</h3><span className="muted small">每份</span></div>
    <p className="effect-description">{formatNumericText(use.description)}</p>
    {use.issue && <p className="cost-warning small">当前不可使用：{use.issue}</p>}
  </section>;
}

function InstanceChoices({ label, itemId, instances, selectedId, onSelect, disabled }: {
  label: string; itemId: string; instances: Instance[]; selectedId: string;
  onSelect: (id: string) => void; disabled: boolean;
}) {
  const items = instances.filter(item => item.itemId === itemId && !item.equipped)
    .sort((a, b) => b.quality - a.quality || nameOrder.compare(a.instanceId, b.instanceId));
  const equippedCount = instances.filter(item => item.itemId === itemId && item.equipped).length;
  return <section className="craft-ingredient" aria-label={label}>
    <div className="craft-ingredient-heading"><h3>{ITEMS[itemId].name}</h3><span>{label} · 消耗1件</span></div>
    <div className="craft-instance-grid" role="group" aria-label={`选择${label}`}>
      {items.map(item => <button key={item.instanceId} className="craft-instance quality-marked"
        data-quality={rarityMultiplier(item.quality)} aria-pressed={item.instanceId === selectedId}
        aria-label={`${item.name}，品质${item.quality}，编号${item.instanceId}`} disabled={disabled}
        onClick={() => onSelect(item.instanceId)}>
        <span className="craft-instance-quality"><Sparkles size={13} />品质 {item.quality}
          {item.instanceId === selectedId && <Check size={14} />}</span>
        <small>#{item.instanceId.slice(5)}</small>
        <span className="craft-instance-price" title={`回收单价 ${item.sellPrice} 灵石`}><Coins size={12} />{formatAmount(item.sellPrice)}</span>
      </button>)}
    </div>
    {!items.length && <p className="muted small">行囊中暂无可用器料</p>}
    {equippedCount > 0 && <p className="cost-warning small">另有 {equippedCount} 件已穿戴，须先卸下。</p>}
  </section>;
}

function CraftDialog({ entry, game, blocked, pending, notice, run, onClose }: {
  entry: CraftEntry; game: ViewProps['game']; blocked: boolean; pending: boolean; notice: string;
  run: (command: Parameters<ViewProps['command']>[0]) => Promise<boolean>; onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const first = entry.kind !== 'recipe' ? game.instances.find(item => item.instanceId === firstId && item.itemId === entry.first && !item.equipped) : null;
  const second = entry.kind !== 'recipe' ? game.instances.find(item => item.instanceId === secondId && item.itemId === entry.second && !item.equipped) : null;
  const disabled = blocked || pending;
  const canSubmit = !disabled && game.workshop.available && (entry.kind === 'recipe'
    ? canCraftBatch(entry, quantity)
    : Boolean(first && second && firstId !== secondId));
  useEffect(() => {
    setQuantity(value => Number.isFinite(value) ? Math.max(1, Math.min(value, entry.maxBatch)) : value);
  }, [entry.maxBatch]);
  const submit = async (batchQuantity = quantity) => {
    if (entry.kind === 'recipe'
      ? disabled || !game.workshop.available || !canCraftBatch(entry, batchQuantity) : !canSubmit) return;
    if (entry.kind === 'recipe') setQuantity(batchQuantity);
    const request = entry.kind === 'recipe' ? { type: 'craft' as const, recipeId: entry.recipe.id, quantity: batchQuantity }
      : entry.kind === 'weapon' ? { type: 'assemble' as const, bladeId: firstId, hiltId: secondId }
        : { type: 'assemble-armor' as const, interiorId: firstId, exteriorId: secondId };
    if (await run(request) && entry.kind !== 'recipe') { setFirstId(''); setSecondId(''); }
  };
  const ActionIcon = pending ? LoaderCircle : entry.kind === 'weapon' ? Swords : entry.kind === 'armor' ? Shield : Flame;
  return <Dialog title={methodName(entry)} onClose={onClose} footer={<div className="craft-actions">
    {entry.kind === 'recipe' ? <div className="craft-quantity-actions">
      <Quantity value={quantity} onChange={setQuantity} max={entry.maxBatch} label="炼制炉数" disabled={disabled} />
      <CraftQuickActions entry={entry} disabled={disabled || !game.workshop.available} craft={amount => void submit(amount)} />
    </div>
      : <span className="muted small">已选 {Number(Boolean(first)) + Number(Boolean(second))} / 2 件</span>}
    <button className="primary" disabled={!canSubmit} onClick={() => void submit()}>
      <ActionIcon size={16} className={pending ? 'spinning' : undefined} />
      {pending ? '结算中' : entry.kind === 'weapon' ? '合炼兵刃' : entry.kind === 'armor' ? '升炼防具' : '开炉炼制'}
    </button>
  </div>}>
    <CraftOutput entry={entry} />
    <CraftEquipmentStats entry={entry} />
    <CraftConsumableEffects entry={entry} />
    <dl className="craft-facts">
      <div><dt>当前成功率</dt><dd>{entry.kind === 'recipe' && entry.recipe.path === 'ordinary' ? percent(Number(entry.recipe.successChance)) : '必成'}</dd></div>
      <div><dt>{entry.kind === 'recipe' ? '每炉成功产出' : '每次产出'}</dt><dd>{outputCount(entry)}<small> {instanced(entry.output) ? '件' : '份'}</small></dd></div>
      <div><dt>{entry.kind === 'recipe' && entry.recipe.path === 'ordinary' ? '炼制难度' : '品质'}</dt>
        <dd>{entry.kind === 'recipe' && entry.recipe.path === 'ordinary' ? entry.recipe.difficulty : '浮动'}</dd></div>
    </dl>
    {!game.workshop.available && <p className="cost-warning">请先退出战斗。</p>}
    {entry.kind === 'recipe' ? <>
      {Number(entry.recipe.extraBatchChance) > 0 && <p className="positive small">成功后有 {percent(Number(entry.recipe.extraBatchChance))} 概率额外产出一批</p>}
      <Materials materials={entry.recipe.materialCosts} quantity={quantity} />
      <p className="muted small">{supplyLabel(entry)}{entry.recipe.path === 'ordinary' ? ' · 失败仍消耗材料' : ''}</p>
    </> : <>
      <p className="muted small">所选两件材料均被消耗，成品品质重新判定。</p>
      <InstanceChoices label={entry.kind === 'weapon' ? '精炼主材' : '待升炼防具'} itemId={entry.first}
        instances={game.instances} selectedId={first?.instanceId ?? ''} onSelect={setFirstId} disabled={disabled} />
      <InstanceChoices label={entry.kind === 'weapon' ? '淬炼辅料' : '升炼材料'} itemId={entry.second}
        instances={game.instances} selectedId={second?.instanceId ?? ''} onSelect={setSecondId} disabled={disabled} />
    </>}
    {notice && <p className="craft-notice" role="status">{notice}</p>}
    <div className="craft-output-reference">
      {ITEMS[entry.output].description && <p className="flavor">{ITEMS[entry.output].description}</p>}
      <div className="item-valuation"><Coins size={14} /><span>{variableQuality(entry) ? '品质100回收单价' : '回收单价'}</span>
        <strong>{formatAmount(entry.value)} 灵石</strong></div>
    </div>
  </Dialog>;
}

export function CraftView({ game, blocked, command, sort, onSortChange }: ViewProps & {
  sort: CraftSort; onSortChange: (sort: CraftSort) => void;
}) {
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const entries = catalog(game);
  const filtered = category !== 'all' || Boolean(search.trim()) || showAll;
  const visible = entries.filter(entry => (category === 'all' || entry.category === category) &&
    (entry.name.includes(search.trim()) || entry.kind === 'recipe' && entry.recipe.name.includes(search.trim())) &&
    (showAll || entry.maxBatch > 0)).sort((a, b) => {
    const order = sort === 'ready' ? Number(b.maxBatch > 0) - Number(a.maxBatch > 0)
      : sort === 'chance' ? decimal(successChance(b)).cmp(successChance(a))
        : sort === 'value' ? decimal(b.value).cmp(a.value) : 0;
    return order || nameOrder.compare(a.name, b.name) || nameOrder.compare(a.id, b.id);
  });
  const selected = entries.find(entry => entry.id === selectedId);
  const sortIndex = SORT_MODES.findIndex(mode => mode.id === sort);
  const nextSort = SORT_MODES[(sortIndex + 1) % SORT_MODES.length];
  const upgrade = game.workshop.upgrade;
  const refining = game.skills.find(skill => skill.id === 'refining')!;
  const run = async (request: Parameters<ViewProps['command']>[0]) => {
    if (blocked || inFlight.current) return false;
    inFlight.current = true; setPending(true); setNotice('');
    try {
      const success = await command(request);
      setNotice(success ? request.type === 'upgrade-furnace' ? `炉鼎已升至 ${request.tier} 阶` : '本批炼制已结算' : '操作未完成');
      return success;
    } catch (error) { setNotice(error instanceof Error ? error.message : '操作未完成'); return false; }
    finally { inFlight.current = false; setPending(false); }
  };
  const craftBatch = async (entry: CraftEntry, quantity: number) => {
    if (entry.kind !== 'recipe' || !game.workshop.available || !canCraftBatch(entry, quantity)) return;
    await run({ type: 'craft', recipeId: entry.recipe.id, quantity });
  };
  return <div className="page craft-view">
    <div className="page-heading craft-heading"><h1>炉鼎</h1><span className="muted small">炼制 {refining.level} 级 · {visible.length !== entries.length ? `${visible.length} / ${entries.length}` : entries.length} 式</span></div>
    <div className="furnace-strip"><Flame size={22} /><strong>{game.workshop.name}<small>{game.workshop.tier}阶</small></strong>
      <span className={game.workshop.available ? 'positive' : 'cost-warning'}>{game.workshop.available ? '可开炉' : game.mode === 'sleep' ? '调息中' : '战斗中'}</span>
      <button onClick={() => { setShowUpgrade(true); setNotice(''); }}><ArrowUp size={15} />养鼎</button>
    </div>
    <div className="craft-tools">
      <div className="craft-search-row"><SearchField value={search} onChange={setSearch} placeholder="搜索配方或成品" />
        <button className="craft-sort" aria-label={`排序：${SORT_MODES[sortIndex].label}`} title={`切换为${nextSort.label}`}
          onClick={() => onSortChange(nextSort.id)}><ArrowDownWideNarrow size={15} /><span>{SORT_MODES[sortIndex].label}</span></button>
        <IconButton label="清除配方筛选" disabled={!filtered} onClick={() => { setCategory('all'); setSearch(''); setShowAll(false); }}><X size={15} /></IconButton>
      </div>
      <div className="craft-filter-row">
        <div className="craft-categories" role="group" aria-label="炼制类别">
          {CATEGORIES.map(entry => <button key={entry.id} aria-pressed={category === entry.id} onClick={() => setCategory(entry.id)}>{entry.name}</button>)}
        </div>
        <label className="check-label"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />显示全部</label>
      </div>
    </div>
    <div className="craft-grid">{visible.map(entry => {
      const item = ITEMS[entry.output];
      return <article key={entry.id} className={`craft-tile-wrap ${entry.maxBatch > 0 ? 'ready' : ''}`}>
        <button className={`craft-tile ${entry.maxBatch > 0 ? 'ready' : ''}`}
          aria-label={`查看${entry.name}，${methodName(entry)}，成功产出${outputCount(entry)}${instanced(entry.output) ? '件' : '份'}，${supplyLabel(entry)}`} onClick={() => { setSelectedId(entry.id); setNotice(''); }}>
          <span className="craft-tile-top"><ItemGlyph kind={item.kind} slot={item.slot} itemId={entry.output} size={24} />
            <span>{entry.kind === 'recipe' && entry.recipe.path === 'ordinary' ? `难度 ${entry.recipe.difficulty}` : methodName(entry)}</span></span>
          <strong>{entry.name}</strong>
          <span className="craft-tile-facts"><span title="当前成功率">{entry.kind === 'recipe' && entry.recipe.path === 'ordinary' ? percent(Number(entry.recipe.successChance)) : '必成'}</span>
            <small>{entry.kind === 'recipe' ? '每炉' : '每次'} {outputCount(entry)}{instanced(entry.output) ? '件' : '份'}</small></span>
          <span className="craft-tile-price" title={`${variableQuality(entry) ? '品质100参考' : ''}回收单价 ${entry.value} 灵石`}>
            <Coins size={12} />{formatAmount(entry.value)}<small>{variableQuality(entry) ? '参考价' : '单价'}</small></span>
          <span className="craft-tile-stock">{entry.maxBatch > 0 ? <><Check size={12} />可供 {formatAmount(String(entry.maxBatch))} {entry.kind === 'recipe' ? '炉' : '组'}</> : '缺少材料'}</span>
        </button>
        <CraftQuickActions entry={entry} disabled={blocked || pending || !game.workshop.available}
          craft={quantity => void craftBatch(entry, quantity)} />
      </article>;
    })}</div>
    {notice && !selected && !showUpgrade && <p className="craft-notice" role="status">{notice}</p>}
    {!visible.length && <Empty icon={<Hammer size={28} />}>没有符合条件的配方</Empty>}
    {selected && <CraftDialog key={selected.id} entry={selected} game={game} blocked={blocked} pending={pending}
      notice={notice} run={run} onClose={() => { setSelectedId(''); setNotice(''); }} />}
    {showUpgrade && <Dialog title="养鼎" onClose={() => { setShowUpgrade(false); setNotice(''); }}
      footer={upgrade && <div className="craft-actions"><span className="muted small">升鼎必成</span>
        <button className="primary" disabled={blocked || pending || !upgrade.available} onClick={() => void run({ type: 'upgrade-furnace', tier: upgrade.tier })}>
          {pending ? <LoaderCircle size={16} className="spinning" /> : <ArrowUp size={16} />}升鼎</button></div>}>
      <div className="furnace-upgrade">
        <div className="furnace-upgrade-route"><div><small>当前炉鼎 · {game.workshop.tier}阶</small><h3>{game.workshop.name}</h3></div>
          {upgrade && <><ArrowRight size={20} /><div><small>升至 {upgrade.tier}阶</small><h3>{upgrade.name}</h3></div></>}</div>
        {upgrade ? <><Materials materials={upgrade.materialCosts} />
          {!game.workshop.available && <p className="cost-warning">请先退出战斗。</p>}</>
          : <p className="positive"><Check size={16} /> 已达当前开放炉阶</p>}
        {notice && <p className="craft-notice" role="status">{notice}</p>}
      </div>
    </Dialog>}
  </div>;
}
