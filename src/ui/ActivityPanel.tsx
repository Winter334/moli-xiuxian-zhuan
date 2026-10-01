import { ArrowLeft, CirclePause, Heart, Pickaxe, Wind } from 'lucide-react';
import type { OpeningView } from '../../shared/opening-contracts';
import { formatAmount } from '../format';
import { Meter } from './common';
import { CombatStage } from './CombatStage';
import type { CombatFrame } from '../combat-presentation';
import type { ViewProps } from './types';

export function activityName(game: OpeningView) {
  return game.gathering ? '采矿中' : game.training ? '训练中' : game.battle ? '探索中' : game.mode === 'sleep' ? '调息中' : game.mode === 'idle' ? '停留中' : '歇息中';
}
export function ActivityView({ game, blocked, command, frame, paused }: ViewProps & { frame: CombatFrame; paused: boolean }) {
  const region = game.regions.find(entry => entry.id === game.locationId);
  const activity = activityName(game);
  return <section className="activity-view" aria-label="当前活动">
      {game.battle ? <>
        <div className="battle-heading"><div><span className="eyebrow">正在探索</span><h2>第 {region ? `${BigInt(region.clearedGroups) % BigInt(region.groupsPerClear) + 1n} / ${region.groupsPerClear}` : ''} 组敌人</h2></div>
          <button className="danger subtle" disabled={blocked} onClick={() => void command({ type: 'withdraw' })}><ArrowLeft size={16} />撤退</button></div>
        {game.battle.manorSealActive && <p className="positive">山院旧阵 · 敌方属性降至1%</p>}
        <CombatStage game={game} frame={frame} paused={paused} />
      </> : (game.mode === 'sleep' || game.gathering || game.training) && <div className="ongoing-activity">
        {game.gathering ? <Pickaxe size={30} /> : game.mode === 'sleep' ? <Wind size={30} /> : <Heart size={30} />}
        <div><h3>{game.gathering?.name ?? game.training?.name ?? activity}</h3>
        {game.gathering ? <Meter label="开采进度" value={String(game.gathering.elapsed)} max={String(game.gathering.cycleSeconds)} compact />
          : <p className="muted small">气血 {formatAmount(game.hp)} / {formatAmount(game.stats.maxHp)}</p>}</div>
        <button disabled={blocked} onClick={() => void command({ type: 'recover', mode: 'rest' })}><CirclePause size={15} />结束活动</button>
      </div>}
  </section>;
}
