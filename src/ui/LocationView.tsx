import { useState } from 'react';
import { ArrowRight, Axe, BookOpen, Check, Coins, Compass, Fish, FlaskConical, Info, Moon, Pickaxe, ScrollText, ShieldCheck, Sparkles, Store, Swords, Users, Wind } from 'lucide-react';
import { merchantShopSchema } from '../../core/prototype/consignment';
import { formatAmount, formatDecimal, percent } from '../format';
import { ActivityView } from './ActivityPanel';
import { areaFor } from './world';
import { SceneArt } from './art';
import { Bonuses, Dialog, IconButton } from './common';
import type { CombatFrame } from '../combat-presentation';
import type { Page, ViewProps } from './types';

export function LocationView({ game, blocked, command, open, frame, paused, lastBattleId, nearbyCount }: ViewProps & {
  open: (page: Page) => void; frame: CombatFrame; paused: boolean; lastBattleId: string | null; nearbyCount: number | null;
}) {
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [moonOpen, setMoonOpen] = useState(false);
  const region = game.regions.find(entry => entry.id === game.locationId);
  const nearby = game.regions.filter(entry => entry.parent === game.locationId && !(entry.challenge && entry.completed));
  const retry = game.isSafeLocation ? game.regions.find(entry => entry.id === lastBattleId &&
    !(entry.challenge && entry.completed)) : undefined;
  const services = <>
    {game.shop.available && <button onClick={() => { open('shop'); if (game.shop.refreshDue && !blocked) void command({ type: 'visit-shop', shopId: game.shop.id }); }}>
      <Store size={22} /><span><strong>{game.shop.name}</strong><small>货物买卖</small></span><ArrowRight size={17} /></button>}
    {game.shop.available && merchantShopSchema.safeParse(game.shop.id).success && <button onClick={() => open('market')}>
      <Coins size={22} /><span><strong>商盟寄售</strong><small>四海共通货池</small></span><ArrowRight size={17} /></button>}
    {game.rankingsAvailable && <button onClick={() => open('rankings')}>
      <ScrollText size={22} /><span><strong>璇玑阁</strong><small>诸修名录</small></span><ArrowRight size={17} /></button>}
  </>;
  return <div className={`page location-view${game.battle ? '' : ' location-overview'}`}>
    <div className="page-heading"><div><span className="eyebrow">{areaFor(game.locationId).name} · {region ? '历练之地' : '歇脚之地'}</span><h1>{game.locationName}</h1></div>
      <button onClick={() => open('map')}><Compass size={16} />山河图</button></div>
    {game.isSafeLocation && <p className="location-safety"><ShieldCheck size={14} />安全区
      <span>{game.canMeditate ? '可调息' : '普通歇息'}</span></p>}
    {!game.battle && !game.reactor?.active && <><div className="place-actions">
      {game.jiyuanGuideAvailable && <button disabled={blocked} onClick={() => void command({ type: 'hear-jiyuan-guide' })}>
        <BookOpen size={16} />听采料者介绍</button>}
      {game.brokenplainIntroAvailable && <button disabled={blocked} onClick={() => void command({ type: 'steady-brokenplain' })}>
        <Wind size={16} />稳定心神</button>}
      {game.arkContractAvailable && <button disabled={blocked} onClick={() => void command({ type: 'read-ark-contract' })}>
        <ScrollText size={16} />解读阵务刻录</button>}
      {game.reactorAvailable && !game.reactor?.active && <button disabled={blocked}
        onClick={() => void command({ type: 'reactor', active: true })}><FlaskConical size={16} />灵能反应炉</button>}
      {game.domainObservationAvailable && <button disabled={blocked} onClick={() => void command({ type: 'observe-domain' })}>
        <Sparkles size={16} />远观斗法</button>}
      {game.moonOffering && <button disabled={blocked} onClick={() => setMoonOpen(true)}>
        <Moon size={16} />望月古龛</button>}
      {game.lakeInsightAvailable && <button disabled={blocked} onClick={() => void command({ type: 'claim-lake-insight' })}>
        <BookOpen size={16} />读湖岸手札</button>}
      {game.fishingAvailable && !game.fishing && <button disabled={blocked} onClick={() => void command({ type: 'fish', active: true })}>
        <Fish size={16} />湖岸垂钓</button>}
      {retry && <button className="primary" disabled={blocked || !retry.enterable}
        onClick={() => void command({ type: 'enter', regionId: retry.id })}><Swords size={16} />再探{retry.name}</button>}
      {region && <button className="primary" disabled={blocked || !region.explorable} onClick={() => void command({ type: 'explore' })}>
        <Swords size={16} />{region.challenge && region.completed ? '挑战已完成' : '开始探索'}</button>}
      {game.canMeditate && <button disabled={blocked || game.mode === 'sleep'} onClick={() => void command({ type: 'recover', mode: 'sleep' })}>
        <Wind size={16} />{game.mode === 'sleep' ? '调息中' : '调息'}</button>}
      {game.trainings.map(training => <button key={training.id} disabled={blocked || !training.available || training.active}
        onClick={() => void command({ type: 'train', skillId: training.id })}><Swords size={16} />{training.name}</button>)}
      {game.miningSites.map(site => <button key={site.id} disabled={blocked || !site.available || site.active}
        title={`${site.itemName} · ${percent(Number(site.chance))}出货率 · 1${site.maxQuantity > 1 ? `至${site.maxQuantity}` : ''}份${site.secondaryChance ? `，另${percent(Number(site.secondaryChance))}璇灵髓1份` : ''} · ${formatDecimal(site.cycleSeconds)}秒/轮`}
        onClick={() => void command({ type: 'gather', siteId: site.id })}>{site.skillId === 'logging' ? <Axe size={16} /> : <Pickaxe size={16} />}{site.name}</button>)}
      {game.manorAid && !game.manorAid.finished && <button disabled={blocked || game.manorAid.claimed}
        onClick={() => void command({ type: 'claim-manor-aid' })}><Check size={16} />{game.manorAid.claimed ? '已领取援助' : `领取${game.manorAid.name}`}</button>}
      {game.qixiaArray?.available && !game.qixiaArray.negotiated && <button disabled={blocked}
        onClick={() => void command({ type: 'negotiate-qixia-array' })}><Check size={16} />与守脉燧灵交涉</button>}
    </div>
      {game.qixiaArray?.negotiated && <form className="array-controls" onSubmit={event => {
        event.preventDefault();
        const layers = Number(new FormData(event.currentTarget).get('layers'));
        void command({ type: 'set-qixia-array', layers });
      }}>
        <label>阵庭层数<input key={game.qixiaArray.layers} type="number" name="layers" min={6}
          max={game.qixiaArray.unlockedMax} step={1} defaultValue={game.qixiaArray.layers} required disabled={blocked} /></label>
        <span className="muted small">可选上限 {game.qixiaArray.unlockedMax}</span>
        <button type="submit" disabled={blocked}><Check size={15} />确定</button>
      </form>}
      <nav className="place-links" aria-label="当地往来">{services}
        <button className="nearby-entry" onClick={() => open('nearby')}><Users size={16} />同地道友
          <small>{nearbyCount === null ? '未连接' : nearbyCount}</small></button>
      </nav></>}
    <ActivityView game={game} blocked={blocked} command={command} frame={frame} paused={paused} />
    {!game.battle && !game.fishing && !game.reactor?.active && <><SceneArt locationId={game.locationId} name={game.locationName} />
      <div className="place-intro"><p className="place-description">{game.locationDescription}</p>
        <IconButton label="查看完整地点描述" onClick={() => setDescriptionOpen(true)}><Info size={17} /></IconButton></div>
    </>}
    {!game.battle && !game.reactor?.active && nearby.length > 0 && <section className="nearby-exploration">
      <h2>附近历练</h2>
      <div className="nearby-exploration-list">{nearby.map(entry => <div key={entry.id}><span><strong>{entry.name}</strong>
        <small>{entry.challenge ? '独立挑战' : entry.completed ? '可重复探索' : `已清理 ${entry.clearedGroups} / ${entry.groupsPerClear} 组`}</small></span>
        <button disabled={blocked || !entry.enterable} onClick={() => void command({ type: 'enter', regionId: entry.id })}>
          <Swords size={15} />前往探索</button></div>)}</div>
    </section>}
    {game.battle && (game.shop.available || game.rankingsAvailable) && <section className="place-services">
      <h2>当地往来</h2>
      {services}
    </section>}
    {game.manuals.filter(manual => manual.learnable).map(manual => <div className="discovery" key={manual.id}><BookOpen size={18} />
      <span>{manual.name}</span><button disabled={blocked} onClick={() => void command({ type: 'learn-manual', manualId: manual.id })}>领悟<ArrowRight size={15} /></button></div>)}
    {!game.battle && descriptionOpen && <Dialog title={game.locationName} onClose={() => setDescriptionOpen(false)}>
      <p className="location-description-detail">{game.locationDescription}</p>
    </Dialog>}
    {moonOpen && game.moonOffering && <Dialog title="望月古龛" onClose={() => setMoonOpen(false)} footer={
      <button className="primary" disabled={blocked || BigInt(game.money) < BigInt(game.moonOffering.price)}
        onClick={() => { void command({ type: 'moon-offering' }).then(ok => { if (ok) setMoonOpen(false); }); }}>
        <Moon size={16} />供奉 {formatAmount(game.moonOffering.price)} 灵石</button>}>
      <h3>{game.moonOffering.name}赐福 · 1800秒</h3>
      <Bonuses source={game.moonOffering.source} />
      <p className="negative">供奉成功会清除当前全部临时药效、负面状态与旧月祝福，不恢复满血。</p>
      <p className="muted">现有状态：{game.effects.map(effect => effect.name).join('、') || '无'}</p>
    </Dialog>}
  </div>;
}
