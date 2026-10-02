import { useEffect, useState, type ComponentType } from 'react';
import { Eye, LoaderCircle, RefreshCw, Swords, Users } from 'lucide-react';
import { PLAYER_INTERACTIONS, profileResultSchema, type NearbyPlayer, type PlayerInteractionId, type PublicPlayerInfo } from '../../shared/social';
import type { SocialClient, SocialState } from '../social-client';
import { PlayerAvatar } from '../discord-identity';
import { formatAmount, formatDecimal, percent } from '../format';
import { Bonuses, Dialog, IconButton, ItemGlyph, STAT_NAMES } from './common';
import { SLOT_NAMES } from './types';

const activityNames: Record<NearbyPlayer['activity'], string> = {
  idle: '停留', rest: '歇息', meditation: '调息', combat: '探索', training: '训练', gathering: '采集',
};
interface InteractionProps { client: SocialClient; target: NearbyPlayer; onClose: () => void }
function ProfileDialog({ client, target, onClose }: InteractionProps) {
  const [data, setData] = useState<PublicPlayerInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void client.interact('view-profile', target.playerId, attempt > 0).then(result => {
      if (!cancelled) setData(profileResultSchema.parse(result));
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : '资料读取失败。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, target.playerId, attempt]);
  const player = data?.player ?? target;
  const formatStat = (key: string, value: string) => ['critChance', 'hpRegenPercent'].includes(key) ? percent(Number(value))
    : ['critMultiplier', 'attackMultiplier'].includes(key) ? `×${formatAmount(value)}` : formatAmount(value);
  return <Dialog title="道友信息" onClose={onClose} wide footer={<div className="dialog-actions">
    <span className="muted small">{data ? `${new Date(data.capturedAt).toLocaleTimeString('zh-CN')} · 常态快照` : ''}</span>
    <IconButton label="刷新道友信息" disabled={loading} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={17} /></IconButton>
  </div>}>
    <div className="public-player-heading"><PlayerAvatar url={player.avatarUrl} size={56} />
      <div><h3>{player.name}</h3><span className="muted">{player.realmName}</span></div>
      {data && <span className="public-power">常态战力<strong>{formatAmount(data.character.score)}</strong></span>}</div>
    {loading && <p className="empty-line"><LoaderCircle size={17} className="spinning" />正在读取资料</p>}
    {error && <p role="alert" className="negative">{error}</p>}
    {data && <>
      <h3 className="detail-label">常态属性</h3><dl className="public-stats">
        {Object.entries(data.character.stats).map(([key, value]) => <div key={key}><dt>{STAT_NAMES[key] ?? key}</dt><dd title={formatDecimal(value)}>{formatStat(key, value)}</dd></div>)}
      </dl>
      <h3 className="detail-label">当前配装</h3>
      {data.character.equipment.length ? <div className="public-equipment">{data.character.equipment.map(item =>
        <section key={item.slot}><ItemGlyph itemId={item.itemId} slot={item.slot} size={40} />
          <div><span className="eyebrow">{SLOT_NAMES[item.slot]} · 品质{item.quality}</span><h3>{item.name}</h3><Bonuses source={item.bonuses} /></div></section>)}</div>
        : <p className="muted">未穿戴器物</p>}
      <h3 className="detail-label">正在运转</h3>
      {data.character.abilities.length ? data.character.abilities.map(entry => <section className="source-detail" key={entry.id}>
        <h3>{entry.name}{entry.level !== null && <small> · {entry.level}级</small>}</h3><Bonuses source={entry.bonuses} />
      </section>) : <p className="muted">未运转功法或神通</p>}
    </>}
  </Dialog>;
}
function AttackDialog({ client, target, onClose }: InteractionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const issue = client.attackIssue(target);
  return <Dialog title={`袭击${target.name}`} onClose={onClose} footer={<div className="dialog-actions">
    <span className="negative small">{error || issue}</span>
    <button className="danger" disabled={busy || Boolean(issue)} onClick={() => {
      setBusy(true); setError('');
      void client.attack(target).then(() => onClose()).catch(error => {
        setError(error instanceof Error ? error.message : '袭击未完成。'); setBusy(false);
      });
    }}>{busy ? <LoaderCircle size={16} className="spinning" /> : <Swords size={16} />}确认袭击</button>
  </div>}>
    <div className={`public-player-heading${target.pvp.red ? ' pvp-red-name' : ''}`}>
      <PlayerAvatar url={target.avatarUrl} size={56} /><div><h3>{target.name}</h3><span>{target.realmName}</span></div>
    </div>
    <p>{target.pvp.red ? '红名败者随机失去一件穿戴器物，由胜者获得。' : '主动袭击获胜会积累恶名；败者气血归零并退回安全点。'}</p>
  </Dialog>;
}
const interactionViews: Record<PlayerInteractionId, { icon: typeof Eye; dialog: ComponentType<InteractionProps> }> = {
  'view-profile': { icon: Eye, dialog: ProfileDialog },
  attack: { icon: Swords, dialog: AttackDialog },
};
export function NearbyPlayers({ state, client, heading = true }: { state: SocialState; client?: SocialClient; heading?: boolean }) {
  const [selected, setSelected] = useState<{ action: PlayerInteractionId; target: NearbyPlayer } | null>(null);
  const [, refreshTime] = useState(0);
  useEffect(() => {
    if (state.status !== 'online') return;
    const timer = setInterval(() => refreshTime(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state.status]);
  const View = selected ? interactionViews[selected.action].dialog : null;
  return <section className="nearby-players" aria-label="同地道友">
    <div className="section-line">{heading ? <h2><Users size={17} />同地道友 <small>{state.nearby.length}</small></h2>
      : <span className="muted small">{state.status === 'online' ? `${state.nearby.length} 位道友` : '同地名单'}</span>}
      <span className="muted small">{state.status === 'connecting' ? '连接中' : state.status === 'online' ? '' : state.status === 'displaced' ? '另一设备已接入' : '未连接'}</span></div>
    {state.nearby.length ? <ul>{state.nearby.map(player => <li key={player.playerId}>
      <PlayerAvatar url={player.avatarUrl} /><div className={`nearby-who${player.pvp.red ? ' pvp-red-name' : ''}`}><strong>{player.name}</strong>
        <span>{player.realmName} · {activityNames[player.activity]}{player.pvp.enabled ? player.pvp.red ? ' · 红名' : ' · PVP' : ''}</span>
        {player.pvp.busy && <span>袭击核对中</span>}
        {player.pvp.protectedUntil > Date.now() && <span>败退保护 {Math.ceil((player.pvp.protectedUntil - Date.now()) / 1000)}秒</span>}</div>
      {PLAYER_INTERACTIONS.filter(action => player.interactions.includes(action.id)).map(action => {
        const Icon = interactionViews[action.id].icon;
        const issue = action.transport === 'pvp' ? client?.attackIssue(player) : null;
        return <IconButton key={action.id} label={`${action.label}：${player.name}${issue ? ` · ${issue}` : ''}`}
          disabled={!client || state.status !== 'online' || Boolean(issue)}
          onClick={() => setSelected({ action: action.id, target: player })}><Icon size={17} /></IconButton>;
      })}
    </li>)}</ul> : <p className="muted small">{state.status === 'online' ? '此地暂无其他在线道友' : '同地道友暂不可用'}</p>}
    {selected && View && client && <View client={client} target={selected.target} onClose={() => setSelected(null)} />}
  </section>;
}
