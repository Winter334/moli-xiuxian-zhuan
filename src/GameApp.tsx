import { GameShell } from './ui/GameShell';
import { useGame } from './use-game';
import type { GameClient } from './game-client';

export default function GameApp({ client, mobileActivity = false }: { client?: GameClient; mobileActivity?: boolean }) {
  return <GameShell session={useGame(client)} mobileActivity={mobileActivity} />;
}
