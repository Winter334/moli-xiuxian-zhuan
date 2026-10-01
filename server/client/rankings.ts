import { dec } from '../../core/numbers';
import { combatPower, COMBAT_POWER_VERSION } from '../../core/prototype/combat-power';
import { realmName } from '../../core/prototype/growth';
import type { CharacterState } from '../../core/prototype/character-state';
import { readClientSave } from '../../shared/client-save';
import { RANKING_LIMIT, type RankingBoard, type RankingEntry, type RankingId, type RankingMetric } from '../../shared/rankings';
import type { RankingStore } from './repository';

function metricFor(state: CharacterState, board: RankingId): RankingMetric {
  switch (board) {
    case 'cultivation': return { kind: board, level: state.level, xp: state.cultivation };
    case 'power': return { kind: board, score: combatPower(state) };
    case 'refining': return { kind: board, ...state.skills.refining };
    case 'money': return { kind: board, amount: state.money };
  }
}

function compareMetrics(a: RankingMetric, b: RankingMetric): number {
  if (a.kind === 'cultivation' && b.kind === 'cultivation' || a.kind === 'refining' && b.kind === 'refining') {
    return b.level - a.level || dec(b.xp).comparedTo(a.xp);
  }
  if (a.kind === 'power' && b.kind === 'power') return dec(b.score).comparedTo(a.score);
  if (a.kind === 'money' && b.kind === 'money') return dec(b.amount).comparedTo(a.amount);
  throw new Error('Cannot compare different ranking metrics');
}

export class RankingsService {
  constructor(private readonly store: RankingStore) {}

  async getBoard(characterId: string, board: RankingId): Promise<RankingBoard> {
    const rows: { id: string; entry: Omit<RankingEntry, 'rank'> }[] = [];
    for await (const snapshot of this.store.rankingSnapshots()) {
      let state: CharacterState;
      try { state = readClientSave(snapshot.save).character; }
      catch { continue; } // Old or invalid saves are neither converted nor admitted.
      if (this.store.scope.kind === 'discord' && state.history.testAssisted) continue;
      rows.push({
        id: snapshot.characterId,
        entry: {
          ...snapshot.profile, realmName: realmName(state.level),
          metric: metricFor(state, board), updatedAt: snapshot.receivedAt, isSelf: snapshot.characterId === characterId,
        },
      });
    }
    rows.sort((a, b) => compareMetrics(a.entry.metric, b.entry.metric) || a.id.localeCompare(b.id));
    const entries: RankingEntry[] = [];
    let self: RankingEntry | null = null;
    let rank = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (index === 0 || compareMetrics(row.entry.metric, rows[index - 1].entry.metric) !== 0) rank = index + 1;
      const entry = { ...row.entry, rank };
      if (index < RANKING_LIMIT) entries.push(entry);
      if (entry.isSelf) self = entry;
    }
    return { board, scope: this.store.scope.kind, powerVersion: COMBAT_POWER_VERSION, entries, self };
  }
}
