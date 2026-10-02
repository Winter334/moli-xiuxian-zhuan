import type { GameClient } from './game-client';
import type { SnapshotInteractionId } from '../shared/social';

export function playerInteractionProviders(game: GameClient): Record<SnapshotInteractionId, () => unknown> {
  return { 'view-profile': game.getPublicCharacter };
}
