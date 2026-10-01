import { describe, expect, it, vi } from 'vitest';
import { advanceCharacter, createCharacter, executeCharacterCommand } from '../../core/prototype';
import type { ClientSave, SaveUpload } from '../../shared/client-save';
import { ClientSaveService, MIN_UPLOAD_INTERVAL_MS } from '../../server/client/service';
import type { CloudSnapshot, CloudStore } from '../../server/client/repository';
import { checkProgress, readClientSave } from '../../shared/client-save';
import { executeDebugCommand } from '../../core/prototype/debug';
import { FOUNDATION_LEVEL, realmAt } from '../../core/prototype/growth';
import { dec, text } from '../../core/numbers';
import { FOUNDATION_DIVINE_ART } from '../../core/prototype/divine-arts';
import { FATE_IDS } from '../../core/prototype/fates';
import { synchronizeCharacter } from '../../core/prototype/character-state';
import { MANUAL_IDS, MANUALS } from '../../core/prototype/skills';

const characterId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const secondId = '00000000-0000-4000-8000-000000000003';
const initial = (): ClientSave => ({ format: 'opening-client-2', tradeRevision: '0', character: createCharacter(0, 19), playedMs: 0 });
function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseObjectKeys(entry)]));
  }
  return value;
}
function memoryStore(save = initial(), serialize: (save: ClientSave) => unknown = structuredClone) {
  let current: CloudSnapshot = { save: serialize(save), revision: '0', receivedAt: 0, lastRequestId: null, lastPayloadHash: null };
  const store: CloudStore = {
    async createSession() { throw new Error('unused'); },
    async load() { return structuredClone(current); },
    async commit(_id, expected, next, now, id, hash) {
      if (current.revision !== expected) return false;
      current = { save: serialize(next), revision: String(BigInt(expected) + 1n), receivedAt: now, lastRequestId: id, lastPayloadHash: hash };
      return true;
    },
  };
  return { store, snapshot: () => structuredClone(current) };
}
const upload = (save: ClientSave, overrides: Partial<SaveUpload> = {}): SaveUpload =>
  ({ characterId, requestId, baseRevision: '0', save, ...overrides });

