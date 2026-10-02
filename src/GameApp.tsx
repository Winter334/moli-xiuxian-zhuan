import { GameShell } from './ui/GameShell';
import { useGame } from './use-game';
import type { GameClient } from './game-client';
import type { SocialClient } from './social-client';

export default function GameApp({ client, social, mobileActivity = false }: { client?: GameClient; social?: SocialClient; mobileActivity?: boolean }) {
  return <GameShell session={useGame(client)} social={social} mobileActivity={mobileActivity} />;
}
