import { createContext, useContext, useState, type CSSProperties } from 'react';
import { UserRound } from 'lucide-react';
import type { DiscordUser } from '../shared/discord';

export const DiscordIdentity = createContext<DiscordUser | null>(null);
export const useDiscordIdentity = () => useContext(DiscordIdentity);

export function DiscordAvatar({ size = 112 }: { size?: number }) {
  const user = useDiscordIdentity();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : null;
  return <span className="discord-avatar" style={{ '--avatar-size': `${size}px` } as CSSProperties}>
    {url && url !== failedUrl
      ? <img src={url} width={size} height={size} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      : <UserRound size={Math.round(size * .55)} strokeWidth={1.2} />}
  </span>;
}
