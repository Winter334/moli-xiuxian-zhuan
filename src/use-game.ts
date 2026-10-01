import { useEffect, useSyncExternalStore } from 'react';
import { GameClient } from './game-client';

const client = new GameClient();

export function useGame(gameClient = client) {
  const state = useSyncExternalStore(gameClient.subscribe, gameClient.getSnapshot);
  useEffect(gameClient.start, [gameClient]);
  return {
    ...state,
    combatPaused: state.blocked || state.reincarnationBusy,
    command: gameClient.command,
    debugCommand: gameClient.debugCommand,
    loadRanking: gameClient.loadRanking,
    loadConsignment: gameClient.loadConsignment,
    submitTrade: gameClient.submitTrade,
    reconcileTrade: gameClient.reconcileTrade,
    submitReincarnation: gameClient.submitReincarnation,
    reconcileReincarnation: gameClient.reconcileReincarnation,
    retry: gameClient.retry,
    refresh: gameClient.refresh,
    dismissIssue: gameClient.dismissIssue,
    blocked: state.busy || state.blocked || state.reincarnationBusy,
  };
}
