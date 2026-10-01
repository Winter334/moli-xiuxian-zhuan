import { createHash } from 'node:crypto';
import type { DiscordUser } from '../../shared/discord';
import type { PublicPlayerProfile } from '../../shared/player-profile';

export type PlayerScope = { kind: 'development' } | { kind: 'discord'; applicationId: string };

export function developmentProfile(characterId: string): PublicPlayerProfile {
  return { name: `试修·${createHash('sha256').update(characterId).digest('hex').slice(0, 10)}`, avatarUrl: null };
}

export function discordProfile(user: Pick<DiscordUser, 'id' | 'displayName' | 'avatar'>): PublicPlayerProfile {
  return {
    name: user.displayName,
    avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : null,
  };
}

// SQL identifiers come only from repository code; application IDs remain bound parameters.
export function playerScopeSql(scope: PlayerScope, characterColumn: string, values: unknown[]): string {
  if (scope.kind === 'development') {
    return `EXISTS (SELECT 1 FROM moli_client.dev_sessions d WHERE d.character_id = ${characterColumn})`;
  }
  values.push(scope.applicationId);
  return `EXISTS (
    SELECT 1 FROM moli_client.discord_accounts a
    JOIN moli_client.discord_profiles p USING (application_id, user_id)
    JOIN moli_client.characters scope_character ON scope_character.id = a.character_id
    WHERE a.application_id = $${values.length} AND a.character_id = ${characterColumn}
      AND scope_character.save->'character'->'history'->>'testAssisted' = 'false'
  )`;
}
