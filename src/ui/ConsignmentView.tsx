import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpFromLine, Check, ChevronDown, Coins, LoaderCircle,
  RefreshCw, Search, ShoppingCart, Undo2, X } from 'lucide-react';
import { ITEMS, MANOR_AID } from '../../core/prototype/content';
import { consignmentFee, consignmentPriceSchema, type ConsignmentAsset } from '../../core/prototype/consignment';
import { equipmentSource, rarityMultiplier } from '../../core/prototype/equipment';
import { consignmentFilterSchema, type ConsignmentFilter, type ConsignmentRequest, type ConsignmentView } from '../../shared/consignment';
import type { OpeningView } from '../../shared/opening-contracts';
import type { GameClient } from '../game-client';
import { formatAmount } from '../format';
import { Bonuses, Dialog, Empty, IconButton, ItemGlyph, Quantity, SearchField, Tabs } from './common';

type View = ConsignmentView['view'];
type Confirmation = { command: ConsignmentRequest['command']; label: string; detail: string; asset?: ConsignmentAsset };
const views: { id: View; name: string }[] = [
  { id: 'market', name: '寄售货单' }, { id: 'mine', name: '我的寄售' }, { id: 'deliveries', name: '待领取' },
];
const categories = [
  ['material', '材料'], ['food', '补给'], ['marrow', '灵髓'], ['insight', '修为用品'],
  ['foundation-pill', '筑基丹药'], ['part', '炼材'], ['equipment', '装备'],
] as const;

function assetName(asset: ConsignmentAsset) {
  return asset.kind === 'money' ? '灵石' : `${ITEMS[asset.itemId]?.name ?? asset.itemId}${asset.kind === 'instance' ? ` · 品质${asset.quality}` : ''}`;
}
function glyphOf(asset: ConsignmentAsset) {
  return asset.kind === 'money' ? { kind: 'money' } : { kind: ITEMS[asset.itemId]?.kind, slot: ITEMS[asset.itemId]?.slot ?? null, itemId: asset.itemId };
}

function AssetCard({ asset, badge, figure, meta, children }: {
  asset: ConsignmentAsset; badge?: ReactNode; figure?: ReactNode; meta?: ReactNode; children?: ReactNode;
}) {
  const item = asset.kind === 'money' ? undefined : ITEMS[asset.itemId];
  const instance = asset.kind === 'instance' ? asset : null;
  return <article className={`consignment-card ${instance ? 'quality-marked' : ''}`}
    data-quality={instance ? rarityMultiplier(instance.quality) : undefined}>
    <header className="consignment-card-head">
      <ItemGlyph {...glyphOf(asset)} size={20} />
      <div className="consignment-card-name">
        <h3>{asset.kind === 'money' ? '灵石' : item?.name ?? asset.itemId}</h3>
        {instance && <span className="consignment-quality" title={`品质 ${instance.quality}`}>品质 {instance.quality}</span>}
      </div>
      {badge}
      {figure}
    </header>
    {item && <div className="consignment-card-info">
      {asset.kind === 'instance' && item.kind === 'equipment' && <Bonuses source={equipmentSource('consignment-preview', asset)} />}
      {item.effectDescription && <p className="item-bonuses">{item.effectDescription}</p>}
      {item.description && <p className="consignment-card-desc">{item.description}</p>}
    </div>}
    {meta && <p className="consignment-card-meta">{meta}</p>}
    {children && <footer className="consignment-card-foot">{children}</footer>}
  </article>;
}

function listingState(status: ConsignmentView['listings'][number]['status']) {
  if (status === 'active') return <span className="consignment-state sale">在售</span>;
  return <span className={`consignment-state ${status === 'sold' ? 'gone' : 'off'}`}>{status === 'sold' ? '已售罄' : '已撤回'}</span>;
}

