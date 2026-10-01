import { createContext, useContext, useState, type CSSProperties } from 'react';
import { UserRound } from 'lucide-react';
import type { DiscordUser } from '../shared/discord';
import { playerAvatarUrlSchema } from '../shared/player-profile';

export const DiscordIdentity = createContext<DiscordUser | null>(null);
export const useDiscordIdentity = () => useContext(DiscordIdentity);

export function DiscordAvatar({ size = 112 }: { size?: number }) {
  const user = useDiscordIdentity();
  const url = user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : null;
  return <PlayerAvatar url={url} size={size} />;
}

export function PlayerAvatar({ url, size = 32 }: { url: string | null; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const validUrl = playerAvatarUrlSchema.safeParse(url).success ? url : null;
  return <span className="discord-avatar" style={{ '--avatar-size': `${size}px` } as CSSProperties}>
    {validUrl && validUrl !== failedUrl
      ? <img src={validUrl} width={size} height={size} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(validUrl)} />
      : <UserRound size={Math.round(size * .55)} strokeWidth={1.2} />}
  </span>;
}
