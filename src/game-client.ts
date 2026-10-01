import { advanceCharacter, executeCharacterCommand, getCharacterView, pauseSimulationUntil } from '../core/prototype';
import { CharacterCommandError, type CharacterEvent } from '../core/prototype/character';
import type { CharacterState } from '../core/prototype/character-state';
import type { DebugCommand } from '../core/prototype/debug';
import { applyConsignmentDelta, requireMerchant, type ConsignmentAsset } from '../core/prototype/consignment';
import {
  CLOUD_SAVE_INTERVAL_MS, cloudProfileSchema, MAX_FRAME_GAP_MS, MAX_SAVE_BYTES, SaveCapacityError, uploadAckSchema,
  worldTimeSchema, type ClientSave,
} from '../shared/client-save';
import type { OpeningCommand, OpeningView } from '../shared/opening-contracts';
import { rankingBoardSchema, type RankingBoard, type RankingId } from '../shared/rankings';
import {
  consignmentLookupSchema, consignmentReceiptSchema, consignmentRequestSchema, consignmentViewRequestSchema,
  consignmentViewSchema, type ConsignmentFilter, type ConsignmentRequest, type ConsignmentView,
} from '../shared/consignment';
import { acquireLocalSaveLock, LocalSaveStore, localFromCloud, type LocalSave } from './local-save';
import { availableCharacter, checkReservedCapacity, reserveTrade, restoreReservation, validateTradeReceipt, type PendingTrade } from './trade-reservation';
import { WorldClock } from './world-clock';
import { combatFrame, EMPTY_COMBAT_FRAME, type CombatFrame } from './combat-presentation';
import {
  reincarnationLookupSchema, reincarnationReceiptSchema, reincarnationRequestSchema,
  validateReincarnationReceipt, type ReincarnationRequest,
} from '../shared/reincarnation';

