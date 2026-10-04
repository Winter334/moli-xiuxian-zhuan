import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Shield, Swords, Zap } from 'lucide-react';
import { ENEMIES, FOOD_EFFECTS, enemyRealmName } from '../../core/prototype/content';
import { attackIntervalMs } from '../../core/prototype/stats';
import { getPlayerStats, type PlayerDuelState } from '../../core/prototype/simulation';
import type { PvpBattleInfo } from '../../shared/pvp';
import type { OpeningView } from '../../shared/opening-contracts';
import type { CombatFrame } from '../combat-presentation';
import { formatAmount } from '../format';
import { CombatAvatar, SCENE_ART } from './art';
import { Meter } from './common';
import { enemyAbilityDetails } from './enemy-details';
import { DiscordAvatar, PlayerAvatar, useDiscordIdentity } from '../discord-identity';

function usePresentationStatus(frame: CombatFrame, paused: boolean) {
  const [waiting, setWaiting] = useState<number | null>(null);
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    const visibility = () => setWaiting(frame.sequence);
    const timer = window.setTimeout(() => setExpired(frame.sequence),
      Math.max(0, frame.receivedAt + 850 - performance.now()));
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [frame.sequence, frame.receivedAt]);
  const frozen = paused || frame.paused || document.hidden || waiting === frame.sequence;
  return { frozen, fresh: !frozen && expired !== frame.sequence && performance.now() - frame.receivedAt < 850 };
}

function CardCharge({ deadline, actionAt, speed, frame, frozen, defeated, name }: {
  deadline: number | null; actionAt: number | null; speed: string;
  frame: CombatFrame; frozen: boolean; defeated: boolean; name: string;
}) {
  const meter = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);
  const cycle = useRef<{ animation: Animation; interval: number; actionAt: number | null } | null>(null);
  const interval = attackIntervalMs(speed);
  useLayoutEffect(() => {
    if (!fill.current) return;
    if (defeated || deadline === null) {
      cycle.current?.animation.cancel();
      cycle.current = null;
      meter.current?.setAttribute('aria-valuenow', '0');
      return;
    }
    const previous = cycle.current;
    const newAction = actionAt !== null && (previous?.actionAt === null || !previous || actionAt > previous.actionAt);
    // A confirmed action starts a visual cycle; periodic snapshots never seek into it.
    if (!previous || (!frozen && newAction)) {
      previous?.animation.cancel();
      const animation = fill.current.animate([
        { transform: 'scaleX(0)' }, { transform: 'scaleX(1)' },
      ], { duration: interval, easing: 'linear', fill: 'forwards' });
      animation.pause();
      animation.currentTime = 0;
      animation.onfinish = () => meter.current?.setAttribute('aria-valuenow', '100');
      cycle.current = { animation, interval, actionAt };
    } else {
      if (previous.interval !== interval) {
        const progress = Math.min(1, Number(previous.animation.currentTime ?? 0) / previous.interval);
        previous.animation.effect?.updateTiming({ duration: interval });
        previous.animation.currentTime = progress * interval;
        previous.interval = interval;
      }
      if (newAction) previous.actionAt = actionAt;
    }
    const { animation } = cycle.current!;
    const updateMeter = () => meter.current?.setAttribute('aria-valuenow',
      String(Math.round(Math.min(1, Number(animation.currentTime ?? 0) / interval) * 100)));
    updateMeter();
    const remaining = Math.max(0, frame.receivedAt + 1000 - performance.now());
    if (frozen || remaining === 0) {
      animation.pause();
      return;
    }
    if (Number(animation.currentTime ?? 0) < interval) animation.play();
    const timer = window.setTimeout(() => { animation.pause(); updateMeter(); }, remaining);
    return () => window.clearTimeout(timer);
  }, [deadline, actionAt, interval, frame.receivedAt, frozen, defeated]);
  useLayoutEffect(() => () => {
    cycle.current?.animation.cancel();
    cycle.current = null;
  }, []);
  return <div ref={meter} className="card-charge" role="progressbar" aria-label={`${name}出手进度`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
    <i ref={fill} />
  </div>;
}

