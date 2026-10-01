import { createHash, randomInt } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { z } from 'zod';
import {
  advanceCharacter, createCharacter, executeCharacterCommand, getCharacterView,
  pauseSimulationUntil, readCharacter, type CharacterState,
} from '../../core/prototype';
import { CharacterCommandError } from '../../core/prototype/character';
import type { OpeningCommand, OpeningResponse } from '../../shared/opening-contracts';
import { ApiError, errorResponse } from '../errors';
import type { OpeningStore, StoredResponse } from './repository';

const id = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);
export const openingCommandSchema: z.ZodType<OpeningCommand> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('travel'), locationId: id }).strict(),
  z.object({ type: z.literal('enter'), regionId: id }).strict(),
  z.object({ type: z.literal('withdraw') }).strict(),
  z.object({ type: z.literal('recover'), mode: z.enum(['rest', 'sleep']) }).strict(),
]);
export const requestSchema = z.object({ requestId: z.uuid(), command: openingCommandSchema }).strict();

export const ONLINE_REQUEST_GAP_MS = 5000;

export class OpeningService {
  private readonly versions = createCharacter(0, 1);
  private readonly lastContact = new Map<string, number>();

  constructor(
    readonly store: OpeningStore,
    private readonly now: () => number = Date.now,
    private readonly maxSteps = 1000,
    private readonly maxAttempts = 5,
  ) {
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 10000 ||
        !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('Invalid service budget.');
  }

  private time() {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 3_600_000) throw new Error('Invalid server clock.');
    return now;
  }

  private isOnline(characterId: string, now: number) {
    const previous = this.lastContact.get(characterId);
    return previous !== undefined && now >= previous && now - previous <= ONLINE_REQUEST_GAP_MS;
  }

  private rememberContact(characterId: string, now: number) {
    for (const [id, at] of this.lastContact) {
      if (now - at > ONLINE_REQUEST_GAP_MS) this.lastContact.delete(id);
    }
    this.lastContact.set(characterId, Math.max(now, this.lastContact.get(characterId) ?? now));
  }

  private async settleTime(raw: unknown, now: number, online: boolean) {
    const saved = raw as Partial<CharacterState> | null;
    if (saved?.schemaVersion !== this.versions.schemaVersion || saved.contentVersion !== this.versions.contentVersion ||
        saved.simulation?.kernelVersion !== this.versions.simulation.kernelVersion) {
      throw new ApiError(409, 'SAVE_VERSION_MISMATCH', '角色与当前版本不兼容，原存档未修改。');
    }
    let state = readCharacter(raw);
    const target = Math.max(now, state.simulation.clockMs);
    if (state.simulation.battle && (!online || target - state.simulation.clockMs > ONLINE_REQUEST_GAP_MS)) {
      state.simulation = pauseSimulationUntil(state.simulation, target);
      return state;
    }
    while (state.simulation.clockMs < target) {
      const before = state.simulation.clockMs;
      state = advanceCharacter(state, target, this.maxSteps);
      if (state.simulation.clockMs <= before || state.simulation.clockMs > target) throw new Error('Invalid catch-up checkpoint.');
      await yieldToEventLoop();
    }
    return state;
  }

  private response(characterId: string, state: CharacterState, revision: string, serverTime: number): OpeningResponse {
    return { characterId, game: getCharacterView(state), revision, serverTime, mode: 'local-opening' };
  }

  async createSession() {
    return this.store.createSession(createCharacter(this.time(), randomInt(1, 0x1_0000_0000)));
  }

  async getGame(characterId: string): Promise<OpeningResponse> {
    const now = this.time();
    // Capture before awaiting storage: a concurrent reconnect cannot authorize an old gap.
    const online = this.isOnline(characterId, now);
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const snapshot = await this.store.load(characterId);
      const state = await this.settleTime(snapshot.state, now, online);
      if (state.simulation.clockMs === (snapshot.state as CharacterState).simulation.clockMs) {
        this.rememberContact(characterId, now);
        return this.response(characterId, state, snapshot.revision, now);
      }
      if ((await this.store.commit(characterId, snapshot.revision, state)).committed) {
        this.rememberContact(characterId, now);
        return this.response(characterId, state, String(BigInt(snapshot.revision) + 1n), now);
      }
      await yieldToEventLoop();
    }
    throw new ApiError(409, 'STATE_CONFLICT', '进度正在更新，请稍后重试。');
  }

  async command(characterId: string, requestId: string, input: OpeningCommand): Promise<StoredResponse> {
    // Schema parsing canonicalizes field order before hashing.
    const command = openingCommandSchema.parse(input);
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const now = this.time();
    const online = this.isOnline(characterId, now);
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const replay = await this.store.findReceipt(characterId, requestId, hash);
      if (replay) return replay;
      const snapshot = await this.store.load(characterId);
      const advanced = await this.settleTime(snapshot.state, now, online);
      let state = advanced;
      let result: StoredResponse;
      try {
        state = executeCharacterCommand(advanced, command);
        result = { statusCode: 200, body: this.response(characterId, state, String(BigInt(snapshot.revision) + 1n), now) };
      } catch (error) {
        if (!(error instanceof CharacterCommandError)) throw error;
        // Eligible time still passes on rejection, but the failed action has no effects.
        result = { statusCode: 422, body: errorResponse(new ApiError(422, 'COMMAND_REJECTED', error.message)) };
      }
      const committed = await this.store.commit(characterId, snapshot.revision, state, {
        ...result, requestId, payloadHash: hash, command,
      });
      if (committed.replay) return committed.replay;
      if (committed.committed) {
        this.rememberContact(characterId, now);
        return result;
      }
      await yieldToEventLoop();
    }
    throw new ApiError(409, 'STATE_CONFLICT', '进度正在更新，请使用原请求重试。');
  }
}
