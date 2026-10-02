import type { NearbyPlayer, SnapshotInteractionId, PublicCharacter } from '../../shared/social';

export interface InteractionContext {
  target: NearbyPlayer;
  requestTarget: (action: SnapshotInteractionId) => Promise<{ data: unknown; capturedAt: number }>;
}
export const playerInteractionHandlers: Record<SnapshotInteractionId, (context: InteractionContext) => Promise<unknown>> = {
  'view-profile': async context => {
    const snapshot = await context.requestTarget('view-profile');
    return { player: context.target, character: snapshot.data as PublicCharacter, capturedAt: snapshot.capturedAt };
  },
};
