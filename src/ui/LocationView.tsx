import { useState } from 'react';
import { ArrowRight, Axe, BookOpen, Check, Coins, Compass, Info, Pickaxe, ScrollText, Store, Swords, Users, Wind } from 'lucide-react';
import { merchantShopSchema } from '../../core/prototype/consignment';
import { formatDecimal, percent } from '../format';
import { ActivityView } from './ActivityPanel';
import { areaFor } from './world';
import { SceneArt } from './art';
import { Dialog, IconButton } from './common';
import type { CombatFrame } from '../combat-presentation';
import type { Page, ViewProps } from './types';

export function LocationView({ game, blocked, command, open, frame, paused, lastBattleId, nearbyCount }: ViewProps & {
  open: (page: Page) => void; frame: CombatFrame; paused: boolean; lastBattleId: string | null; nearbyCount: number | null;
}) {
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const region = game.regions.find(entry => entry.id === game.locationId);
  const nearby = game.regions.filter(entry => entry.parent === game.locationId && !(entry.challenge && entry.completed));
  const retry = nearby.find(entry => entry.id === lastBattleId);
  const services = <>
    {game.shop.available && <button onClick={() => { open('shop'); if (game.shop.refreshDue && !blocked) void command({ type: 'visit-shop', shopId: game.shop.id }); }}>
      <Store size={22} /><span><strong>{game.shop.name}</strong><small>货物买卖</small></span><ArrowRight size={17} /></button>}
    {game.shop.available && merchantShopSchema.safeParse(game.shop.id).success && <button onClick={() => open('market')}>
      <Coins size={22} /><span><strong>商盟寄售</strong><small>四海共通货池</small></span><ArrowRight size={17} /></button>}
    {game.rankingsAvailable && <button onClick={() => open('rankings')}>
      <ScrollText size={22} /><span><strong>璇玑阁</strong><small>诸修名录</small></span><ArrowRight size={17} /></button>}
  </>;
  return <div className={`page location-view${game.battle ? '' : ' location-overview'}`}>
    <div className="page-heading"><div><span className="eyebrow">{areaFor(game.locationId).name} · {region ? '历练之地' : '休整之地'}</span><h1>{game.locationName}</h1></div>
      <button onClick={() => open('map')}><Compass size={16} />山河图</button></div>
    {!game.battle && <><div className="place-actions">
      {retry && <button className="primary" disabled={blocked || !retry.enterable}
        onClick={() => void command({ type: 'enter', regionId: retry.id })}><Swords size={16} />再探{retry.name}</button>}
      {region && <button className="primary" disabled={blocked || !region.explorable} onClick={() => void command({ type: 'explore' })}>
        <Swords size={16} />{region.challenge && region.completed ? '挑战已完成' : '开始探索'}</button>}
      {game.canMeditate && <button disabled={blocked || game.mode === 'sleep'} onClick={() => void command({ type: 'recover', mode: 'sleep' })}>
        <Wind size={16} />{game.mode === 'sleep' ? '调息中' : '调息'}</button>}
      {game.trainings.map(training => <button key={training.id} disabled={blocked || !training.available || training.active}
        onClick={() => void command({ type: 'train', skillId: training.id })}><Swords size={16} />{training.name}</button>)}
      {game.miningSites.map(site => <button key={site.id} disabled={blocked || !site.available || site.active}
        title={`${site.itemName} · ${percent(Number(site.chance))}出货率 · 1${site.maxQuantity > 1 ? `至${site.maxQuantity}` : ''}份 · ${formatDecimal(site.cycleSeconds)}秒/轮`}
        onClick={() => void command({ type: 'gather', siteId: site.id })}>{site.skillId === 'logging' ? <Axe size={16} /> : <Pickaxe size={16} />}{site.name}</button>)}
      {game.manorAid && !game.manorAid.finished && <button disabled={blocked || game.manorAid.claimed}
        onClick={() => void command({ type: 'claim-manor-aid' })}><Check size={16} />{game.manorAid.claimed ? '已领取援助' : `领取${game.manorAid.name}`}</button>}
    </div>
      <nav className="place-links" aria-label="当地往来">{services}
        <button className="nearby-entry" onClick={() => open('nearby')}><Users size={16} />同地道友
          <small>{nearbyCount === null ? '未连接' : nearbyCount}</small></button>
      </nav></>}
    <ActivityView game={game} blocked={blocked} command={command} frame={frame} paused={paused} />
    {!game.battle && <><SceneArt locationId={game.locationId} name={game.locationName} />
      <div className="place-intro"><p className="place-description">{game.locationDescription}</p>
        <IconButton label="查看完整地点描述" onClick={() => setDescriptionOpen(true)}><Info size={17} /></IconButton></div>
    </>}
    {!game.battle && nearby.length > 0 && <section className="nearby-exploration">
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
  </div>;
}