function ListingCard({ listing, disabled, money, confirm }: {
  listing: ConsignmentView['listings'][number]; disabled: boolean; money: string; confirm: (value: Confirmation) => void;
}) {
  const maximum = listing.asset.kind === 'instance' ? 1 : listing.remaining;
  const [amount, setAmount] = useState(1);
  useEffect(() => { if (amount > maximum) setAmount(maximum); }, [amount, maximum]);
  const quantity = listing.asset.kind === 'instance' ? 1
    : Number.isInteger(amount) && amount >= 1 && amount <= maximum ? amount : 0;
  const total = BigInt(listing.unitPrice) * BigInt(quantity);
  const short = quantity > 0 && total > BigInt(money);
  const active = listing.status === 'active';
  return <AssetCard asset={listing.asset} badge={listingState(listing.status)}
    figure={<span className="consignment-unit-price" title={`单价 ${listing.unitPrice} 灵石`}>
      <Coins size={13} />{formatAmount(listing.unitPrice)}<small>/件</small></span>}
    meta={active && <>
      <span>余量 <b>{listing.remaining}</b>{listing.asset.kind === 'stack' ? ' 份' : ' 件'}</span>
      <span className="consignment-seller">{listing.isSelf ? '我上架' : listing.sellerName}</span>
    </>}>
    {active && (listing.isSelf
      ? <button disabled={disabled} onClick={() => confirm({
          command: { type: 'cancel', listingId: listing.id }, label: `撤回${assetName(listing.asset)}`,
          detail: `撤回时的未售余量转入待领取，不收撤回费。当前余量 ${listing.remaining}。`,
        })}><Undo2 size={16} />撤回</button>
      : <>
        {listing.asset.kind === 'stack' && <div className="consignment-card-deal">
          <Quantity value={amount} max={maximum} label="购买数量" onChange={setAmount} disabled={disabled} />
          <span className="consignment-sum" title={`${total} 灵石`}>
            {quantity ? <>合计 <b>{formatAmount(String(total))}</b>{short && <em>余额不足</em>}</> : '数量无效'}
          </span>
        </div>}
        <button className="consignment-card-act" disabled={disabled || !quantity || short} onClick={() => confirm({
          command: { type: 'buy', listingId: listing.id, unitPrice: listing.unitPrice, quantity },
          label: `购买${assetName(listing.asset)} ×${quantity}`,
          detail: `单价 ${listing.unitPrice}灵石，支付 ${total}灵石。商品转入待领取；数量不足时本次不成交。`,
        })}><ShoppingCart size={16} />购买</button>
      </>)}
  </AssetCard>;
}

function DeliveryCard({ delivery, disabled, confirm }: {
  delivery: ConsignmentView['deliveries'][number]; disabled: boolean; confirm: (value: Confirmation) => void;
}) {
  const maximum = delivery.asset.kind === 'instance' ? 1 : Number(BigInt(delivery.quantity) > 1_000_000_000_000n
    ? 1_000_000_000_000n : BigInt(delivery.quantity));
  const [amount, setAmount] = useState(maximum);
  const quantity = delivery.asset.kind === 'instance' ? 1
    : Number.isInteger(amount) && amount >= 1 && amount <= maximum ? amount : 0;
  return <AssetCard asset={delivery.asset}
    figure={<span className="consignment-unit-price" title={`待领 ${delivery.quantity}`}>
      ×{formatAmount(delivery.quantity)}<small>{delivery.asset.kind === 'stack' ? '份' : delivery.asset.kind === 'money' ? '灵石' : '件'}</small></span>}
    meta={delivery.asset.kind === 'stack' ? '可分批领取' : null}>
    {delivery.asset.kind === 'stack' && <Quantity value={amount} max={maximum} label="领取数量"
      onChange={setAmount} disabled={disabled} />}
    <button className="consignment-card-act" disabled={disabled || !quantity} onClick={() => confirm({
      command: { type: 'claim', deliveryId: delivery.id, quantity }, asset: delivery.asset,
      label: `领取${assetName(delivery.asset)} ×${quantity}`, detail: '不收领取费。容量不足时不领取，资产仍由商会保管。',
    })}><ArrowDownToLine size={16} />领取</button>
  </AssetCard>;
}