describe('client cloud save contract', () => {
  it.each(MANUAL_IDS)('reads and uploads %s snapshots after object keys are reordered', async manualId => {
    const previous = initial();
    previous.character = executeDebugCommand(previous.character, { type: 'travel', locationId: MANUALS[manualId].location });
    previous.character = executeCharacterCommand(previous.character, { type: 'learn-manual', manualId });
    const active = { ...previous, character: executeCharacterCommand(previous.character, { type: 'activate-manual', manualId }) };
    const memory = memoryStore(previous, reverseObjectKeys);
    let now = 20_000;
    const service = new ClientSaveService(memory.store, () => now);
    await service.upload(characterId, upload(active));
    const beforeRead = memory.snapshot();
    expect((await service.getProfile(characterId)).save).toEqual(active);
    expect(memory.snapshot()).toEqual(beforeRead);

    now += MIN_UPLOAD_INTERVAL_MS;
    const next = { ...active, character: advanceCharacter(active.character, 1000), playedMs: 1000 };
    await expect(service.upload(characterId, reverseObjectKeys(upload(next, { baseRevision: '1', requestId: secondId }))))
      .resolves.toMatchObject({ revision: '2' });
    expect((await service.getProfile(characterId)).save).toEqual(next);

    const beforeRejection = memory.snapshot();
    const forged = structuredClone(next);
    const source = forged.character.simulation.player.sources.find(entry => entry.id === `manual:${manualId}`)!;
    source.statPolarity!.multiplier![MANUALS[manualId].attribute] = 'cost';
    await expect(service.upload(characterId, upload(forged, { baseRevision: '2' })))
      .rejects.toMatchObject({ code: 'SAVE_REJECTED' });
    expect(memory.snapshot()).toEqual(beforeRejection);
  });

  it('persists the initial fate checkpoint and rejects a different valid fate on subsequent uploads', async () => {
    const memory = memoryStore();
    const created = vi.fn<CloudStore['createSession']>().mockImplementation(async (save, now) => {
      await memory.store.commit(characterId, '0', save, now, requestId, 'creation');
      return { token: secondId, characterId };
    });
    const service = new ClientSaveService({ ...memory.store, createSession: created }, () => 20_000);
    await service.createSession();
    const initialSave = created.mock.calls[0][0];
    const first = await service.getProfile(characterId);
    expect(first.save).toEqual(initialSave);
    expect((await service.getProfile(characterId)).save).toEqual(initialSave);
    const before = memory.snapshot();
    const changed = structuredClone(first.save);
    changed.character.fateId = FATE_IDS.find(id => id !== changed.character.fateId)!;
    synchronizeCharacter(changed.character);
    expect(() => readClientSave(changed)).not.toThrow();
    const uploader = new ClientSaveService(memory.store, () => 20_000 + MIN_UPLOAD_INTERVAL_MS);
    await expect(uploader.upload(characterId, upload(changed, { baseRevision: first.revision, requestId: secondId })))
      .rejects.toMatchObject({ code: 'SAVE_REJECTED', message: '本世气运不一致，本地进度未覆盖云端' });
    expect(memory.snapshot()).toEqual(before);
  });

  it('preserves learned divine arts through uploads while allowing activation and stopping', async () => {
    const previous = initial();
    previous.character = executeDebugCommand(previous.character, { type: 'realm', level: FOUNDATION_LEVEL });
    const memory = memoryStore(previous);
    let now = 20_000;
    const service = new ClientSaveService(memory.store, () => now);
    const active = readClientSave({
      ...previous,
      character: executeCharacterCommand(previous.character, { type: 'activate-divine-art', divineArtId: FOUNDATION_DIVINE_ART }),
    });
    await service.upload(characterId, upload(active));
    expect(readClientSave(memory.snapshot().save).character).toEqual(active.character);

    now += MIN_UPLOAD_INTERVAL_MS;
    const stopped = readClientSave({
      ...active,
      character: executeCharacterCommand(active.character, { type: 'activate-divine-art', divineArtId: null }),
    });
    await service.upload(characterId, upload(stopped, { requestId: secondId, baseRevision: '1' }));
    expect((await service.getProfile(characterId)).save.character).toEqual(stopped.character);
    expect(stopped.character.learnedDivineArts).toEqual(active.character.learnedDivineArts);
    const removed = structuredClone(stopped);
    removed.character.learnedDivineArts = [];
    expect(() => checkProgress(stopped, removed, 0, now)).toThrow('成长进度发生回退');
    const beforeRejection = memory.snapshot();
    now += MIN_UPLOAD_INTERVAL_MS;
    await expect(service.upload(characterId, upload(removed, { baseRevision: '2' })))
      .rejects.toMatchObject({ code: 'SAVE_REJECTED' });
    expect(memory.snapshot()).toEqual(beforeRejection);
  });

  it('rejects cultivation above the breakthrough cap without rewriting the snapshot', () => {
    const capped = initial();
    capped.character = executeDebugCommand(capped.character, { type: 'realm', level: FOUNDATION_LEVEL - 1 });
    const cost = realmAt(FOUNDATION_LEVEL).entryCost;
    capped.character.cultivation = cost;
    expect(readClientSave(capped).character.cultivation).toBe(cost);
    const invalid = structuredClone(capped);
    invalid.character.cultivation = text(dec(cost).plus('0.01'));
    expect(() => readClientSave(invalid)).toThrow('Cultivation exceeds breakthrough cap');
    expect(invalid.character.cultivation).toBe(text(dec(cost).plus('0.01')));
    const promoted = structuredClone(capped);
    promoted.character = executeDebugCommand(promoted.character, { type: 'realm', level: FOUNDATION_LEVEL });
    expect(promoted.character.cultivation).toBe('0');
    expect(() => checkProgress(readClientSave(capped), readClientSave(promoted), 0, 20_000)).not.toThrow();
    promoted.character.cultivation = text(dec(cost).mul(2));
    expect(readClientSave(promoted).character.cultivation).toBe(promoted.character.cultivation);
  });

  it('preserves accumulated insight across uploads and rejects removal or rollback', () => {
    const previous = initial();
    previous.character = executeDebugCommand(previous.character, { type: 'realm', level: FOUNDATION_LEVEL });
    previous.character.marrowInsight = '2';
    const valid = readClientSave(previous);
    for (const points of [undefined, '1.99']) {
      const next = structuredClone(valid);
      if (points === undefined) delete next.character.marrowInsight;
      else next.character.marrowInsight = points;
      expect(() => checkProgress(valid, readClientSave(next), 0, 20_000)).toThrow('成长进度发生回退');
    }
    const next = structuredClone(valid);
    next.character.marrowInsight = '2.01';
    expect(() => checkProgress(valid, readClientSave(next), 0, 20_000)).not.toThrow();
    expect(() => checkProgress(valid, valid, 0, 20_000)).not.toThrow();
  });

  it('reads a snapshot without advancing gameplay and commits concurrent duplicate uploads only once', async () => {
    const original = initial();
    const memory = memoryStore(original);
    const service = new ClientSaveService(memory.store, () => 20_000);
    expect((await service.getProfile(characterId)).save).toEqual(original);
    expect(memory.snapshot().revision).toBe('0');
    const next = { ...original, character: advanceCharacter(original.character, 1000), playedMs: 1000 };
    const input = upload(next);
    const results = await Promise.all([service.upload(characterId, input), service.upload(characterId, input)]);
    expect(results[0]).toEqual(results[1]);
    expect(memory.snapshot().revision).toBe('1');
    const accepted = memory.snapshot();
    expect(await service.upload(characterId, input)).toEqual(results[0]);
    await expect(service.upload(characterId, { ...input, save: { ...next, playedMs: 999 } }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(memory.snapshot()).toEqual(accepted);
  });

  it('rejects mismatched identity, impossible panels, time acceleration and stale cloud revisions without changing data', async () => {
    const memory = memoryStore();
    const service = new ClientSaveService(memory.store, () => 20_000);
    const before = memory.snapshot();
    await expect(service.upload(secondId, upload(initial()))).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
    const invalid = initial();
    invalid.character.simulation.player.base.attack = '999';
    await expect(service.upload(characterId, upload(invalid))).rejects.toMatchObject({ code: 'SAVE_REJECTED' });
    await expect(service.upload(characterId, upload({ ...initial(), playedMs: 50_000 }))).rejects.toMatchObject({ code: 'SAVE_REJECTED' });
    await expect(service.upload(characterId, upload(initial(), { baseRevision: '9' }))).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    expect(memory.snapshot()).toEqual(before);
  });

  it('rate-limits new uploads, rejects rollback, and allows legitimate progress after a delayed acknowledgement', async () => {
    const memory = memoryStore();
    let now = 20_000;
    const service = new ClientSaveService(memory.store, () => now);
    const original = initial();
    const previous = { ...original, character: advanceCharacter(original.character, 1000), playedMs: 1000 };
    await service.upload(characterId, upload(previous));
    const accepted = memory.snapshot();
    now += 1;
    await expect(service.upload(characterId, upload(previous, { requestId: secondId, baseRevision: '1' })))
      .rejects.toMatchObject({ code: 'SAVE_RATE_LIMIT' });
    now += MIN_UPLOAD_INTERVAL_MS;
    await expect(service.upload(characterId, upload({ ...previous, playedMs: 0 }, { requestId: secondId, baseRevision: '1' })))
      .rejects.toMatchObject({ code: 'SAVE_REJECTED' });
    expect(memory.snapshot()).toEqual(accepted);
    const next = { ...previous, character: advanceCharacter(previous.character, now), playedMs: now };
    expect(await service.upload(characterId, upload(next, { requestId: secondId, baseRevision: '1' })))
      .toMatchObject({ revision: '2' });
  });
});
