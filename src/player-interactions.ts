import type { GameClient } from './game-client';
import type { PlayerInteractionId } from '../shared/social';

export function playerInteractionProviders(game: GameClient): Record<PlayerInteractionId, () => unknown> {
  return { 'view-profile': game.getPublicCharacter };
}