function ListingForm({ game, disabled, confirm }: { game: OpeningView; disabled: boolean; confirm: (value: Confirmation) => void }) {
  const options = [
    ...game.inventory.filter(item => item.itemId !== MANOR_AID.itemId).map(item => ({
      key: `stack:${item.itemId}`, itemId: item.itemId, name: item.name, note: `×${item.quantity}`,
      floor: item.sellPrice, maximum: Math.min(Number(item.quantity), 10000),
      selection: { kind: 'stack' as const, itemId: item.itemId },
    })),
    ...game.instances.filter(item => !item.equipped && item.itemId !== MANOR_AID.itemId).map(item => ({
      key: item.instanceId, itemId: item.itemId, name: item.name, note: `品质${item.quality} · #${item.instanceId.slice(5)}`,
      floor: item.sellPrice, maximum: 1, selection: { kind: 'instance' as const, instanceId: item.instanceId },
    })),
  ];
  const [selected, setSelected] = useState('');
  const [amount, setAmount] = useState(1);
  const [price, setPrice] = useState('');
  const [search, setSearch] = useState('');
  const candidates = search ? options.filter(option => option.name.includes(search.trim())) : options;
  const item = options.find(option => option.key === selected);
  const quantity = item?.selection.kind === 'instance' ? 1
    : Number.isInteger(amount) && amount >= 1 && amount <= (item?.maximum ?? 0) ? amount : 0;
  const parsedPrice = consignmentPriceSchema.safeParse(price);
  const priced = parsedPrice.success && item && BigInt(price) >= BigInt(item.floor);
  const valid = Boolean(item) && quantity > 0 && priced;
  const gross = priced && quantity ? String(BigInt(price) * BigInt(quantity)) : '0';
  const fee = consignmentFee(gross);
  const select = (option: typeof options[number]) => {
    setSelected(option.key); setAmount(1); setPrice(option.floor);
  };
  return <form className="consignment-list-form" onSubmit={event => {
    event.preventDefault();
    if (!valid || !item) return;
    confirm({
      command: { type: 'list', unitPrice: price, selection: item.selection.kind === 'stack'
        ? { ...item.selection, quantity } : item.selection },
      label: item.selection.kind === 'stack' ? `上架${item.name}，本次 ${quantity}份` : `上架${item.name}（${item.note}）`,
      detail: `单价 ${price}灵石；全部售出毛额 ${gross}，手续费 ${fee}，净得 ${BigInt(gross) - BigInt(fee)}灵石。`,
    });
  }}>
    <h3>上架物品</h3>
    <div className="consignment-picker">
      <SearchField value={search} onChange={setSearch} placeholder="查找行囊中的可寄售物品" />
      <div className="consignment-candidates" role="listbox" aria-label="选择上架物品">
        {candidates.map(option => <button type="button" key={option.key} role="option" disabled={disabled}
          aria-selected={selected === option.key} className="consignment-candidate" onClick={() => select(option)}>
          <ItemGlyph kind={ITEMS[option.itemId]?.kind} slot={ITEMS[option.itemId]?.slot ?? null} itemId={option.itemId} size={18} />
          <span className="consignment-candidate-name">{option.name}<small>{option.note}</small></span>
          <span className="consignment-candidate-floor" title={`${option.floor} 灵石`}>回收 {formatAmount(option.floor)}</span>
        </button>)}
        {!candidates.length && <p className="empty-line">没有匹配的物品</p>}
      </div>
    </div>
    {item && <div className="consignment-list-fields">
      <div className="consignment-list-inputs">
        {item.selection.kind === 'stack' && <Quantity value={amount} max={item.maximum} label="上架数量"
          onChange={setAmount} disabled={disabled} />}
        <label className="consignment-price-field">单价（灵石）
          <input type="text" inputMode="numeric" maxLength={13} value={price} disabled={disabled}
            aria-invalid={!priced} onChange={event => setPrice(event.target.value)} /></label>
      </div>
      <dl className="consignment-preview">
        <div><dt>最低单价</dt><dd title={`${item.floor} 灵石`}>{formatAmount(item.floor)}</dd></div>
        <div><dt>全售出毛额</dt><dd title={`${gross} 灵石`}>{formatAmount(gross)}</dd></div>
        <div><dt>手续费 2%</dt><dd title={`${fee} 灵石`}>{formatAmount(fee)}</dd></div>
        <div><dt>预计净得</dt><dd title={`${BigInt(gross) - BigInt(fee)} 灵石`}>
          {formatAmount(String(BigInt(gross) - BigInt(fee)))}</dd></div>
      </dl>
      {!priced && parsedPrice.success && <p className="cost-warning">单价不能低于系统回收价 {item.floor} 灵石。</p>}
      {!parsedPrice.success && price !== '' && <p className="cost-warning">单价须为 1 至 1000000000000 的整数。</p>}
    </div>}
    <button className="primary" disabled={disabled || !valid} type="submit"><ArrowUpFromLine size={16} />上架</button>
  </form>;
}

interface FilterDraft { search: string; category: ConsignmentFilter['category']; minQuality: string; maxQuality: string; minPrice: string; maxPrice: string }
const emptyDraft: FilterDraft = { search: '', category: undefined, minQuality: '', maxQuality: '', minPrice: '', maxPrice: '' };

