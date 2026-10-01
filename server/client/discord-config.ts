import { discordIdSchema } from '../../shared/discord';

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
}

export function readClientAuthMode(): 'local' | 'discord' {
  const mode = process.env.CLIENT_AUTH_MODE ?? 'local';
  if (mode !== 'local' && mode !== 'discord') throw new Error('CLIENT_AUTH_MODE must be local or discord.');
  return mode;
}

export function readDiscordConfig(): DiscordConfig {
  const clientId = discordIdSchema.safeParse(process.env.DISCORD_CLIENT_ID);
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  if (!clientId.success || !clientSecret) {
    throw new Error('Configure DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env before starting the Activity.');
  }
  return { clientId: clientId.data, clientSecret };
}
