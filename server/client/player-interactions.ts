import type { NearbyPlayer, PlayerInteractionId, PublicCharacter } from '../../shared/social';

export interface InteractionContext {
  target: NearbyPlayer;
  requestTarget: (action: PlayerInteractionId) => Promise<{ data: unknown; capturedAt: number }>;
}
export const playerInteractionHandlers: Record<PlayerInteractionId, (context: InteractionContext) => Promise<unknown>> = {
  'view-profile': async context => {
    const snapshot = await context.requestTarget('view-profile');
    return { player: context.target, character: snapshot.data as PublicCharacter, capturedAt: snapshot.capturedAt };
  },
};