function Filters({ disabled, filter, apply }: { disabled: boolean; filter: ConsignmentFilter; apply: (value: ConsignmentFilter) => void }) {
  const [draft, setDraft] = useState<FilterDraft>({ ...emptyDraft, search: filter.search ?? '', category: filter.category,
    minQuality: filter.minQuality ? String(filter.minQuality) : '', maxQuality: filter.maxQuality ? String(filter.maxQuality) : '',
    minPrice: filter.minPrice ?? '', maxPrice: filter.maxPrice ?? '' });
  const [error, setError] = useState(false);
  useEffect(() => {
    setDraft({ ...emptyDraft, search: filter.search ?? '', category: filter.category,
      minQuality: filter.minQuality ? String(filter.minQuality) : '', maxQuality: filter.maxQuality ? String(filter.maxQuality) : '',
      minPrice: filter.minPrice ?? '', maxPrice: filter.maxPrice ?? '' });
    setError(false);
  }, [filter]);
  const build = (value: FilterDraft) => {
    const parsed = consignmentFilterSchema.safeParse({
      search: value.search.trim() || undefined, category: value.category,
      minQuality: value.minQuality.trim() === '' ? undefined : Number(value.minQuality),
      maxQuality: value.maxQuality.trim() === '' ? undefined : Number(value.maxQuality),
      minPrice: value.minPrice.trim() || undefined, maxPrice: value.maxPrice.trim() || undefined,
    });
    setError(!parsed.success);
    if (parsed.success) apply(parsed.data);
  };
  const patch = (part: Partial<FilterDraft>) => setDraft(current => ({ ...current, ...part }));
  const pick = (category: ConsignmentFilter['category']) => build({ ...draft, category });
  return <form className="consignment-filters" onSubmit={event => { event.preventDefault(); build(draft); }}>
    <div className="consignment-search-row">
      <SearchField value={draft.search} onChange={value => patch({ search: value })} placeholder="查找货单物品" />
      <button type="submit" disabled={disabled}><Search size={15} />筛选</button>
      <button type="button" disabled={disabled} onClick={() => { setDraft(emptyDraft); apply({}); }}><X size={15} />重置</button>
    </div>
    <div className="consignment-categories" role="group" aria-label="货单类别">
      <button type="button" disabled={disabled} aria-pressed={!filter.category} onClick={() => pick(undefined)}>全部</button>
      {categories.map(([id, name]) => <button type="button" key={id} disabled={disabled} aria-pressed={filter.category === id}
        onClick={() => pick(id)}>{name}</button>)}
    </div>
    <details className="consignment-advanced">
      <summary><ChevronDown size={14} />品质与价格范围</summary>
      <div className="consignment-range-fields">
        <label>最低品质<input type="number" min={10} max={999} step={1} disabled={disabled} value={draft.minQuality}
          onChange={event => patch({ minQuality: event.target.value })} /></label>
        <label>最高品质<input type="number" min={10} max={999} step={1} disabled={disabled} value={draft.maxQuality}
          onChange={event => patch({ maxQuality: event.target.value })} /></label>
        <label>最低单价<input type="text" inputMode="numeric" maxLength={13} disabled={disabled} value={draft.minPrice}
          onChange={event => patch({ minPrice: event.target.value })} /></label>
        <label>最高单价<input type="text" inputMode="numeric" maxLength={13} disabled={disabled} value={draft.maxPrice}
          onChange={event => patch({ maxPrice: event.target.value })} /></label>
      </div>
      <p className="muted small">留空表示不限；改动后按“筛选”生效，类别切换立即生效。</p>
    </details>
    {error && <p role="alert" className="cost-warning">筛选范围无效；品质10至999，单价为1至1000000000000的整数，下限不能高于上限。</p>}
  </form>;
}