export interface ConnectionIssue {
  message: string;
  source: 'local' | 'cloud' | 'action';
  retryable?: boolean;
}
export interface ClientState {
  combatFrame: CombatFrame;
  response: { characterId: string; game: OpeningView } | null;
  busy: boolean;
  refreshing: boolean;
  blocked: boolean;
  issue: ConnectionIssue | null;
  lastUpdated: number | null;
  lastCloudSave: number | null;
  tradePending: boolean;
  tradeBusy: boolean;
  tradeStopped: boolean;
  tradeMessage: string | null;
  reincarnationPending: boolean;
  reincarnationBusy: boolean;
  reincarnationMessage: string | null;
}
interface Options {
  fetcher?: typeof fetch;
  store?: LocalSaveStore;
  wallNow?: () => number;
  monotonicNow?: () => number;
  acquireLock?: () => Promise<() => void>;
  cloudIntervalMs?: number;
  expectedCharacterId?: string;
}
class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export class GameClient {
  private state: ClientState = {
    combatFrame: EMPTY_COMBAT_FRAME,
    response: null, busy: false, refreshing: false, blocked: true, issue: null,
    lastUpdated: null, lastCloudSave: null,
    tradePending: false, tradeBusy: false, tradeStopped: false, tradeMessage: null,
    reincarnationPending: false, reincarnationBusy: false, reincarnationMessage: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly fetcher: typeof fetch;
  private readonly store: LocalSaveStore;
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;
  private readonly acquireLock: () => Promise<() => void>;
  private readonly cloudIntervalMs: number;
  private readonly worldClock: WorldClock;
  private readonly expectedCharacterId: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private local: LocalSave | null = null;
  private releaseLock: (() => void) | null = null;
  private lastFrame = 0;
  private initialized = false;
  private active = false;
  private generation = 0;
  private cloudStopped = false;
  private cloudFlight: Promise<void> | null = null;
  private timeFlight: Promise<void> | null = null;
  private tradeFlight: Promise<boolean> | null = null;
  private reincarnationFlight: Promise<boolean> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private cloudTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: Options = {}) {
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.store = options.store ?? new LocalSaveStore();
    this.wallNow = options.wallNow ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.worldClock = new WorldClock(this.wallNow, this.monotonicNow);
    this.expectedCharacterId = options.expectedCharacterId;
    this.acquireLock = options.acquireLock ?? acquireLocalSaveLock;
    this.cloudIntervalMs = options.cloudIntervalMs ?? CLOUD_SAVE_INTERVAL_MS + Math.floor(Math.random() * 15_000);
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(update: Partial<ClientState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach(listener => listener());
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private failLocal(error: unknown) {
    this.publish({ blocked: true, issue: { source: 'local', message: error instanceof Error ? error.message : '本地存档不可用，已暂停推进' } });
  }
  private async persist(local: LocalSave, show = true, events: CharacterEvent[] = [], paused = false) {
    try { this.local = await this.store.write({ ...local, worldClock: this.worldClock.checkpoint() }); }
    catch (error) { this.failLocal(error); throw error; }
    if (show) this.publish({
      combatFrame: combatFrame(this.state.combatFrame, local.save.character.simulation.clockMs,
        this.monotonicNow(), events, paused || local.pendingReincarnation !== null),
      response: { characterId: local.characterId, game: getCharacterView(availableCharacter(local.save.character, local.pendingTrade), this.worldClock.now()) },
      lastUpdated: local.wallSavedAt,
      tradePending: local.pendingTrade !== null,
      reincarnationPending: local.pendingReincarnation !== null,
      tradeStopped: this.cloudStopped || local.syncConflict !== null,
    });
  }
  private async request(url: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetcher(url, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new RequestError(data.message ?? '云存档暂不可用，本地进度保留', response.status);
      return data;
    } finally { clearTimeout(timeout); }
  }

  initialize = () => {
    const generation = this.generation;
    return this.serial(async () => {
      if (this.initialized) return;
      this.publish({ busy: true, blocked: true });
      try {
        this.releaseLock = await this.acquireLock();
        if (generation !== this.generation) { this.releaseLock(); this.releaseLock = null; return; }
        this.local = await this.store.load();
        if (this.local && this.expectedCharacterId && this.local.characterId !== this.expectedCharacterId) {
          throw new Error('本地角色与当前 Discord 账号不一致，原存档保留，已停止读取。');
        }
        if (this.local) {
          this.worldClock.restore(this.local.worldClock);
        } else {
          const profile = cloudProfileSchema.parse(await this.request('/api/client/session', {}));
          if (this.expectedCharacterId && profile.characterId !== this.expectedCharacterId) {
            throw new Error('云端角色与当前 Discord 账号不一致，未创建或覆盖本地存档。');
          }
          if (generation !== this.generation) return;
          this.worldClock.calibrate(profile.serverTime);
          await this.persist(localFromCloud(profile, this.wallNow()));
        }
        const gap = Math.max(0, this.wallNow() - this.local!.wallSavedAt);
        if (!this.local!.pendingReincarnation) await this.settle(gap, false, generation);
        if (generation !== this.generation) return;
        this.lastFrame = this.monotonicNow();
        this.initialized = true;
        this.cloudStopped = this.local!.syncConflict !== null;
        this.publish({
          blocked: this.local!.pendingReincarnation !== null,
          issue: this.local!.syncConflict ? { source: 'cloud', message: this.local!.syncConflict, retryable: false } : null,
          tradePending: this.local!.pendingTrade !== null, tradeStopped: this.cloudStopped,
          tradeMessage: this.local!.syncConflict,
          reincarnationPending: this.local!.pendingReincarnation !== null,
          reincarnationMessage: this.local!.pendingReincarnation ? '轮回结果待核对，本世已暂停' : null,
          response: { characterId: this.local!.characterId,
            game: getCharacterView(availableCharacter(this.local!.save.character, this.local!.pendingTrade), this.worldClock.now()) },
        });
      } catch (error) {
        this.releaseLock?.();
        this.releaseLock = null;
        this.failLocal(error);
      } finally { this.publish({ busy: false }); }
    });
  };

  // Interrupted chunks are saved with their corresponding wall checkpoint.
  private async settle(gap: number, connected: boolean, generation = this.generation) {
    if (!this.local || this.local.pendingReincarnation || gap <= 0) return;
    const start = this.local.save.character.simulation.clockMs;
    const target = start + gap;
    const wallTarget = Math.max(this.local.wallSavedAt, this.wallNow());
    const played = this.local.save.playedMs;
    while (this.local.save.character.simulation.clockMs < target && generation === this.generation) {
      const character = this.local.save.character;
      const available = availableCharacter(character, this.local.pendingTrade);
      const events: CharacterEvent[] = [];
      let paused = !connected;
      let next = (available.simulation.battle || available.training || available.gathering) && !connected
        ? { ...available, simulation: pauseSimulationUntil(available.simulation, target) }
        : advanceCharacter(available, target, connected && this.local.pendingTrade ? 1 : 128, events);
      next = restoreReservation(next, this.local.pendingTrade);
      try { checkReservedCapacity(next, this.local.pendingTrade); }
      catch (error) {
        if (!(error instanceof SaveCapacityError)) throw error;
        // Do not commit an event whose rewards would consume reserved receiving capacity.
        next = { ...character, simulation: pauseSimulationUntil(character.simulation, target) };
        events.length = 0;
        paused = true;
        this.publish({ issue: { source: 'action', message: '行囊或灵石容量不足（含寄售预留），本次活动计时已暂停；可先腾出空间' } });
      }
      if (next.simulation.clockMs <= character.simulation.clockMs) throw new Error('本地计时未能推进');
      const save: ClientSave = {
        ...this.local.save, character: next,
        playedMs: played + (connected ? next.simulation.clockMs - start : 0),
      };
      await this.persist({
        ...this.local, save,
        localRevision: String(BigInt(this.local.localRevision) + 1n),
        wallSavedAt: Math.max(this.local.wallSavedAt, wallTarget - (target - next.simulation.clockMs)),
      }, true, events, paused);
      if (next.simulation.clockMs < target) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  private async advanceFrame() {
    const now = this.monotonicNow();
    const gap = Math.max(0, Math.floor(now - this.lastFrame));
    await this.settle(gap, gap <= MAX_FRAME_GAP_MS);
    this.lastFrame += gap;
  }
  tick = () => this.serial(async () => {
    if (!this.initialized || this.state.blocked) return;
    try { await this.advanceFrame(); }
    catch (error) { this.failLocal(error); }
  });

  private runAction = (execute: (state: CharacterState, events: CharacterEvent[]) => CharacterState | Promise<CharacterState>): Promise<boolean> => this.serial(async () => {
    if (!this.initialized || !this.local || this.state.blocked || this.state.reincarnationBusy) return false;
    this.publish({ busy: true });
    try {
      await this.advanceFrame();
      const events: CharacterEvent[] = [];
      const character = restoreReservation(await execute(availableCharacter(this.local.save.character, this.local.pendingTrade), events), this.local.pendingTrade);
      checkReservedCapacity(character, this.local.pendingTrade);
      await this.persist({
        ...this.local, save: { ...this.local.save, character },
        localRevision: String(BigInt(this.local.localRevision) + 1n),
      }, true, events);
      if (this.state.issue?.source === 'action') this.publish({ issue: null });
      return true;
    } catch (error) {
      if (error instanceof CharacterCommandError || error instanceof SaveCapacityError) {
        this.publish({ issue: { source: 'action', message: error.message } });
      }
      else this.failLocal(error);
      return false;
    } finally { this.publish({ busy: false }); }
  });

  command = (command: OpeningCommand): Promise<boolean> =>
    this.runAction((state, events) => executeCharacterCommand(state, command, this.worldClock.now(), events));

  refreshWorldTime = (): Promise<void> => {
    if (this.timeFlight) return this.timeFlight;
    if (!this.initialized || this.state.blocked) return Promise.resolve();
    const generation = this.generation;
    const started = this.monotonicNow();
    const work = async () => {
      let sample: { serverTime: number };
      try { sample = worldTimeSchema.parse(await this.request('/api/client/time')); }
      catch { return; } // Keep projecting the last clock sample while the service is unavailable.
      const received = this.monotonicNow();
      const roundTrip = received - started;
      if (roundTrip < 0 || roundTrip > MAX_FRAME_GAP_MS) return;
      await this.serial(async () => {
        if (generation !== this.generation || !this.local || !this.initialized || this.state.blocked) return;
        this.worldClock.calibrate(sample.serverTime +
          Math.floor(roundTrip / 2 + Math.max(0, this.monotonicNow() - received)));
        await this.persist(this.local);
      });
    };
    const flight = work().catch(error => { if (generation === this.generation) this.failLocal(error); })
      .finally(() => { if (this.timeFlight === flight) this.timeFlight = null; });
    this.timeFlight = flight;
    return flight;
  };

  loadRanking = async (board: RankingId): Promise<RankingBoard> => {
    if (!this.local || !this.initialized) throw new Error('角色尚未读取');
    const generation = this.generation;
    const life = this.local.save.character.life.number;
    const result = rankingBoardSchema.parse(await this.request(
      `/api/client/rankings/${board}?characterId=${encodeURIComponent(this.local.characterId)}`,
    ));
    if (result.board !== board) throw new Error('榜单回执不匹配');
    if (generation !== this.generation || life !== this.local?.save.character.life.number) {
      throw new Error('榜单页面已变化，请重新读取');
    }
    return result;
  };

  private requireTrading() {
    if (!this.local || !this.initialized || this.state.blocked) throw new CharacterCommandError('角色尚未就绪');
    if (this.state.reincarnationBusy || this.local.pendingReincarnation) throw new CharacterCommandError('轮回正在核对，暂不能办理寄售');
    if (this.cloudStopped || this.local.syncConflict) throw new CharacterCommandError('保存或交易状态冲突，已停止新的寄售操作');
    if (this.local.pendingTrade) throw new CharacterCommandError('上一笔交易尚待核对');
  }

  private async finishUpload() {
    if (this.cloudFlight) await this.cloudFlight;
    else if (this.local?.pending && !this.cloudStopped) await this.sync();
  }

  loadConsignment = async (
    shopId: ConsignmentRequest['shopId'], view: ConsignmentView['view'], page: number, filter: ConsignmentFilter,
  ): Promise<ConsignmentView> => {
    const generation = this.generation;
    await this.finishUpload();
    const request = await this.serial(async () => {
      this.requireTrading();
      if (generation !== this.generation || this.local!.pending) throw new CharacterCommandError('请先核对已有云上传');
      requireMerchant(this.local!.save.character, shopId);
      return consignmentViewRequestSchema.parse({
        characterId: this.local!.characterId, baseRevision: this.local!.cloudRevision, save: this.local!.save,
        shopId, view, page, filter,
      });
    });
    const result = consignmentViewSchema.parse(await this.request('/api/client/consignment/view', request));
    if (generation !== this.generation || !this.local || this.local.characterId !== request.characterId ||
        this.local.cloudRevision !== request.baseRevision || this.local.pendingTrade ||
        this.local.pendingReincarnation || this.local.save.character.life.number !== request.save.character.life.number ||
        this.local.save.character.locationId !== request.save.character.locationId ||
        result.view !== view || result.page !== page) throw new Error('寄售页面已变化，请重新读取');
    return result;
  };

  private async stopOnline(message: string) {
    this.cloudStopped = true;
    if (this.local) await this.persist({ ...this.local, syncConflict: message });
    this.publish({ tradeStopped: true, tradeMessage: message,
      issue: { source: 'cloud', message, retryable: false } });
  }

  private runTrade(work: (generation: number) => Promise<boolean>): Promise<boolean> {
    if (this.tradeFlight) return this.tradeFlight;
    const generation = this.generation;
    this.publish({ tradeBusy: true, tradeMessage: null });
    const flight = work(generation).catch(async error => {
      if (generation !== this.generation) return false;
      const fatal = error instanceof RequestError && [400, 401, 403, 409, 413, 422].includes(error.status);
      const message = error instanceof CharacterCommandError || error instanceof SaveCapacityError || error instanceof RequestError
        ? error.message : '寄售结果暂未确认，预留与原请求已保留，请稍后核对';
      await this.serial(async () => {
        if (generation !== this.generation || !this.local || !this.releaseLock || this.state.blocked) return;
        if (fatal) await this.stopOnline(message);
        else this.publish({ tradeMessage: message });
      });
      return false;
    }).catch(() => false).finally(() => {
      if (this.tradeFlight === flight) {
        this.tradeFlight = null;
        this.publish({ tradeBusy: false });
      }
    });
    this.tradeFlight = flight;
    return flight;
  }

  submitTrade = (
    shopId: ConsignmentRequest['shopId'], command: ConsignmentRequest['command'], claimAsset?: ConsignmentAsset,
  ): Promise<boolean> => this.runTrade(async generation => {
    await this.finishUpload();
    const pending = await this.serial(async () => {
      this.requireTrading();
      if (generation !== this.generation || this.local!.pending) throw new CharacterCommandError('请先核对已有云上传');
      await this.advanceFrame();
      requireMerchant(this.local!.save.character, shopId);
      const request = consignmentRequestSchema.parse({
        characterId: this.local!.characterId, requestId: crypto.randomUUID(),
        baseRevision: this.local!.cloudRevision, save: this.local!.save, shopId, command,
      });
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_SAVE_BYTES) {
        throw new CharacterCommandError('检查点超过寄售接收上限，未发起交易');
      }
      const pendingTrade = reserveTrade(request, this.local!.localRevision, claimAsset);
      await this.persist({ ...this.local!, pendingTrade,
        localRevision: String(BigInt(this.local!.localRevision) + 1n) });
      return pendingTrade;
    });
    return this.resolveTrade(pending, generation, false);
  });

  reconcileTrade = (): Promise<boolean> => {
    if (!this.initialized || !this.local?.pendingTrade || this.state.blocked || this.cloudStopped) return Promise.resolve(false);
    return this.runTrade(generation => this.resolveTrade(this.local!.pendingTrade!, generation, true));
  };

  private async resolveTrade(pending: PendingTrade, generation: number, lookup: boolean): Promise<boolean> {
    let raw: unknown;
    if (lookup) {
      const result = consignmentLookupSchema.parse(await this.request(
        `/api/client/consignment/receipts/${pending.request.requestId}?characterId=${encodeURIComponent(pending.request.characterId)}`,
      ));
      if (generation !== this.generation) return false;
      if (result.status === 'settled') raw = result.receipt;
    }
    if (generation !== this.generation) return false;
    if (raw === undefined) raw = await this.request('/api/client/consignment/command', pending.request);
    return this.serial(async () => {
      if (generation !== this.generation || !this.local || !this.releaseLock || this.state.blocked ||
          this.local.pendingTrade?.request.requestId !== pending.request.requestId) return false;
      let receipt;
      try {
        receipt = consignmentReceiptSchema.parse(raw);
        validateTradeReceipt(pending, receipt);
      } catch {
        await this.stopOnline('寄售回执不匹配，预留与原请求已保留，已停止云上传和新交易');
        return false;
      }
      if (receipt.status === 'rejected') {
        const conflict = ['SAVE_CONFLICT', 'TRADE_CONFLICT', 'IDENTITY_CONFLICT', 'SAVE_REJECTED', 'IDEMPOTENCY_CONFLICT'].includes(receipt.error.code);
        if (conflict) this.cloudStopped = true;
        await this.persist({ ...this.local, pendingTrade: null,
          syncConflict: conflict ? receipt.error.message : this.local.syncConflict,
          localRevision: String(BigInt(this.local.localRevision) + 1n) });
        this.publish({ tradeMessage: receipt.error.message, ...(conflict
          ? { issue: { source: 'cloud' as const, message: receipt.error.message, retryable: false } } : {}) });
        return false;
      }
      const character = applyConsignmentDelta(this.local.save.character, receipt.delta);
      await this.persist({
        ...this.local, pendingTrade: null, cloudRevision: receipt.revision,
        uploadedRevision: pending.localRevision, localRevision: String(BigInt(this.local.localRevision) + 1n),
        save: { ...this.local.save, character, tradeRevision: receipt.tradeRevision },
      });
      this.publish({ lastCloudSave: receipt.settledAt, tradeMessage: '商会已确认',
        ...(this.state.issue?.source === 'cloud' ? { issue: null } : {}) });
      return true;
    });
  }

  private runReincarnation(work: (generation: number) => Promise<boolean>): Promise<boolean> {
    if (this.reincarnationFlight) return this.reincarnationFlight;
    const generation = this.generation;
    this.publish({ reincarnationBusy: true, reincarnationMessage: null });
    const flight = work(generation).catch(async error => {
      await this.serial(async () => {
        if (generation !== this.generation || !this.local || !this.releaseLock) return;
        const message = error instanceof CharacterCommandError || error instanceof RequestError
          ? error.message : this.local.pendingReincarnation
            ? '轮回结果暂未确认，原请求已保留，请稍后核对' : '未能发起轮回，本世进度保留';
        if (error instanceof RequestError && [400, 401, 403, 409, 413, 422].includes(error.status)) {
          await this.stopOnline(message);
        }
        this.publish({ reincarnationMessage: message });
      });
      return false;
    }).catch(() => false).finally(() => {
      if (this.reincarnationFlight === flight) {
        this.reincarnationFlight = null;
        this.publish({ reincarnationBusy: false });
      }
    });
    this.reincarnationFlight = flight;
    return flight;
  }

  submitReincarnation = (): Promise<boolean> => this.runReincarnation(async generation => {
    if (this.tradeFlight) await this.tradeFlight;
    if (generation !== this.generation) return false;
    if (this.local?.pendingTrade) await this.reconcileTrade();
    await this.finishUpload();
    const request = await this.serial(async () => {
      if (generation !== this.generation || !this.initialized || !this.local || this.state.blocked) {
        throw new CharacterCommandError('角色尚未就绪');
      }
      if (this.cloudStopped || this.local.syncConflict) throw new CharacterCommandError('保存状态冲突，不能发起轮回');
      if (this.local.pending || this.local.pendingTrade) throw new CharacterCommandError('请先核对未确认的保存或寄售');
      await this.advanceFrame();
      const request = reincarnationRequestSchema.parse({
        characterId: this.local.characterId, requestId: crypto.randomUUID(),
        baseRevision: this.local.cloudRevision, save: this.local.save,
      });
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_SAVE_BYTES) {
        throw new CharacterCommandError('检查点超过接收上限，未发起轮回');
      }
      await this.persist({ ...this.local, pendingReincarnation: request,
        localRevision: String(BigInt(this.local.localRevision) + 1n) });
      this.publish({ blocked: true, reincarnationMessage: '正在提交轮回，本世已暂停' });
      return request;
    });
    return this.resolveReincarnation(request, generation, false);
  });

  reconcileReincarnation = (): Promise<boolean> => {
    if (!this.initialized || !this.local?.pendingReincarnation || this.cloudStopped ||
        this.state.issue?.source === 'local') return Promise.resolve(false);
    return this.runReincarnation(generation =>
      this.resolveReincarnation(this.local!.pendingReincarnation!, generation, true));
  };

  private async resolveReincarnation(request: ReincarnationRequest, generation: number, lookup: boolean): Promise<boolean> {
    let raw: unknown;
    if (lookup) {
      const result = reincarnationLookupSchema.parse(await this.request(
        `/api/client/reincarnation/receipts/${request.requestId}?characterId=${encodeURIComponent(request.characterId)}`,
      ));
      if (generation !== this.generation) return false;
      if (result.status === 'settled') raw = result.receipt;
    }
    if (generation !== this.generation) return false;
    if (raw === undefined) raw = await this.request('/api/client/reincarnation', request);
    return this.serial(async () => {
      if (generation !== this.generation || !this.local || !this.releaseLock ||
          this.local.pendingReincarnation?.requestId !== request.requestId) return false;
      let receipt;
      try {
        receipt = reincarnationReceiptSchema.parse(raw);
        validateReincarnationReceipt(request, receipt);
      } catch {
        await this.stopOnline('轮回回执不匹配，本世检查点与原请求保留，已停止在线操作');
        return false;
      }
      if (receipt.status === 'rejected') {
        this.cloudStopped = true;
        await this.persist({ ...this.local, pendingReincarnation: null, syncConflict: receipt.error.message,
          wallSavedAt: this.wallNow(), localRevision: String(BigInt(this.local.localRevision) + 1n) });
        this.lastFrame = this.monotonicNow();
        this.publish({ blocked: false, reincarnationMessage: receipt.error.message,
          issue: { source: 'cloud', message: receipt.error.message, retryable: false } });
        return false;
      }
      const revision = String(BigInt(this.local.localRevision) + 1n);
      await this.persist({
        ...this.local, save: receipt.save, pendingReincarnation: null,
        cloudRevision: receipt.revision, localRevision: revision, uploadedRevision: revision,
        wallSavedAt: this.wallNow(),
      });
      this.lastFrame = this.monotonicNow();
      this.publish({ blocked: false, issue: null, lastCloudSave: receipt.settledAt,
        reincarnationMessage: `轮回已定，现为第${receipt.save.character.life.number}世` });
      return true;
    });
  }

  debugCommand = (command: DebugCommand): Promise<boolean> => {
    if (!import.meta.env.DEV) return Promise.resolve(false);
    return this.runAction(async state => {
      const { executeDebugCommand } = await import('../core/prototype/debug');
      return executeDebugCommand(state, command);
    });
  };

  sync = (): Promise<void> => {
    if (this.cloudFlight) return this.cloudFlight;
    if (!this.initialized || this.state.blocked || this.cloudStopped || this.local?.pendingTrade ||
        this.local?.pendingReincarnation ||
        ((this.tradeFlight || this.reincarnationFlight) && !this.local?.pending)) return Promise.resolve();
    const generation = this.generation;
    this.publish({ refreshing: true });
    const work = async () => {
      try {
        const pending = await this.serial(async () => {
          if (generation !== this.generation || !this.local || !this.releaseLock || this.local.pendingTrade ||
              this.local.pendingReincarnation || this.cloudStopped ||
              ((this.tradeFlight || this.reincarnationFlight) && !this.local.pending)) return null;
          if (!this.local.pending) {
            if (this.local.localRevision === this.local.uploadedRevision) return null;
            await this.persist({
              ...this.local,
              pending: {
                localRevision: this.local.localRevision,
                request: {
                  characterId: this.local.characterId, requestId: crypto.randomUUID(),
                  baseRevision: this.local.cloudRevision, save: this.local.save,
                },
              },
            }, false);
          }
          return this.local!.pending;
        });
        if (!pending) return;
        if (new TextEncoder().encode(JSON.stringify(pending.request)).byteLength > MAX_SAVE_BYTES) {
          throw new RequestError('存档超过云端接收上限，本地进度保留', 413);
        }
        const ack = uploadAckSchema.parse(await this.request('/api/client/save', pending.request));
        if (ack.characterId !== pending.request.characterId || ack.requestId !== pending.request.requestId ||
            BigInt(ack.revision) !== BigInt(pending.request.baseRevision) + 1n) throw new Error('云存档回执不匹配');
        await this.serial(async () => {
          if (generation !== this.generation || !this.local || !this.releaseLock || this.local.pending?.request.requestId !== pending.request.requestId) return;
          await this.persist({
            ...this.local, cloudRevision: ack.revision, uploadedRevision: pending.localRevision, pending: null,
          }, false);
          this.publish({ lastCloudSave: ack.savedAt, ...(this.state.issue?.source === 'cloud' ? { issue: null } : {}) });
        });
      } catch (error) {
        if (generation !== this.generation) return;
        if (error instanceof RequestError && [400, 401, 403, 409, 413, 422].includes(error.status)) this.cloudStopped = true;
        if (this.cloudStopped) this.publish({ tradeStopped: true });
        if (this.state.issue?.source !== 'local') this.publish({
          issue: {
            source: 'cloud', retryable: !this.cloudStopped,
            message: error instanceof RequestError ? error.message : '云备份未完成，本地进度保留，将稍后重试',
          },
        });
      } finally { if (generation === this.generation) this.publish({ refreshing: false }); }
    };
    const flight = work().finally(() => { if (this.cloudFlight === flight) this.cloudFlight = null; });
    this.cloudFlight = flight;
    return flight;
  };

  private scheduleTick(generation: number) {
    if (!this.active || generation !== this.generation) return;
    this.tickTimer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleTick(generation));
    }, 1000);
  }
  private scheduleCloud(generation: number) {
    if (!this.active || generation !== this.generation) return;
    this.cloudTimer = setTimeout(() => {
      void Promise.all([this.refreshWorldTime(), this.local?.pendingReincarnation ? this.reconcileReincarnation()
        : this.local?.pendingTrade ? this.reconcileTrade() : this.sync()])
        .finally(() => this.scheduleCloud(generation));
    }, this.cloudIntervalMs);
  }
  start = () => {
    this.active = true;
    const generation = ++this.generation;
    void this.initialize().then(() => {
      this.scheduleTick(generation);
      this.scheduleCloud(generation);
      if (generation === this.generation) {
        void this.refreshWorldTime();
        if (this.local?.pendingReincarnation) void this.reconcileReincarnation();
        else if (this.local?.pendingTrade) void this.reconcileTrade();
      }
    });
    return this.stop;
  };
  stop = () => {
    this.active = false;
    this.generation++;
    clearTimeout(this.tickTimer);
    clearTimeout(this.cloudTimer);
    this.cloudFlight = null;
    this.timeFlight = null;
    this.tradeFlight = null;
    this.reincarnationFlight = null;
    this.publish({ refreshing: false, tradeBusy: false, reincarnationBusy: false });
    void this.serial(async () => {
      this.releaseLock?.();
      this.releaseLock = null;
      this.initialized = false;
      this.local = null;
    });
  };
  retry = async () => {
    if (this.state.issue?.source === 'action') { this.publish({ issue: null }); return; }
    if (this.local?.pendingReincarnation && this.state.issue?.source !== 'local') {
      await this.reconcileReincarnation();
      return;
    }
    if (!this.initialized || this.state.blocked) {
      await this.serial(async () => { this.releaseLock?.(); this.releaseLock = null; this.initialized = false; });
      await this.initialize();
      if (this.local?.pendingReincarnation) await this.reconcileReincarnation();
    } else if (this.local?.pendingTrade) await this.reconcileTrade();
    else await this.sync();
  };
  refresh = this.sync;
  dismissIssue = () => { if (!this.state.blocked) this.publish({ issue: null }); };
}
