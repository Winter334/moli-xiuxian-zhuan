import { createHash, randomInt } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { createRules, RuleError, type Content } from '../core/index';
import type { GameCommand, GameResponse } from '../shared/contracts';
import { ApiError, errorResponse } from './errors';
import { GameRepository, type GameState, type StoredResponse } from './repository';

export interface GameServiceOptions {
  content?: Content;
  now?: () => number;
  maxTicksPerChunk?: number;
  maxAttempts?: number;
}

function payloadHash(command: GameCommand): string {
  const ordered = Object.fromEntries(Object.entries(command).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

export class GameService {
  private readonly now: () => number;
  private readonly maxTicks: number;
  private readonly maxAttempts: number;
  private readonly rules: ReturnType<typeof createRules>;
  private readonly versions: GameState;

  constructor(readonly repository: GameRepository, options: GameServiceOptions = {}) {
    this.rules = createRules(options.content);
    this.versions = this.rules.createGame(0, 1);
    this.now = options.now ?? Date.now;
    this.maxTicks = options.maxTicksPerChunk ?? 100;
    this.maxAttempts = options.maxAttempts ?? 5;
    if (!Number.isInteger(this.maxTicks) || this.maxTicks < 1 || this.maxTicks > 3600 ||
        !Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 20) {
      throw new Error('Invalid simulation chunk or retry limit.');
    }
  }

  private currentTime(): number {
    const time = this.now();
    if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid server clock.');
    return time;
  }

  private assertVersions(state: GameState): void {
    if (state.contentVersion !== this.versions.contentVersion ||
        state.rulesVersion !== this.versions.rulesVersion ||
        state.schemaVersion !== this.versions.schemaVersion) {
      throw new ApiError(409, 'SAVE_VERSION_MISMATCH', '此存档与当前规则版本不兼容，原存档未被修改。');
    }
  }

  private async catchUp(state: GameState, targetMs: number): Promise<GameState> {
    this.assertVersions(state);
    const target = Math.floor(targetMs / 1000) * 1000;
    if (!Number.isSafeInteger(state.clockMs) || state.clockMs < 0 || state.clockMs % 1000 !== 0) {
      throw new Error('Invalid saved simulation clock.');
    }
    let next = state;
    while (next.clockMs < target) {
      const previousClock = next.clockMs;
      next = this.rules.advanceGame(next, target, this.maxTicks);
      if (!Number.isSafeInteger(next.clockMs) || next.clockMs <= previousClock ||
          next.clockMs > target || next.clockMs % 1000 !== 0) {
        throw new Error('The rule core did not return a valid simulation checkpoint.');
      }
      await yieldToEventLoop();
    }
    return next;
  }

  private response(state: GameState, revision: string, serverTime: number): GameResponse {
    return { game: this.rules.getGameView(state), revision, serverTime, mode: 'local-development' };
  }

  async createSession(): Promise<{ token: string; characterId: string }> {
    return this.repository.createSession(this.rules.createGame(this.currentTime(), randomInt(1, 0x1_0000_0000)));
  }

  async getGame(characterId: string): Promise<GameResponse> {
    const time = this.currentTime();
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const snapshot = await this.repository.load(characterId);
      const state = await this.catchUp(snapshot.state, time);
      if (state.clockMs === snapshot.state.clockMs) {
        return this.response(state, snapshot.revision, time);
      }
      const response = this.response(state, (BigInt(snapshot.revision) + 1n).toString(), time);
      if ((await this.repository.commit(characterId, snapshot.revision, state)).committed) return response;
      await yieldToEventLoop();
    }
    throw new ApiError(409, 'STATE_CONFLICT', 'The character changed concurrently. Please retry.');
  }

  async command(characterId: string, requestId: string, command: GameCommand): Promise<StoredResponse> {
    const hash = payloadHash(command);
    const time = this.currentTime();
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const replay = await this.repository.findReceipt(characterId, requestId, hash);
      if (replay) return replay;
      const snapshot = await this.repository.load(characterId);
      const advanced = await this.catchUp(snapshot.state, time);
      let next: GameState | null;
      let result: StoredResponse;
      let rejection: RuleError | undefined;
      try {
        next = this.rules.applyCommand(advanced, command);
      } catch (error) {
        if (!(error instanceof RuleError)) throw error;
        // A rejected command changes no assets or clock. Its rejection is still idempotent.
        rejection = error;
        next = null;
      }
      if (next) {
        result = { statusCode: 200, body: this.response(next, (BigInt(snapshot.revision) + 1n).toString(), time) };
      } else {
        result = {
          statusCode: 422,
          body: errorResponse(new ApiError(422, 'COMMAND_REJECTED', rejection!.message)),
        };
      }
      const committed = await this.repository.commit(characterId, snapshot.revision, next, {
        ...result, requestId, payloadHash: hash, command,
      });
      if (committed.replay) return committed.replay;
      if (committed.committed) return result;
      await yieldToEventLoop();
    }
    throw new ApiError(409, 'STATE_CONFLICT', 'The character changed concurrently. Retry with the same requestId.');
  }
}
