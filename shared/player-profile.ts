import { z } from 'zod';

export const playerNameSchema = z.string().min(1).max(128);
export const playerAvatarUrlSchema = z.string()
  .regex(/^https:\/\/cdn\.discordapp\.com\/avatars\/\d{17,20}\/(?:a_)?[a-f0-9]{32}\.png\?size=256$/).nullable();
export const playerScopeSchema = z.enum(['development', 'discord']);
export interface PublicPlayerProfile {
  name: string;
  avatarUrl: string | null;
}
