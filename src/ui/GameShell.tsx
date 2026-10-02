import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Cloud, CloudOff, Compass, Expand, Flame, History, LoaderCircle, MoreHorizontal,
  Mountain, Package, RefreshCw, RotateCw, Shield, Terminal, X, MessageCircle } from 'lucide-react';
import { merchantShopSchema } from '../../core/prototype/consignment';
import { activityName } from './ActivityPanel';
import { CharacterPanel } from './CharacterPanel';
import { CraftView } from './CraftView';
import { Dialog, IconButton } from './common';
import { InventoryView, ShopView } from './InventoryView';
import { JournalView } from './JournalView';
import { BestiaryView } from './BestiaryView';
import { LocationView } from './LocationView';
import { LogPanel } from './LogPanel';
import { SettingsControl } from './SettingsControl';
import { useLogSettings } from './log-settings';
import { useSortSettings } from './sort-settings';
import { PracticeView } from './PracticeView';
import { ReincarnationDialog } from './ReincarnationDialog';
import { SaveRecoveryDialog } from './SaveRecoveryDialog';
import { WorldView } from './WorldView';
import { areaFor, type MapCamera } from './world';
import type { AreaTrackId } from './SettingsControl';
import { ConsignmentPanel } from './ConsignmentView';
import { RankingsPanel } from './RankingsView';
import type { GameSession, Page } from './types';
import { PolicyLinks } from './PolicyLinks';
import { useSocial } from '../use-social';
import type { SocialClient } from '../social-client';
import { NearbyPlayers } from './PlayerInteractions';
import { WorldChatView } from './WorldChatView';

