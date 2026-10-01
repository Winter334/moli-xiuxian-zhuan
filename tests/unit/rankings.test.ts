import { describe, expect, it } from 'vitest';
import { createCharacter, synchronizeCharacter } from '../../core/prototype/character-state';
import { combatPower } from '../../core/prototype/combat-power';
import { executeDebugCommand } from '../../core/prototype/debug';
import { FOUNDATION_LEVEL, realmAt } from '../../core/prototype/growth';
import { threshold } from '../../core/prototype/skills';
import type { ClientSave } from '../../shared/client-save';
import { rankingBoardSchema } from '../../shared/rankings';
import type { CloudSnapshot, CloudStore, RankingStore } from '../../server/client/repository';
import { RankingsService } from '../../server/client/rankings';
import { ClientSaveService } from '../../server/client/service';

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const save = (): ClientSave => ({ format: 'opening-client-2', tradeRevision: '0', character: createCharacter(0, 19), playedMs: 0 });
function memory() {
  const rows = new Map<string, CloudSnapshot>();
  const put = (key: string, save: unknown) => rows.set(key, {
    save: structuredClone(save), revision: '0', receivedAt: 0, lastRequestId: null, lastPayloadHash: null,
  });
  const store: CloudStore & RankingStore = {
    async createSession() { throw new Error('unused'); },
    async load(key) { return structuredClone(rows.get(key)!); },
    async commit(key, expected, save, receivedAt, requestId, hash) {
      if (rows.get(key)?.revision !== expected) return false;
      rows.set(key, { save: structuredClone(save), receivedAt, revision: String(BigInt(expected) + 1n),
        lastRequestId: requestId, lastPayloadHash: hash });
      return true;
    },
    async *rankingSnapshots() {
      for (const [characterId, snapshot] of rows) yield { characterId, ...structuredClone(snapshot) };
    },
  };
  return { put, store };
}

describe('development cloud rankings', () => {
  it('uses realm first, precise current metrics, shared ranks and top 50 plus self without leaking saves', async () => {
    const db = memory();
    for (let index = 1; index <= 55; index++) db.put(id(index), save());
    const capped = save();
    capped.character = executeDebugCommand(capped.character, { type: 'realm', level: FOUNDATION_LEVEL - 1 });
    capped.character.cultivation = realmAt(FOUNDATION_LEVEL).entryCost;
    db.put(id(1), capped);
    const promoted = save();
    promoted.character = executeDebugCommand(promoted.character, { type: 'realm', level: FOUNDATION_LEVEL });
    db.put(id(2), promoted);
    db.put(id(56), { ...save(), character: { ...save().character, schemaVersion: 'neko-character-4' } });
    const ranks = new RankingsService(db.store);
    const result = rankingBoardSchema.parse(await ranks.getBoard(id(55), 'cultivation'));
    expect(result.entries).toHaveLength(50);
    expect(result.entries[0].realmName).not.toBe(result.entries[1].realmName);
    expect(result.entries[0].metric).toEqual({ kind: 'cultivation', level: FOUNDATION_LEVEL, xp: '0' });
    expect(result.entries.slice(0, 4).map(entry => entry.rank)).toEqual([1, 2, 3, 3]);
    expect(result.entries.some(entry => entry.isSelf)).toBe(false);
    expect(result.self?.rank).toBe(3);
    expect(Object.keys(result.entries[0]).sort()).toEqual(['isSelf', 'metric', 'name', 'rank', 'realmName', 'updatedAt']);

    const expert = save();
    expert.character.skills.refining = { level: 10, xp: threshold('refining', 10) };
    synchronizeCharacter(expert.character);
    db.put(id(3), expert);
    expect((await ranks.getBoard(id(3), 'refining')).self?.rank).toBe(1);
    const rich = save();
    rich.character.money = '100';
    db.put(id(4), rich);
    expect((await ranks.getBoard(id(4), 'money')).self?.rank).toBe(1);
    rich.character.money = '0';
    db.put(id(4), rich);
    expect((await ranks.getBoard(id(4), 'money')).entries.every(entry => entry.rank === 1)).toBe(true);

    const strong = save();
    strong.character.marrow.agility = '100000000000000000000';
    synchronizeCharacter(strong.character);
    db.put(id(5), strong);
    const stronger = structuredClone(strong);
    stronger.character.marrow.agility = '100000000000000000001';
    synchronizeCharacter(stronger.character);
    db.put(id(6), stronger);
    const power = await ranks.getBoard(id(6), 'power');
    expect(power.self?.rank).toBe(1);
    expect(power.entries[0].metric).toEqual({ kind: 'power', score: combatPower(stronger.character) });
    expect(power.entries[1].rank).toBe(2);
  });

  it('changes only after accepted uploads and keeps history monotonic', async () => {
    const db = memory();
    const original = save();
    db.put(id(1), original);
    let now = 20_000;
    const cloud = new ClientSaveService(db.store, () => now);
    const ranks = new RankingsService(db.store);
    const next = structuredClone(original);
    next.character.money = '100';
    next.character.history.saleEarned = '100';
    const request = { characterId: id(1), requestId: id(100), baseRevision: '0', save: next };
    expect((await ranks.getBoard(id(1), 'money')).self?.metric).toEqual({ kind: 'money', amount: '0' });
    await cloud.upload(id(1), request);
    const accepted = await ranks.getBoard(id(1), 'money');
    expect(accepted.self?.metric).toEqual({ kind: 'money', amount: '100' });
    expect(accepted.self?.updatedAt).toBe(now);
    await expect(cloud.upload(id(1), { ...request, requestId: id(101) })).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    now += 20_000;
    const rollback = structuredClone(next);
    rollback.character.history.saleEarned = '99';
    rollback.character.money = '999';
    await expect(cloud.upload(id(1), { ...request, baseRevision: '1', requestId: id(102), save: rollback }))
      .rejects.toMatchObject({ code: 'SAVE_REJECTED' });
    expect(await ranks.getBoard(id(1), 'money')).toEqual(accepted);
    const empty = new RankingsService(memory().store);
    expect(await empty.getBoard(id(1), 'money')).toMatchObject({ entries: [], self: null });
  });
});
