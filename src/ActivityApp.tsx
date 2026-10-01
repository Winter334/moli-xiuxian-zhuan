import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mountain, RefreshCw, RotateCw } from 'lucide-react';
import { discordSaveKey, type DiscordUser } from '../shared/discord';
import { ActivityLoginError, DiscordActivityConnection, isDiscordActivity } from './discord-activity';
import { DiscordIdentity } from './discord-identity';
import { GameClient } from './game-client';
import { acquireLocalSaveLock, LocalSaveStore } from './local-save';
import GameApp from './GameApp';

export default function ActivityApp() {
  const connection = useRef<DiscordActivityConnection | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState('正在连接 Discord');
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<{ client: GameClient; user: DiscordUser } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    connection.current ??= new DiscordActivityConnection();
    void connection.current.login(message => { if (!cancelled) setPhase(message); }).then(session => {
      if (cancelled) return;
      const key = discordSaveKey(session.clientId, session.user.id);
      const client = new GameClient({
        fetcher: connection.current!.fetcher, store: new LocalSaveStore(undefined, key),
        acquireLock: () => acquireLocalSaveLock(key), expectedCharacterId: session.characterId,
      });
      setGame({ client, user: session.user });
    }).catch(error => {
      const code = error && typeof error === 'object' && 'code' in error && Number.isInteger(error.code)
        ? `（错误代码 ${error.code}）` : '';
      if (!cancelled) setError(error instanceof ActivityLoginError ? error.message
        : `Discord 登录未完成${code}，请重试；仍无法连接时可关闭 Activity 后重新打开。`);
    });
    return () => { cancelled = true; };
  }, [attempt]);

  if (game) return <DiscordIdentity.Provider value={game.user}><GameApp client={game.client} /></DiscordIdentity.Provider>;
  const embedded = isDiscordActivity();
  return <>
    <div className="orientation-gate"><RotateCw size={42} strokeWidth={1.2} /><h1>横屏入境</h1><p>请将设备转为横屏</p><span>茉莉修仙传</span></div>
    <main className="activity-login connecting-screen">
      <Mountain size={40} strokeWidth={1.2} /><h1>茉莉修仙传</h1>
      <p role={error ? 'alert' : 'status'}>{error ?? phase}</p>
      {!error && <LoaderCircle size={20} className="spinning" />}
      {error && embedded && <button onClick={() => setAttempt(current => current + 1)}><RefreshCw size={16} />重新登录</button>}
    </main>
  </>;
}