const DebugConsole = import.meta.env.DEV ? lazy(() => import('../DebugConsole')) : null;
const PAGES = [
  { id: 'world', label: '游历', icon: Compass }, { id: 'bag', label: '行囊', icon: Package },
  { id: 'practice', label: '修行', icon: BookOpen }, { id: 'craft', label: '炉鼎', icon: Flame },
  { id: 'journal', label: '履历', icon: History },
  { id: 'chat', label: '世界', icon: MessageCircle },
] as const;
export function GameShell({ session, social, previewControls, mobileActivity = false }: {
  session: GameSession; social?: SocialClient; previewControls?: ReactNode; mobileActivity?: boolean;
}) {
  const socialState = useSocial(social);
  const [logSettings, setLogSettings] = useLogSettings(Boolean(previewControls));
  const [sortSettings, setSortSettings] = useSortSettings(Boolean(previewControls));
  const [page, setPage] = useState<Page>('world');
  const [overlay, setOverlay] = useState<'reincarnation' | 'debug' | 'saves' | 'policies' | null>(null);
  const [displayError, setDisplayError] = useState('');
  const pageRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const mapCamera = useRef<MapCamera | null>(null);
  const lastBattle = useRef<string | null>(null);
  const game = session.response?.game;
  const merchant = game?.shop.available ? merchantShopSchema.safeParse(game.shop.id) : null;
  const props = game ? { game, command: session.command, blocked: session.blocked } : null;
  useEffect(() => { setOverlay(null); setPage('world'); mapCamera.current = null; lastBattle.current = null; }, [session.response?.characterId, game?.life.number]);
  useEffect(() => { if (game?.battle) lastBattle.current = game.battle.regionId; }, [game?.battle?.regionId]);
  useEffect(() => {
    setPage(current => ['shop', 'market', 'rankings', 'nearby'].includes(current) ? 'world' : current);
    if (page === 'world' && pageRef.current) pageRef.current.scrollTop = 0;
  }, [game?.locationId]);
  useEffect(() => { if (pageRef.current) pageRef.current.scrollTop = 0; }, [page]);
  const service = page === 'shop' || page === 'market' || page === 'rankings';
  const localPage = page === 'map' || page === 'nearby' || service;
  return <>
    <div className="orientation-gate"><RotateCw size={42} strokeWidth={1.2} /><h1>横屏入境</h1><p>请将设备转为横屏</p><span>茉莉修仙传</span></div>
    <div className={`game-shell${mobileActivity ? ' activity-mobile' : ''}`}>
      <header className="topbar">
        <div className="brand"><Mountain size={23} strokeWidth={1.4} /><strong>茉莉修仙传</strong></div>
        <div className="breadcrumb"><span>{game ? areaFor(game.locationId).name : '山河初卷'}</span><ChevronRight size={12} /><strong>{game?.locationName ?? '静候入世'}</strong>
          {game && <time className="world-date">{game.calendar.year}年{game.calendar.month}月{game.calendar.day}日</time>}</div>
        <div className="topbar-tools">
          {previewControls && <details className="preview-menu"><summary title="预览角色设置">预览</summary><div className="preview-controls">{previewControls}</div></details>}
          <SettingsControl areaId={(game ? areaFor(game.locationId).id : null) as AreaTrackId | null} locationId={game?.locationId} logLimit={logSettings.limit}
            onLogLimitChange={limit => setLogSettings(current => ({ ...current, limit }))} />
          <IconButton label="切换全屏" onClick={() => { const operation = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
            void operation?.catch(() => setDisplayError('此环境暂不支持全屏')); }}><Expand size={17} /></IconButton>
          <IconButton label="上传云存档" disabled={session.blocked || session.refreshing || session.tradePending || session.tradeBusy || session.tradeStopped}
            onClick={() => void session.refresh()}>{session.refreshing ? <LoaderCircle size={17} className="spinning" /> : session.tradeStopped ? <CloudOff size={17} /> : <Cloud size={17} />}</IconButton>
          <details className="system-menu" ref={menuRef}><summary aria-label="更多选项" title="更多选项"><MoreHorizontal size={18} /></summary><div>
            {!previewControls && <button disabled={!session.recoveryAvailable} onClick={() => { setOverlay('saves'); menuRef.current!.open = false; }}><Cloud size={16} />存档管理</button>}
            <button onClick={() => { setOverlay('policies'); menuRef.current!.open = false; }}><Shield size={16} />隐私与条款</button>
            {DebugConsole && <button disabled={!game} onClick={() => { setOverlay('debug'); menuRef.current!.open = false; }}><Terminal size={16} />测试控制台</button>}
          </div></details>
        </div>
      </header>
      {game && props ? <CharacterPanel key={`character:${session.response!.characterId}:${game.life.number}`} {...props} goActivity={() => setPage('world')} />
        : <aside className="character-panel connecting-screen"><Mountain size={32} /><span>正在读取角色</span></aside>}
      <div className="workspace-main">
        <nav className="central-nav" aria-label="主导航">{PAGES.map(({ id, label, icon: Icon }) => <button key={id} disabled={!game}
          className={(page === id || id === 'world' && localPage || id === 'journal' && page === 'bestiary') ? 'selected' : ''}
          aria-current={page === id || id === 'world' && localPage || id === 'journal' && page === 'bestiary' ? 'page' : undefined} onClick={() => setPage(id)}>
          <Icon size={17} /><span>{label}{id === 'chat' && socialState.unread > 0 && <small className="chat-unread">{socialState.unread > 99 ? '99+' : socialState.unread}</small>}</span></button>)}</nav>
        {(session.issue || displayError) && <div className="alert-bar" role="alert"><span>{session.issue?.message ?? displayError}</span>
          {session.recoveryAvailable && session.issue?.source !== 'action' &&
            <IconButton label="核对与恢复存档" onClick={() => setOverlay('saves')}><Cloud size={15} /></IconButton>}
          {session.issue?.retryable !== false && <IconButton label="重试" disabled={session.busy || session.reincarnationBusy} onClick={() => void session.retry()}><RefreshCw size={15} /></IconButton>}
          {!session.blocked && <IconButton label="关闭提示" onClick={() => { session.dismissIssue(); setDisplayError(''); }}><X size={15} /></IconButton>}
        </div>}
        {session.tradePending && <div className="alert-bar" role="status"><span>寄售待确认 · {session.tradeMessage ?? '相关资产暂由商盟保管'}</span>
          <button disabled={session.tradeBusy || session.blocked} onClick={() => void session.reconcileTrade()}><RefreshCw size={15} />核对</button></div>}
        {session.reincarnationPending && <div className="alert-bar" role="status"><span>{session.reincarnationMessage ?? '轮回待确认，本世暂停'}</span>
          <button disabled={session.reincarnationBusy || session.recoveryBusy} onClick={() => void session.reconcileReincarnation()}><RefreshCw size={15} />核对轮回</button></div>}
        {!session.reincarnationPending && session.reincarnationMessage && <p className="session-message" role="status">{session.reincarnationMessage}</p>}
        {game && props ? <main ref={pageRef} className={`page-scroll${page === 'chat' ? ' chat-page-scroll' : ''}`} key={game.life.number}>
          {page === 'world' && <><LocationView key={`location:${game.locationId}`} {...props} open={setPage} frame={session.combatFrame} paused={session.combatPaused}
            lastBattleId={lastBattle.current} nearbyCount={socialState.status === 'online' ? socialState.nearby.length : null} />
            {game.battle && <NearbyPlayers key={game.locationId} state={socialState} client={social} />}</>}
          {page === 'nearby' && <div className="page nearby-page"><div className="page-heading">
            <div><span className="eyebrow">{game.locationName}</span><h1>同地道友</h1></div>
            <IconButton label="返回当地" onClick={() => setPage('world')}><ArrowLeft size={18} /></IconButton></div>
            <NearbyPlayers key={game.locationId} state={socialState} client={social} heading={false} />
          </div>}
          <WorldChatView state={socialState} client={social} visible={page === 'chat'} />
          {page === 'map' && <WorldView {...props} camera={mapCamera} onArrive={() => setPage('world')} />}
          {page === 'bag' && <InventoryView {...props} sort={sortSettings.bag}
            onSortChange={bag => setSortSettings(current => ({ ...current, bag }))} />}
          {page === 'practice' && <PracticeView {...props} />}
          {page === 'craft' && <CraftView {...props} sort={sortSettings.craft}
            onSortChange={craft => setSortSettings(current => ({ ...current, craft }))} />}
          {page === 'journal' && <JournalView {...props} openBestiary={() => setPage('bestiary')} openReincarnation={() => setOverlay('reincarnation')} />}
          {page === 'bestiary' && <BestiaryView {...props} onBack={() => setPage('journal')} />}
          {service && <div className="page service-page"><div className="page-heading">
            <div><span className="eyebrow">{game.locationName}</span><h1>{page === 'shop' ? game.shop.name : page === 'market' ? '商盟寄售' : '璇玑阁'}</h1></div>
            <IconButton label="返回当地" onClick={() => setPage('world')}><ArrowLeft size={18} /></IconButton></div>
            {page === 'shop' && <ShopView {...props} />}
            {page === 'market' && merchant?.success && <ConsignmentPanel game={game} shopId={merchant.data} blocked={session.blocked} pending={session.tradePending}
              busy={session.tradeBusy} stopped={session.tradeStopped} message={session.tradeMessage} load={session.loadConsignment} submit={session.submitTrade} />}
            {page === 'rankings' && game.rankingsAvailable && <RankingsPanel load={session.loadRanking} lastCloudSave={session.lastCloudSave} />}
          </div>}
        </main> : <main className="connecting-screen"><Mountain size={45} strokeWidth={1.1} /><h1>{session.issue ? '尚未入境' : '正在读取角色'}</h1>
          {!session.issue && <LoaderCircle size={20} className="spinning" />}
          {import.meta.env.DEV && <a className="button" href="/?preview=ui"><Compass size={16} />界面预览</a>}</main>}
      </div>
      {game && <LogPanel key={`log:${session.response!.characterId}:${game.life.number}`} game={game} settings={logSettings}
        toggleGroup={group => setLogSettings(current => ({ ...current, groups: current.groups.includes(group)
          ? current.groups.filter(id => id !== group) : [...current.groups, group] }))} />}
      <footer className="statusbar"><span><i className={session.blocked ? 'status-warning' : ''} />{previewControls ? '预览环境 · 不写角色存档'
        : session.blocked ? '进度已暂停' : session.busy ? '正在保存' : '本地存档已就绪'}</span>
        <span>{game ? `${game.locationName} · ${activityName(game)}` : ''}</span>
        <span>{previewControls ? '内存角色' : session.lastCloudSave ? `云备份 ${new Date(session.lastCloudSave).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '尚无本次云备份记录'}</span></footer>
    </div>
    {overlay === 'reincarnation' && <ReincarnationDialog session={session} onClose={() => setOverlay(null)} />}
    {overlay === 'saves' && <SaveRecoveryDialog session={session} onClose={() => setOverlay(null)} />}
    {overlay === 'policies' && <Dialog title="隐私与条款" onClose={() => setOverlay(null)}>
      <p>榜单、寄售、同地道友和世界频道会向同一应用的已登录玩家显示你的 Discord 名字和头像。</p>
      <p>同地道友可见境界与简要活动，并按需查看常态属性、战力、当前配装和运转能力；世界消息保留7天。不公开完整存档或私人行囊。</p>
      <PolicyLinks />
    </Dialog>}
    {overlay === 'debug' && game && DebugConsole && <Dialog title="测试控制台" wide onClose={() => setOverlay(null)}>
      <Suspense fallback={<p>正在读取</p>}><DebugConsole game={game} blocked={session.blocked} command={session.debugCommand} preview={Boolean(previewControls)} /></Suspense></Dialog>}
  </>;
}
