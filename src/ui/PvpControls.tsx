import { useEffect, useState } from 'react';
import { LoaderCircle, Swords } from 'lucide-react';
import type { GameSession } from './types';

function useTime() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}
export function PvpModeControl({ session, online }: { session: GameSession; online: boolean }) {
  const now = useTime(), pvp = session.pvp;
  const remaining = Math.max(0, Math.ceil((pvp.modeAfter - now) / 1000));
  return <div className={`pvp-mode${pvp.red ? ' pvp-red-name' : ''}`}>
    <Swords size={16} />
    <label title={pvp.red ? '红名须被修士击败才可关闭PVP' : remaining ? `切换冷却 ${remaining}秒` : '允许同地非安全区袭击与受袭'}>
      <input type="checkbox" role="switch" aria-label="PVP模式" checked={pvp.enabled}
        disabled={!online || session.blocked || session.pvpBusy || session.pvpPending || pvp.busy || remaining > 0 || pvp.red}
        onChange={event => void session.setPvpMode(event.target.checked)} />
      <span>{pvp.red ? '红名' : 'PVP'}</span>
    </label>
    {pvp.notoriety > 0 && <small title="恶名">{pvp.notoriety}</small>}
    {session.pvpBusy && <LoaderCircle size={14} className="spinning" />}
  </div>;
}