export function CombatStage({ game, frame, paused, duel }: {
  game: OpeningView; frame: CombatFrame; paused: boolean; duel?: { battle: PvpBattleInfo; state: PlayerDuelState };
}) {
  const identity = useDiscordIdentity();
  const battle = duel ? {
    regionId: `pvp:${duel.battle.battleId}`, nextPlayerActionAt: duel.state.attacker.player.nextActionAt,
    enemies: [{ id: 'pvp-player', name: duel.battle.defender.name, hp: duel.state.defender.player.hp,
      stats: getPlayerStats(duel.state.defender), nextActionAt: duel.state.defender.player.nextActionAt,
      nextRound: undefined, abilities: null }],
  } : game.battle!;
  const region = duel ? null : game.regions.find(entry => entry.id === battle.regionId)!;
  const group = region?.clearedGroups ?? '0';
  const playerStats = duel ? getPlayerStats(duel.state.attacker) : game.stats;
  const playerHp = duel ? duel.state.attacker.player.hp : game.hp;
  const playerName = duel?.battle.attacker.name ?? identity?.displayName ?? '散修';
  const effects = duel ? duel.state.attacker.effects.map(effect => ({ id: effect.id, name: FOOD_EFFECTS[effect.id]?.name ?? effect.id })) : game.effects;
  const { frozen, fresh } = usePresentationStatus(frame, paused);
  const groupKey = `${game.life.number}:${battle.regionId}:${group}`;
  const events = frame.events.flatMap(({ life, regionId, group, event }) =>
    life === game.life.number && regionId === battle.regionId && group === (region?.clearedGroups ?? '0') &&
    (event.kind === 'strike' || event.kind === 'miss-punishment' || event.kind === 'reflection' ||
      event.kind === 'tidal-pressure' || event.kind === 'health-burst' || event.kind === 'pre-attack-damage') ? [event] : []);
  const strikes = fresh ? events : [];
  const lastAction = (slot: number | 'player') => events.reduce<number | null>((latest, event) =>
    event.kind === 'strike' && (slot === 'player' ? event.side === 'player' : event.side === 'enemy' && event.slot === slot)
      ? Math.max(latest ?? event.at, event.at) : latest, null);
  const feedback = (slot: number | 'player') => {
    const incoming = strikes.filter(event => slot === 'player' ? event.kind !== 'strike' || event.side === 'enemy'
      : event.kind === 'strike' && event.side === 'player' && event.slot === slot);
    return <div className="hit-feedback" key={`${frame.sequence}:${slot}`} aria-hidden="true">
      {incoming.slice(-3).map((event, i) => <span key={i} className={event.kind === 'strike' && event.critical ? 'critical' : ''}>
        {event.kind === 'strike' && !event.hit ? '闪避' : `${event.kind === 'miss-punishment' ? '截隙 '
          : event.kind === 'reflection' ? '反震 ' : event.kind === 'tidal-pressure' ? '潮压 '
            : event.kind === 'health-burst' ? '囊爆 ' : event.kind === 'pre-attack-damage' ? '贯光 '
              : event.kind === 'strike' && event.critical ? '暴击 ' : ''}-${formatAmount(event.hpLost)}`}
      </span>)}
    </div>;
  };
  const attacks = (slot: number | 'player') => strikes.some(event => event.kind === 'strike' &&
    (slot === 'player' ? event.side === 'player' : event.side === 'enemy' && event.slot === slot));
  const statLine = (stats: OpeningView['stats']) => <div className="combat-stats">
    <span title="攻击"><Swords size={13} />{formatAmount(stats.attack)}</span>
    <span title="防御"><Shield size={13} />{formatAmount(stats.defense)}</span>
    <span title="敏捷"><Zap size={13} />{formatAmount(stats.agility)}</span>
  </div>;
  return <div className={`combat-stage${duel ? ' pvp-stage' : ''}${battle.enemies.length > 2 ? ' multi-enemy' : ''}`} style={SCENE_ART[game.locationId] ? { backgroundImage: `url("${SCENE_ART[game.locationId]}")` } : undefined}>
    <div className="combat-side player-side"><span className="combat-side-label">我方</span>
      <article className={`combatant player-combatant${duel && Number(playerHp) <= 0 ? ' defeated' : ''}`} aria-label="我方战斗状态">
        <CardCharge key={groupKey} deadline={battle.nextPlayerActionAt} actionAt={lastAction('player')}
          speed={playerStats.attackSpeed} frame={frame} frozen={frozen} defeated={Number(playerHp) <= 0} name={playerName} />
        <header><span className="eyebrow">{duel?.battle.attacker.realmName || game.realmName}</span><h3 title={playerName}>{playerName}</h3></header>
        <div className="combat-portrait">
          <div key={attacks('player') ? frame.sequence : 'idle'} className={attacks('player') ? 'attack-motion' : ''}>
            {duel ? <PlayerAvatar url={duel.battle.attacker.avatarUrl} size={96} />
              : identity ? <DiscordAvatar size={96} /> : <CombatAvatar name="散修" />}</div>
          {duel && feedback('player')}
        </div>
        <Meter label="气血" value={playerHp} max={playerStats.maxHp} tone="red" />
        {statLine(playerStats)}
        {effects.length > 0 && <div className="combat-tags">{effects.map(effect => <span key={effect.id}>{effect.name}</span>)}</div>}
        {!duel && feedback('player')}
      </article>
    </div>
    <div className="combat-divider" aria-hidden="true"><Swords size={22} strokeWidth={1.3} /></div>
    <div className="combat-side enemy-side"><span className="combat-side-label">敌方</span>
      {battle.enemies.map((entry, index) => {
        const abilities = entry.abilities ? enemyAbilityDetails(entry.abilities) : [];
        return <article className={`combatant enemy-combatant ${Number(entry.hp) <= 0 ? 'defeated' : ''}`}
          key={`${groupKey}:${entry.id}:${index}`} aria-label={`${entry.name}战斗状态`}>
          <CardCharge deadline={entry.nextActionAt} actionAt={lastAction(index)} speed={entry.stats.attackSpeed}
            frame={frame} frozen={frozen} defeated={Number(entry.hp) <= 0} name={entry.name} />
          <header><span className="eyebrow">{battle.enemies.length > 2 ? `${index + 1} · ` : ''}{duel ? duel.battle.defender.realmName : enemyRealmName(ENEMIES[entry.id])} · {Number(entry.hp) <= 0 ? '已击败' : duel ? '防卫' : `第${entry.nextRound ?? 1}轮`}</span><h3 title={entry.name}>{entry.name}</h3></header>
          <div className="combat-portrait">
            <div key={attacks(index) ? frame.sequence : 'idle'} className={attacks(index) ? 'attack-motion' : ''}>
              {duel ? <PlayerAvatar url={duel.battle.defender.avatarUrl} size={96} /> : <CombatAvatar enemyId={entry.id} name={entry.name} />}</div>
            {duel && feedback(index)}
          </div>
          <Meter label="气血" value={entry.hp} max={entry.stats.maxHp} tone="red" />
          {statLine(entry.stats)}
          {abilities.length > 0 && <div className="combat-tags enemy-abilities" aria-label="特殊能力">
            {abilities.map(ability => <span key={ability.name} title={ability.description}>{ability.name}</span>)}
          </div>}
          {duel && duel.state.defender.effects.length > 0 && <div className="combat-tags">
            {duel.state.defender.effects.map(effect => <span key={effect.id}>{FOOD_EFFECTS[effect.id]?.name ?? effect.id}</span>)}
          </div>}
          {!duel && feedback(index)}
        </article>;
      })}
    </div>
  </div>;
}
