import { z } from 'zod';

export const discordIdSchema = z.string().regex(/^\d{17,20}$/);
export const discordUserSchema = z.object({
  id: discordIdSchema,
  username: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128),
  avatar: z.string().regex(/^(a_)?[a-f0-9]{32}$/).nullable(),
}).strict();
export type DiscordUser = z.infer<typeof discordUserSchema>;

export const discordConfigSchema = z.object({ clientId: discordIdSchema }).strict();
export const discordLoginSchema = z.object({
  code: z.string().min(1).max(2048),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
}).strict();
export const discordSessionSchema = z.object({
  clientId: discordIdSchema,
  user: discordUserSchema,
  characterId: z.uuid(),
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.number().int().positive(),
  accessToken: z.string().min(1).max(4096),
}).strict();
export type DiscordSession = z.infer<typeof discordSessionSchema>;

export function discordSaveKey(clientId: string, userId: string): string {
  return `moli.discord-save.v1:${discordIdSchema.parse(clientId)}:${discordIdSchema.parse(userId)}`;
}
