import { ArrowLeft } from 'lucide-react';
import { CombatStage } from './CombatStage';
import type { GameSession } from './types';

export function PvpCombatView({ session }: { session: GameSession }) {
  const combat = session.pvpCombat!, game = session.response!.game;
  const fighting = !combat.outcome && Boolean(combat.state.attacker.battle);
  return <div className="page location-view pvp-combat-view">
    <div className="page-heading"><div><span className="eyebrow">{game.locationName}</span><h1>修士交锋</h1></div></div>
    <section className="activity-view" aria-label="PVP战斗">
      <div className="battle-heading"><div><span className="eyebrow">{fighting ? '正在袭击' : '结算中'}</span>
        <h2 title={combat.battle.defender.name}>{combat.battle.defender.name}</h2></div>
        <button className="danger subtle" disabled={!fighting || session.pvpBusy}
          onClick={() => void session.withdrawPvp()}><ArrowLeft size={16} />撤退</button>
      </div>
      <CombatStage game={game} frame={combat.frame} paused={combat.paused} duel={combat} />
    </section>
  </div>;
}
