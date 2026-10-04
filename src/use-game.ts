import { useEffect, useSyncExternalStore } from 'react';
import { GameClient } from './game-client';

const client = new GameClient();

export function useGame(gameClient = client) {
  const state = useSyncExternalStore(gameClient.subscribe, gameClient.getSnapshot);
  useEffect(gameClient.start, [gameClient]);
  return {
    ...state,
    combatPaused: state.blocked || state.reincarnationBusy || state.recoveryBusy || state.pvpPending || state.pvpBusy,
    command: gameClient.command,
    debugCommand: gameClient.debugCommand,
    refreshDebugAccess: gameClient.refreshDebugAccess,
    loadRanking: gameClient.loadRanking,
    loadConsignment: gameClient.loadConsignment,
    submitTrade: gameClient.submitTrade,
    reconcileTrade: () => gameClient.reconcileTrade(true),
    submitReincarnation: gameClient.submitReincarnation,
    reconcileReincarnation: () => gameClient.reconcileReincarnation(true),
    inspectSaves: gameClient.inspectSaves,
    chooseSave: gameClient.chooseSave,
    setPvpMode: gameClient.setPvpMode,
    reconcilePvp: gameClient.reconcilePvp,
    withdrawPvp: gameClient.withdrawPvp,
    retry: gameClient.retry,
    refresh: gameClient.refresh,
    dismissIssue: gameClient.dismissIssue,
    blocked: state.busy || state.blocked || state.reincarnationBusy || state.recoveryBusy || state.pvpPending || state.pvpBusy,
  };
}
