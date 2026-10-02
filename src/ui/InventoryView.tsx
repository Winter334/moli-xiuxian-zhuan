import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowDownWideNarrow, ArrowUpFromLine, Check, ChevronDown, ChevronRight, ChevronUp, Coins, FlaskConical, Package, RefreshCw, ShoppingCart, Sparkles, X } from 'lucide-react';
import { rarityMultiplier } from '../../core/prototype/equipment';
import { batchLimit, decimal, formatAmount, formatNumericText, hasEnough, multiply } from '../format';
import { Bonuses, Dialog, Empty, formatBonus, IconButton, ItemGlyph, Quantity, SearchField, STAT_NAMES, Tabs } from './common';
import { KIND_NAMES, SLOT_NAMES, type Instance, type Stack, type ViewProps } from './types';
import { BAG_SORT_MODES as SORT_MODES, type BagSort } from './sort-settings';

type Entry = Stack | Instance;
const isInstance = (item: Entry): item is Instance => 'instanceId' in item;
const entryKey = (item: Entry) => isInstance(item) ? item.instanceId : item.itemId;
const entryKind = (item: Entry) => isInstance(item) ? item.slot ? 'equipment' : 'part' : item.kind;
const qualityBand = (item: Entry) => isInstance(item) ? rarityMultiplier(item.quality) : undefined;
const CATEGORY_ORDER = ['equipment', 'food', 'foundation-pill', 'insight', 'marrow', 'part', 'material'];
const COMPACT_INVENTORY = '(max-height: 550px) and (orientation: landscape)';
const nameOrder = new Intl.Collator('zh-CN', { numeric: true });
function ItemDetails({ item, amountLabel = '持有', showBonuses = true }: { item: Entry; amountLabel?: string; showBonuses?: boolean }) {
  return <>
    <div className={`item-detail-title ${isInstance(item) ? 'quality-marked' : ''}`} data-quality={qualityBand(item)}>
      <ItemGlyph kind={isInstance(item) ? 'equipment' : item.kind} slot={isInstance(item) ? item.slot : undefined} itemId={item.itemId} size={30} />
      <div><span className="eyebrow">{isInstance(item) ? item.slot ? SLOT_NAMES[item.slot] : '精炼器料' : KIND_NAMES[item.kind]}</span>
        <h2>{item.name}</h2>
        {isInstance(item) ? <span className="quality">品质 {item.quality}<small> · #{item.instanceId.slice(5)}</small></span>
          : <span className="muted small">{amountLabel} {formatAmount(item.quantity)} 份</span>}</div>
    </div>
    {item.description && <p className="flavor">{item.description}</p>}
    {isInstance(item) ? <>{showBonuses && item.bonuses && <Bonuses source={item.bonuses} />}
      {item.effectDescription && <p className="effect-description">{item.effectDescription}</p>}</>
      : item.use && <p className="effect-description">{formatNumericText(item.use.description)}</p>}
  </>;
}
function EquipmentComparison({ item, equipped }: { item: Instance; equipped: Instance | null }) {
  const rows = (['flat', 'multiplier'] as const).flatMap(kind => {
    const current = equipped?.bonuses?.[kind] ?? {};
    const candidate = item.bonuses?.[kind] ?? {};
    const neutral = kind === 'flat' ? '0' : '1';
    return [...new Set([...Object.keys(candidate), ...Object.keys(current)])].flatMap(stat => {
      const before = current[stat as keyof typeof current] ?? neutral;
      const after = candidate[stat as keyof typeof candidate] ?? neutral;
      if (decimal(before).eq(neutral) && decimal(after).eq(neutral)) return [];
      return [{ id: `${kind}:${stat}`, name: `${STAT_NAMES[stat] ?? stat}${kind === 'multiplier' ? '（乘算）' : ''}`,
        before: formatBonus(stat, before, kind === 'multiplier'), after: formatBonus(stat, after, kind === 'multiplier'),
        difference: decimal(after).cmp(before) }];
    });
  });
  return <section className="bag-comparison" aria-label="同部位器物对照">
    <h3>同部位对照</h3>
    <table>
      <thead><tr><th scope="col">器物属性</th><th scope="col"><small>当前装备</small>{equipped?.name ?? '未装备'}</th>
        <th scope="col"><small>所选器物</small>{item.name}</th></tr></thead>
      <tbody>
        <tr><th scope="row">品质</th><td>{equipped?.quality ?? '--'}</td><td>{item.quality}</td></tr>
        {rows.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.before}</td>
          <td className={row.difference > 0 ? 'positive' : row.difference < 0 ? 'negative' : ''}>
            {row.difference !== 0 && <span aria-label={row.difference > 0 ? '提高' : '降低'}>{row.difference > 0 ? '↑ ' : '↓ '}</span>}{row.after}
          </td></tr>)}
      </tbody>
    </table>
    {equipped?.effectDescription && <p className="muted small">当前器物特性：{equipped.effectDescription}</p>}
  </section>;
}
function QuickSell({ item, disabled, sell }: { item: Stack; disabled: boolean; sell: (item: Stack, quantity: number) => void }) {
  const max = batchLimit(item.quantity, '1', 10000);
  const allAllowed = decimal(item.quantity).eq(max);
  return <div className="shop-quick-sell" role="group" aria-label={`售出${item.name}`}>
    {[1, 10, max].map((amount, index) => {
      const all = index === 2;
      const label = all ? `售出全部${item.name}` : `售出${amount}个${item.name}`;
      const issue = all && !allAllowed ? '每次最多售出10,000个'
        : amount > max ? `数量不足${amount}个` : null;
      return <button key={index} className={all ? 'quick-sell-all' : undefined} aria-label={label}
        title={issue ?? `${label}（${amount}个），获得${formatAmount(multiply(item.sellPrice, amount))}灵石`}
        disabled={disabled || max < 1 || Boolean(issue)} onClick={() => sell(item, amount)}>{all ? '全部' : amount}</button>;
    })}
  </div>;
}
function EntryList({ items, select, prices, sell, disabled = false }: {
  items: Entry[]; select: (key: string) => void; prices?: 'buy' | 'sell';
  sell?: (item: Stack, quantity: number) => void; disabled?: boolean;
}) {
  return <div className="entry-list">
    {items.map(item => <div key={entryKey(item)} className={sell && !isInstance(item) ? 'shop-sale-entry' : undefined}>
      <button className="entry" onClick={() => select(entryKey(item))}>
        <ItemGlyph kind={isInstance(item) ? item.slot ? 'equipment' : 'part' : item.kind} slot={isInstance(item) ? item.slot : undefined} itemId={item.itemId} />
        <span className="entry-name"><strong>{item.name}</strong><small>{isInstance(item) ? `${item.slot ? SLOT_NAMES[item.slot] : '精炼器料'} · 品质 ${item.quality}` : KIND_NAMES[item.kind]}</small></span>
        {prices && <span className="entry-price">{formatAmount(prices === 'buy' ? item.buyPrice : item.sellPrice)}<small>灵石</small></span>}
        <span className="entry-count">{isInstance(item) ? item.equipped ? <Check size={16} aria-label="已装备" /> : `#${item.instanceId.slice(5)}` : `×${formatAmount(item.quantity)}`}</span>
        <ChevronRight size={14} />
      </button>
      {sell && !isInstance(item) && <QuickSell item={item} disabled={disabled} sell={sell} />}
    </div>)}
    {!items.length && <Empty>暂无对应物品</Empty>}
  </div>;
}
export function InventoryView({ game, blocked, command, sort, onSortChange }: ViewProps & {
  sort: BagSort; onSortChange: (sort: BagSort) => void;
}) {
  const [category, setCategory] = useState('all');
  const [slotFilter, setSlotFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [equipmentOpen, setEquipmentOpen] = useState(() => !window.matchMedia(COMPACT_INVENTORY).matches);
  const contents = useRef<HTMLElement>(null);
  const items: Entry[] = [...game.inventory, ...game.instances];
  const stored = items.filter(item => !isInstance(item) || !item.equipped);
  const visible = stored.filter(item => item.name.includes(search.trim()) &&
    (category === 'all' || entryKind(item) === category) &&
    (slotFilter === 'all' || isInstance(item) && item.slot === slotFilter)).sort((a, b) => {
    const order = sort === 'value' ? decimal(b.sellPrice).cmp(a.sellPrice)
      : sort === 'quality' ? (isInstance(b) ? b.quality : 0) - (isInstance(a) ? a.quality : 0)
        : sort === 'category' ? CATEGORY_ORDER.indexOf(entryKind(a)) - CATEGORY_ORDER.indexOf(entryKind(b)) : 0;
    return order || nameOrder.compare(a.name, b.name) || nameOrder.compare(entryKey(a), entryKey(b));
  });
  const selected = items.find(item => entryKey(item) === selectedId);
  const max = selected && !isInstance(selected) ? batchLimit(selected.quantity, '1', selected.use?.maxBatch ?? 10000) : 1;
  const selectedSlot = selected && isInstance(selected) ? selected.slot : null;
  const equipped = selectedSlot ? game.instances.find(item => item.instanceId === game.equipment[selectedSlot]) ?? null : null;
  const comparing = selected && isInstance(selected) && selected.slot && !selected.equipped;
  const disabled = blocked || pending;
  const filtered = search.trim() !== '' || category !== 'all' || slotFilter !== 'all';
  const sortIndex = SORT_MODES.findIndex(mode => mode.id === sort);
  const nextSort = SORT_MODES[(sortIndex + 1) % SORT_MODES.length];
  useEffect(() => { if (selectedId && !selected) setSelectedId(''); }, [selectedId, selected]);
  useEffect(() => { setQuantity(value => Number.isFinite(value) ? Math.max(1, Math.min(value, max)) : value); }, [max]);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_INVENTORY);
    const update = () => setEquipmentOpen(!media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const select = (key: string) => { setSelectedId(key); setQuantity(1); setNotice(''); };
  const chooseSlot = (slot: string) => {
    setSelectedId(''); setCategory('equipment'); setSlotFilter(slot); setSearch('');
    window.requestAnimationFrame(() => contents.current?.scrollIntoView({ block: 'start' }));
  };
  const act = async (request: Parameters<ViewProps['command']>[0]) => {
    if (disabled) return;
    setPending(true); setNotice('');
    try { if (!await command(request)) setNotice('操作未完成'); }
    catch (error) { setNotice(error instanceof Error ? error.message : '操作未完成'); }
    finally { setPending(false); }
  };
  const actions = selected && (isInstance(selected) ? selected.slot && <div className="bag-detail-actions">
    {selected.equipped && <button disabled={disabled} onClick={() => chooseSlot(selected.slot!)}><RefreshCw size={16} />更换</button>}
    <button className={selected.equipped ? '' : 'primary'} disabled={disabled} onClick={() => void act(selected.equipped
      ? { type: 'unequip', slot: selected.slot! } : { type: 'equip', instanceId: selected.instanceId })}>
      {selected.equipped ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}{selected.equipped ? '卸下' : equipped ? '替换装备' : '装备'}
    </button>
  </div> : selected.use && <div className="bag-detail-actions">
    {selected.use.maxBatch !== 1 && <Quantity label="使用数量" value={quantity} max={max} onChange={setQuantity} disabled={disabled} />}
    <button className="primary" disabled={disabled || Boolean(selected.use.issue) || !Number.isInteger(quantity) || quantity < 1 || quantity > max}
      onClick={() => void act({ type: 'use', itemId: selected.itemId, quantity: selected.use!.maxBatch === 1 ? 1 : quantity })}>
      <FlaskConical size={16} />{selected.kind === 'foundation-pill' ? '服丹筑基' : selected.kind === 'food' ? '服用' : '使用'}
    </button>
  </div>);
  return <div className="page inventory-view">
    <div className="page-heading bag-heading"><h1>行囊</h1><span className="muted small"><Package size={14} />
      {filtered ? `${visible.length} / ${stored.length} 项` : `袋内 ${stored.length} 项`}</span></div>
    <section className={`bag-equipment ${equipmentOpen ? 'expanded' : 'collapsed'}`} aria-label="当前配装">
      <div className="bag-section-heading"><h2>当前配装</h2><span>{game.instances.filter(item => item.equipped).length} / {Object.keys(SLOT_NAMES).length}</span>
        <IconButton label={equipmentOpen ? '收起配装' : '展开配装'} aria-expanded={equipmentOpen} onClick={() => setEquipmentOpen(!equipmentOpen)}>
          {equipmentOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </IconButton>
      </div>
      {equipmentOpen && <div className="bag-equipment-rack">
        {Object.entries(SLOT_NAMES).map(([slot, name]) => {
          const item = game.instances.find(entry => entry.instanceId === game.equipment[slot as keyof typeof game.equipment]);
          return <button key={slot} className={`bag-equipment-slot ${item ? 'filled quality-marked' : 'vacant'}`}
            data-quality={item ? qualityBand(item) : undefined}
            onClick={() => item ? select(item.instanceId) : chooseSlot(slot)}
            aria-label={item ? `${name}：${item.name}，查看装备` : `${name}未装备，选择器物`} title={item?.name ?? `选择${name}器物`}>
            <span className="bag-slot-label">{name}</span><ItemGlyph slot={slot} itemId={item?.itemId} size={21} />
            <strong>{item?.name ?? (slot === 'weapon' ? '空手' : '未装备')}</strong>
          </button>;
        })}
      </div>}
    </section>
    <section ref={contents} className="bag-contents" aria-label="袋内物品">
      <div className="bag-tools">
        <div className="bag-search-row">
          <SearchField value={search} onChange={setSearch} placeholder="搜索物品" />
          <button className="bag-sort" aria-label={`排序：${SORT_MODES[sortIndex].label}`} title={`切换为${nextSort.label}`}
            onClick={() => onSortChange(nextSort.id)}><ArrowDownWideNarrow size={15} /><span>{SORT_MODES[sortIndex].label}</span></button>
          <IconButton label="清除物品筛选" disabled={!filtered} onClick={() => { setCategory('all'); setSlotFilter('all'); setSearch(''); }}><X size={15} /></IconButton>
        </div>
        <div className="bag-categories" role="group" aria-label="物品类别">
          {['all', ...CATEGORY_ORDER].map(id => {
            const count = id === 'all' ? stored.length : stored.filter(item => entryKind(item) === id).length;
            const label = id === 'all' ? '全部' : KIND_NAMES[id];
            return <button key={id} aria-label={label} aria-pressed={category === id} title={`${label} · ${count} 项`}
              onClick={() => { setCategory(id); setSlotFilter('all'); }}>
              {label}{count > 0 && <small aria-hidden="true">{count}</small>}
            </button>;
          })}
        </div>
        {category === 'equipment' && <div className="bag-slot-filters" role="group" aria-label="装备部位">
          {[['all', '全部部位'], ...Object.entries(SLOT_NAMES)].map(([id, name]) =>
            <button key={id} aria-pressed={slotFilter === id} onClick={() => setSlotFilter(id)}>{name}</button>)}
        </div>}
      </div>
      <div className="bag-grid">
        {visible.map(item => <button className={`bag-item ${entryKind(item)} ${isInstance(item) ? 'quality-marked' : ''}`}
          data-quality={qualityBand(item)} key={entryKey(item)} onClick={() => select(entryKey(item))}
          aria-label={`查看${item.name}${isInstance(item) ? `，品质${item.quality}，编号${item.instanceId}` : `，持有${item.quantity}份`}，回收单价${item.sellPrice}灵石`} title={item.name}>
          <span className="bag-item-top"><ItemGlyph kind={entryKind(item)} slot={isInstance(item) ? item.slot : undefined} itemId={item.itemId} size={24} />
            <span className={`bag-item-amount ${isInstance(item) ? 'quality-value' : ''}`} title={isInstance(item) ? `品质 ${item.quality}` : `持有 ${item.quantity} 份`}>
              {isInstance(item) ? <>{Number(qualityBand(item)) >= 1.25 ? <Sparkles size={11} /> : <small>品</small>}{item.quality}</> : `×${formatAmount(item.quantity)}`}
            </span></span>
          <strong>{item.name}</strong>
          <span className="bag-item-price" aria-label={`回收单价${item.sellPrice}灵石`} title={`回收单价 ${item.sellPrice} 灵石`}>
            <Coins size={12} /><span>{formatAmount(item.sellPrice)}</span><small>/{isInstance(item) ? '件' : '份'}</small>
          </span>
        </button>)}
      </div>
      {!visible.length && <Empty>{stored.length ? '没有符合条件的物品' : '行囊空空'}</Empty>}
    </section>
    {selected && <Dialog title={isInstance(selected) && selected.equipped ? '已装备器物' : '物品详情'} onClose={() => setSelectedId('')} footer={actions}>
      <ItemDetails item={selected} showBonuses={!comparing} />
      {comparing && <EquipmentComparison item={selected as Instance} equipped={equipped} />}
      <div className="item-valuation"><Coins size={14} /><span>回收单价</span><strong>{formatAmount(selected.sellPrice)} 灵石</strong></div>
      {!isInstance(selected) && selected.use?.issue && <p className="negative">{selected.use.issue}</p>}
      {notice && <p className="negative" role="alert">{notice}</p>}
    </Dialog>}
  </div>;
}

export function ShopView({ game, blocked, command }: ViewProps) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const tradeFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const disabled = blocked || pending;
  const owner = side === 'buy' ? game.shop : game;
  const items: Entry[] = [...owner.inventory, ...owner.instances].filter(item => item.name.includes(search));
  const item = items.find(entry => entryKey(entry) === selectedId);
  const price = item ? side === 'buy' ? item.buyPrice : item.sellPrice : '0';
  const max = item ? Math.min(isInstance(item) ? 1 : batchLimit(item.quantity, '1', 10000),
    side === 'buy' ? batchLimit(game.money, price, 10000) : 10000) : 0;
  const amount = item && isInstance(item) ? 1 : quantity;
  useEffect(() => { if (selectedId && !item) setSelectedId(''); }, [selectedId, item]);
  const tradeItem = async (side: 'buy' | 'sell', entry: Entry, quantity: number) => {
    const limit = Math.min(isInstance(entry) ? 1 : batchLimit(entry.quantity, '1', 10000),
      side === 'buy' ? batchLimit(game.money, entry.buyPrice, 10000) : 10000);
    if (blocked || tradeFlight.current || !game.shop.available || !Number.isInteger(quantity) || quantity < 1 || quantity > limit ||
      side === 'sell' && isInstance(entry) && entry.equipped) return;
    tradeFlight.current = true;
    setPending(true); setNotice('');
    try {
      if (!await command({ type: side, shopId: game.shop.id, quantity, target: isInstance(entry)
        ? { kind: 'instance', instanceId: entry.instanceId } : { kind: 'stack', itemId: entry.itemId } })) setNotice('交易未完成');
    } catch (error) { setNotice(error instanceof Error ? error.message : '交易未完成'); }
    finally { tradeFlight.current = false; setPending(false); }
  };
  if (!game.shop.available) return <Empty>当前地点不能交易</Empty>;
  return <div className="shop-view">
    <div className="section-line"><span className="wallet"><Coins size={16} />{formatAmount(game.money)} 灵石</span>
      <button disabled={disabled || !game.shop.refreshDue} onClick={() => void command({ type: 'visit-shop', shopId: game.shop.id })}>
        <RefreshCw size={15} />{game.shop.refreshDue ? '查看今日货物' : '今日货物已更新'}</button></div>
    <Tabs label="商店买卖" value={side} options={[{ id: 'buy', label: '购入' }, { id: 'sell', label: '售出' }]}
      onChange={value => { setSide(value); setSelectedId(''); setQuantity(1); setNotice(''); }} />
    <div className="list-toolbar"><SearchField value={search} onChange={setSearch} placeholder="查找交易物品" /></div>
    {game.shop.refreshDue && side === 'buy' ? <Empty icon={<ShoppingCart size={28} />}>今日货物尚未查看</Empty>
      : <EntryList items={items} prices={side} disabled={disabled}
        sell={side === 'sell' ? (entry, amount) => void tradeItem('sell', entry, amount) : undefined}
        select={key => { setSelectedId(key); setQuantity(1); setNotice(''); }} />}
    {notice && !item && <p className="negative" role="alert">{notice}</p>}
    {item && <Dialog title={side === 'buy' ? '购入物品' : '售出物品'} onClose={() => setSelectedId('')}>
      <ItemDetails item={item} amountLabel={side === 'buy' ? '在售' : '持有'} />
      <div className="item-valuation"><span>单价</span><strong>{formatAmount(price)} 灵石</strong></div>
      {!isInstance(item) && <Quantity value={quantity} max={max} label="交易数量" onChange={setQuantity} disabled={disabled} />}
      <div className="trade-total"><span>合计</span><strong>{formatAmount(multiply(price, Number.isFinite(amount) ? amount : 0))}<small> 灵石</small></strong></div>
      {side === 'sell' && isInstance(item) && item.equipped && <p className="negative">须先卸下此器物</p>}
      {side === 'buy' && !hasEnough(game.money, price, amount || 1) && <p className="negative">灵石不足</p>}
      <button className={side === 'buy' ? 'primary full' : 'full'} disabled={disabled || !Number.isInteger(amount) || amount < 1 || amount > max ||
        side === 'sell' && isInstance(item) && item.equipped}
        onClick={() => void tradeItem(side, item, amount)}>
        {side === 'buy' ? <ShoppingCart size={16} /> : <Coins size={16} />}{side === 'buy' ? '购入' : '售出'}</button>
      {notice && <p className="negative" role="alert">{notice}</p>}
    </Dialog>}
  </div>;
}
