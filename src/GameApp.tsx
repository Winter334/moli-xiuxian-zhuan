import { GameShell } from './ui/GameShell';
import { useGame } from './use-game';
import type { GameClient } from './game-client';

export default function GameApp({ client }: { client?: GameClient }) {
  return <GameShell session={useGame(client)} />;
}