export function ConsignmentPanel({ game, shopId, blocked, pending, busy, stopped, message, load, submit }: {
  game: OpeningView; shopId: ConsignmentRequest['shopId']; blocked: boolean; pending: boolean; busy: boolean;
  stopped: boolean; message: string | null; load: GameClient['loadConsignment']; submit: GameClient['submitTrade'];
}) {
  const [view, setView] = useState<View>('market');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ConsignmentFilter>({});
  const [refresh, setRefresh] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; value: ConsignmentView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const failureKey = useRef('');
  const failureCount = useRef(0);
  const key = JSON.stringify([shopId, view, page, filter, refresh, retry]);
  const disabled = blocked || pending || busy || stopped;
  const data = loaded?.key === key && !stopped ? loaded.value : null;
  useEffect(() => {
    if (stopped) { setLoaded(null); setLoading(false); return; }
    if (pending || busy) { setLoading(false); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true); setError(null); setConfirmation(null);
    void load(shopId, view, page, filter).then(value => {
      if (!cancelled) { failureCount.current = 0; failureKey.current = ''; setLoaded({ key, value }); }
    }).catch(cause => {
      if (!cancelled) {
        setError(cause instanceof Error && !['TypeError', 'AbortError', 'ZodError'].includes(cause.name)
          ? cause.message : '商会暂不可用，请稍后再试。');
        failureCount.current = failureKey.current === key ? failureCount.current + 1 : 1;
        failureKey.current = key;
        if (failureCount.current <= 2) timer = setTimeout(() => { if (!cancelled) setRetry(value => value + 1); }, 1500);
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, shopId, view, page, filter, load, pending, busy, stopped]);

  return <div className="consignment-section">
    <div className="section-line"><span className="wallet"><Coins size={16} />{formatAmount(game.money)} 灵石</span>
      <span className="muted small">成交手续费 2% · 改价先撤回再上架</span>
      <IconButton label="重新读取寄售" disabled={disabled || loading} onClick={() => setRetry(value => value + 1)}>
        <RefreshCw size={16} /></IconButton></div>
    <Tabs label="商盟寄售" value={view} options={views.map(({ id, name }) => ({ id, label: name }))}
      onChange={id => { setView(id); setPage(0); setConfirmation(null); }} />
    <div className="consignment-panel" aria-busy={loading || busy}>
      {message && <p role="status" className="empty-line">{message}</p>}
      {(pending || busy) && !message && <p className="empty-line"><LoaderCircle size={16} className="spinning" />正在处理寄售操作</p>}
      {view === 'market' && <Filters disabled={disabled} filter={filter} apply={value => {
        setFilter(value); setPage(0); setConfirmation(null);
      }} />}
      {loading && !pending && !busy && !stopped && <p className="empty-line"><LoaderCircle size={16} className="spinning" />正在读取寄售</p>}
      {error && <p role="alert" className="cost-warning">{error}</p>}
      {data && <>
        {view === 'mine' && <>
          <p className="consignment-slots">在售位 <strong>{data.activeCount}</strong> / {data.slots}</p>
          <ListingForm game={game} disabled={disabled || data.activeCount >= data.slots} confirm={setConfirmation} />
        </>}
        <div className="consignment-cards">
          {data.listings.map(listing => <ListingCard key={listing.id} listing={listing} disabled={disabled}
            money={game.money} confirm={setConfirmation} />)}
          {data.deliveries.map(delivery => <DeliveryCard key={`${delivery.id}:${delivery.quantity}`} delivery={delivery}
            disabled={disabled} confirm={setConfirmation} />)}
        </div>
        {!data.listings.length && !data.deliveries.length && <Empty>
          {view === 'deliveries' ? '暂无待领资产' : view === 'mine' ? '尚未上架物品' : '暂无符合条件的货单'}
        </Empty>}
        <div className="consignment-pagination">
          <IconButton label="上一页" disabled={page === 0 || disabled}
            onClick={() => { setPage(value => value - 1); setConfirmation(null); }}><ArrowLeft size={17} /></IconButton>
          <span>第 {page + 1} 页</span>
          <IconButton label="下一页" disabled={!data.hasMore || disabled}
            onClick={() => { setPage(value => value + 1); setConfirmation(null); }}><ArrowRight size={17} /></IconButton>
        </div>
        <dl className="consignment-totals" aria-label="累计成交账">
          <div><dt>购入支出</dt><dd>{formatAmount(data.totals.purchaseSpent)}</dd></div>
          <div><dt>售出毛额</dt><dd>{formatAmount(data.totals.saleGross)}</dd></div>
          <div><dt>已收手续费</dt><dd>{formatAmount(data.totals.saleFees)}</dd></div>
          <div><dt>售出净得</dt><dd>{formatAmount(data.totals.saleNet)}</dd></div>
        </dl>
      </>}
      {confirmation && <Dialog title="确认寄售操作" onClose={() => setConfirmation(null)} footer={<div className="dialog-actions">
        <button onClick={() => setConfirmation(null)}><X size={16} />取消</button>
        <button className="primary" disabled={disabled} onClick={() => {
          const current = confirmation;
          setConfirmation(null);
          void submit(shopId, current.command, current.asset).then(() => setRefresh(value => value + 1));
        }}><Check size={16} />确认</button>
      </div>}>
        <h3>{confirmation.label}</h3><p>{confirmation.detail}</p>
      </Dialog>}
    </div>
  </div>;
}
