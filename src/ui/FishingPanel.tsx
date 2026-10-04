import { CirclePause, Fish, Hand } from 'lucide-react';
import { Meter } from './common';
import type { ViewProps } from './types';

export function FishingPanel({ game, blocked, command }: ViewProps) {
  const fishing = game.fishing!;
  const fish = fishing.fish;
  const setHeld = (held: boolean) => { void command({ type: 'fishing-input', held }); };
  return <div className="fishing-panel">
    <div className="fishing-heading"><h3>湖岸垂钓</h3>
      <button disabled={blocked} onClick={() => void command({ type: 'fish', active: false })}>
        <CirclePause size={15} />收竿</button></div>
    {fish ? <div className="fishing-game">
      <div className="fishing-track" aria-label="垂钓水域">
        <div className="fishing-rod" style={{ bottom: `${fish.rodPosition / 318 * 100}%`, height: `${fish.rodLength / 318 * 100}%` }} />
        <Fish className="fishing-fish" size={22} style={{ bottom: `${Math.max(0, Math.min(290, fish.position)) / 318 * 100}%` }} />
      </div>
      <div className="fishing-action"><Meter label="收鱼进度" value={String(fish.progress)} max="100" compact />
        <button className={`fishing-hold${fishing.held ? ' held' : ''}`} aria-label="提竿" aria-pressed={fishing.held}
          aria-disabled={blocked} onPointerDown={event => {
            if (blocked) return;
            event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setHeld(true);
          }} onPointerUp={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            setHeld(false);
          }} onPointerCancel={() => setHeld(false)}
          onLostPointerCapture={() => { if (fishing.held) setHeld(false); }}
          onKeyDown={event => { if (!blocked && !event.repeat && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); setHeld(true); } }}
          onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setHeld(false); } }}
          onBlur={() => { if (fishing.held) setHeld(false); }}><Hand size={32} /><span>提竿</span></button>
      </div>
    </div> : <div className="fishing-wait"><Fish size={28} />
      <Meter label="候鱼（秒）" value={String(fishing.elapsedMs / 1000)} max={String(fishing.periodMs / 1000)} compact /></div>}
  </div>;
}
