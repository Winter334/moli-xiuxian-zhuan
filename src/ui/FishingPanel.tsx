import { useLayoutEffect, useRef, useState } from 'react';
import { CirclePause, Fish, Hand } from 'lucide-react';
import { advanceFishing } from '../../core/prototype/lake-activities';
import { MAX_FRAME_GAP_MS } from '../../shared/client-save';
import type { CombatFrame } from '../combat-presentation';
import { Meter } from './common';
import type { ViewProps } from './types';

export function FishingPanel({ game, blocked, command, frame, paused }: ViewProps & { frame: CombatFrame; paused: boolean }) {
  const fishing = game.fishing!;
  const level = game.skills.find(skill => skill.id === 'fishing')!.level;
  const [motion, setMotion] = useState(fishing.fish);
  const held = useRef(fishing.held);
  const fish = fishing.fish ? motion ?? fishing.fish : null;
  useLayoutEffect(() => {
    setMotion(fishing.fish);
    if (!fishing.fish || paused || frame.paused) return;
    const activity = { ...fishing, fish: { ...fishing.fish } };
    const rng = { rng: fishing.rng };
    const hooks = { level: () => level, experience: () => {}, caught: () => {} };
    let previous = frame.receivedAt;
    let animation = 0;
    const animate = (now: number) => {
      const elapsed = Math.max(0, Math.floor(now - previous));
      // Project only the current fish. Rewards and the next fish require a saved checkpoint.
      if (elapsed > MAX_FRAME_GAP_MS || now - frame.receivedAt > MAX_FRAME_GAP_MS) return;
      previous += elapsed;
      const currentFish = activity.fish!;
      let remaining = elapsed;
      while (remaining > 0 && activity.phase === 'tackle') {
        const step = Math.min(remaining, 30 - activity.remainderMs);
        advanceFishing(activity, step, rng, hooks);
        remaining -= step;
      }
      setMotion({ ...currentFish, progress: Math.max(0, Math.min(100, currentFish.progress)) });
      if (activity.fish) animation = requestAnimationFrame(animate);
    };
    animation = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animation);
  }, [fishing, level, frame.receivedAt, frame.paused, paused]);
  const setHeld = (next: boolean) => {
    if (held.current === next || next && blocked) return;
    held.current = next;
    void command({ type: 'fishing-input', held: next });
  };
  return <div className="fishing-panel">
    <div className="fishing-heading"><h3>湖岸垂钓</h3>
      <button disabled={blocked} onClick={() => void command({ type: 'fish', active: false })}>
        <CirclePause size={15} />收竿</button></div>
    {fish ? <div className="fishing-game">
      <div className="fishing-track" aria-label="垂钓水域">
        <div className="fishing-rod" style={{ transform: `translate3d(0, -${fish.rodPosition / fish.rodLength * 100}%, 0)`, height: `${fish.rodLength / 318 * 100}%` }} />
        <Fish className="fishing-fish" size={22} style={{ transform: `translate3d(0, calc(var(--fishing-track-height) * -${Math.max(0, Math.min(290, fish.position)) / 318}), 0)` }} />
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
          onLostPointerCapture={() => setHeld(false)}
          onKeyDown={event => { if (!blocked && !event.repeat && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); setHeld(true); } }}
          onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setHeld(false); } }}
          onBlur={() => setHeld(false)}><Hand size={32} /><span>提竿</span></button>
      </div>
    </div> : <div className="fishing-wait"><Fish size={28} />
      <Meter label="候鱼（秒）" value={String(fishing.elapsedMs / 1000)} max={String(fishing.periodMs / 1000)} compact /></div>}
  </div>;
}
