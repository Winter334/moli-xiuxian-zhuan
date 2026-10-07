import { expect, it } from 'vitest';
import { createCharacter, readCharacter, normalizeHuashenCultivation } from '../core/prototype/character-state';
import { executeDebugCommand } from '../core/prototype/debug';
import { checkProgress, type ClientSave } from '../shared/client-save';
import { LocalSaveStore, localFromCloud, LOCAL_SAVE_KEY } from './local-save';
import { GameClient } from './game-client';

const oldSave = (level = 24): ClientSave => {
  const character = executeDebugCommand(createCharacter(0, 417), { type: 'realm', level });
  character.cultivation = '50000000000000';
  return { format: 'opening-client-2', character: readCharacter(character), tradeRevision: '0', playedMs: 0 };
};
it.each([24, 25])('等级%s定向修为下降可上传，但不得继续回退其它成长或上限以内修为', (level) => {
  const before = oldSave(level), next = structuredClone(before);
  normalizeHuashenCultivation(next.character);
  expect(() => checkProgress(before, next, 0, 0)).not.toThrow();
  next.character.cultivation = '999999999999';
  expect(() => checkProgress(before, next, 0, 0)).toThrow('成长进度发生回退');
});
it.each([24, 25])('等级%s启动先备份原始本地档，零时间间隔也处理超额，未知上传原请求保持不变', async (level) => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const store = new LocalSaveStore(storage);
  await store.load();
  const local = localFromCloud({ characterId: '00000000-0000-4000-8000-000000000001', revision: '0', save: oldSave(level), serverTime: 0 }, 0);
  local.pending = { localRevision: '0', request: { requestId: '00000000-0000-4000-8000-000000000002',
    characterId: local.characterId, baseRevision: '0', save: structuredClone(local.save) } };
  await store.write(local);
  const original = values.get(LOCAL_SAVE_KEY);
  const client = new GameClient({ store: new LocalSaveStore(storage), acquireLock: async () => () => {}, wallNow: () => 0, monotonicNow: () => 0 });
  await client.initialize();
  const after = await new LocalSaveStore(storage).load();
  expect(after?.save.character.cultivation).toBe(level === 24 ? '1000000000000' : '12000000000000');
  expect([...values].find(([key]) => key.includes(':huashen-original:'))?.[1]).toBe(original);
  expect(after?.pending).toEqual(local.pending);
  client.stop();
});
it.each([24, 25])('等级%s备份失败时不覆盖主存档', async (level) => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (key.includes(':huashen-original:')) throw new Error('quota'); values.set(key, value); } };
  const store = new LocalSaveStore(storage);
  await store.load();
  const local = localFromCloud({ characterId: '00000000-0000-4000-8000-000000000001', revision: '0', save: oldSave(level), serverTime: 0 }, 0);
  await store.write(local);
  const original = values.get(LOCAL_SAVE_KEY);
  normalizeHuashenCultivation(local.save.character);
  await expect(store.write(local)).rejects.toThrow('无法保存');
  expect(values.get(LOCAL_SAVE_KEY)).toBe(original);
});
