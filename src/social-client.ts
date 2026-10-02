import {
  CHAT_TEXT_LIMIT, SOCIAL_HEARTBEAT_MS, SOCIAL_PROTOCOL, chatHistorySchema, chatReceiptSchema, chatTextSchema,
  socialServerMessageSchema,
  type ChatMessage, type NearbyPlayer, type PlayerInteractionId,
  type SocialClientMessage, type SocialServerMessage, type presenceSchema,
} from '../shared/social';
import type { z } from 'zod';
import type { GameClient } from './game-client';
import { playerInteractionProviders } from './player-interactions';

export interface SocialState {
  status: 'unavailable' | 'connecting' | 'online' | 'offline' | 'displaced';
  playerId: string | null; moderator: boolean; nearby: NearbyPlayer[]; messages: ChatMessage[];
  hasMore: boolean; loading: boolean; sending: boolean; sendFailed: boolean;
  notice: string | null; draft: string; unread: number; mutedUntil: number;
}
export const DISABLED_SOCIAL: SocialState = {
  status: 'unavailable', playerId: null, moderator: false, nearby: [], messages: [], hasMore: false,
  loading: false, sending: false, sendFailed: false, notice: null, draft: '', unread: 0, mutedUntil: 0,
};
type Credentials = { token: string; characterId: string; expiresAt: number };
type Presence = z.infer<typeof presenceSchema>;
interface Request {
  resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>;
}
const networkIssue = () => new Error('连接已中断，请稍后重试。');
const order = (a: ChatMessage, b: ChatMessage) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0;

export class SocialClient {
  private state: SocialState = { ...DISABLED_SOCIAL, status: 'offline' };
  private readonly listeners = new Set<() => void>();
  private readonly requests = new Map<string, Request>();
  private readonly deleted = new Set<string>();
  private readonly providers: ReturnType<typeof playerInteractionProviders>;
  private socket: WebSocket | null = null;
  private active = false;
  private displaced = false;
  private generation = 0;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private renewal: ReturnType<typeof setTimeout> | undefined;
  private authTimeout: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private lastPresence = '';
  private pendingChat: { requestId: string; text: string } | null = null;
  private reading = false;
  private following = true;

  constructor(private readonly game: GameClient, private readonly credentials: (renew?: boolean) => Promise<Credentials>,
    private readonly socketFactory = (url: string) => new WebSocket(url),
    private readonly url = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/client/social`) {
    this.providers = playerInteractionProviders(game);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(change: Partial<SocialState>) {
    this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener());
  }
  private presence(): Presence | null {
    const state = this.game.getSnapshot();
    const game = state.response?.game;
    if (!game || state.blocked || state.recoveryBusy || state.reincarnationBusy) return null;
    return {
      locationId: game.locationId, level: game.level,
      activity: game.battle ? 'combat' : game.training ? 'training' : game.gathering ? 'gathering'
        : game.mode === 'sleep' ? 'meditation' : game.mode === 'rest' ? 'rest' : 'idle',
    };
  }
  start = () => {
    this.active = true; this.generation++;
    const stop = this.game.subscribe(this.update);
    this.update();
    return () => {
      this.active = false; this.generation++; stop(); this.clearTimers();
      this.socket?.close(); this.socket = null; this.rejectRequests();
    };
  };
  private clearTimers() {
    clearTimeout(this.reconnect); clearInterval(this.heartbeat);
    clearTimeout(this.renewal); clearTimeout(this.authTimeout);
    this.reconnect = undefined; this.heartbeat = undefined; this.renewal = undefined; this.authTimeout = undefined;
  }
  private rejectRequests() {
    for (const item of this.requests.values()) { clearTimeout(item.timer); item.reject(networkIssue()); }
    this.requests.clear();
  }
  private update = () => {
    if (!this.active) return;
    const presence = this.presence();
    if (!presence) {
      this.generation++;
      this.clearTimers(); this.socket?.close(); this.socket = null;
      this.rejectRequests(); this.publish({ status: 'offline', nearby: [] });
      return;
    }
    if (!this.socket && !this.reconnect && !this.displaced) { void this.connect(); return; }
    const signature = JSON.stringify(presence);
    if (this.state.status === 'online' && signature !== this.lastPresence) {
      this.lastPresence = signature; this.send({ type: 'presence', presence });
    }
  };
  private async connect(renew = false) {
    if (!this.active || this.displaced || !this.presence()) return;
    const generation = this.generation;
    // Reserve the connection attempt while login is asynchronous.
    this.reconnect = setTimeout(() => {}, 60_000);
    this.publish({ status: 'connecting', notice: null });
    try {
      const session = await this.credentials(renew);
      if (!this.active || generation !== this.generation || !this.presence()) return;
      clearTimeout(this.reconnect); this.reconnect = undefined;
      const socket = this.socketFactory(this.url());
      this.socket = socket;
      this.authTimeout = setTimeout(() => socket.close(), 12_000);
      socket.onopen = () => {
        const presence = this.presence();
        if (!presence || this.socket !== socket) { socket.close(); return; }
        this.lastPresence = JSON.stringify(presence);
        this.send({ type: 'auth', protocol: SOCIAL_PROTOCOL, token: session.token, characterId: session.characterId, presence });
      };
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        try {
          const parsed = socialServerMessageSchema.safeParse(JSON.parse(String(event.data)));
          if (!parsed.success) { socket.close(); return; }
          this.receive(parsed.data);
        } catch { socket.close(); }
      };
      socket.onerror = () => socket.close();
      socket.onclose = event => {
        if (this.socket !== socket) return;
        this.socket = null; this.clearTimers(); this.rejectRequests();
        this.publish({ status: this.displaced ? 'displaced' : 'offline', nearby: [], moderator: false, sending: false });
        if (this.active && !this.displaced && this.presence()) {
          this.reconnect = setTimeout(() => {
            this.reconnect = undefined; void this.connect(event.code === 4401 && session.expiresAt <= Date.now() + 60_000);
          }, Math.min(30_000, 1000 * 2 ** Math.min(this.retries++, 5)));
        }
      };
      this.renewal = setTimeout(() => socket.close(1000, 'Renewing session'), Math.max(1000, session.expiresAt - Date.now() - 60_000));
    } catch {
      if (this.active && generation === this.generation) {
        clearTimeout(this.reconnect);
        this.publish({ status: 'offline', notice: '社交连接暂不可用，本地游玩不受影响。' });
        this.reconnect = setTimeout(() => { this.reconnect = undefined; void this.connect(); }, 15_000);
      }
    }
  }
  private send(message: SocialClientMessage) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }
  private request(message: SocialClientMessage & { requestId: string }): Promise<unknown> {
    if (this.state.status !== 'online' || this.socket?.readyState !== 1) return Promise.reject(networkIssue());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(message.requestId); reject(new Error('请求暂未确认，请重试。')); }, 12_000);
      this.requests.set(message.requestId, { resolve, reject, timer }); this.send(message);
    });
  }
  private merge(messages: ChatMessage[], replace = false) {
    const old = replace ? this.state.messages.filter(item => messages.length && BigInt(item.id) > BigInt(messages[messages.length - 1].id)) : this.state.messages;
    const byId = new Map([...old, ...messages].filter(item => !this.deleted.has(item.id)).map(item => [item.id, item]));
    this.publish({ messages: [...byId.values()].sort(order).slice(-2000) });
  }
  private receive(message: SocialServerMessage) {
    if (message.type === 'ready') {
      clearTimeout(this.authTimeout); this.retries = 0;
      this.publish({ status: 'online', playerId: message.playerId, moderator: message.moderator, notice: null });
      this.heartbeat = setInterval(() => {
        const presence = this.presence();
        if (presence) this.send({ type: 'presence', presence }); else this.update();
      }, SOCIAL_HEARTBEAT_MS);
      void this.loadLatest();
    } else if (message.type === 'nearby') this.publish({ nearby: message.players });
    else if (message.type === 'chat') {
      const newMessage = !this.state.messages.some(item => item.id === message.message.id) && !this.deleted.has(message.message.id);
      this.merge([message.message]);
      if (newMessage && message.message.playerId !== this.state.playerId && (!this.reading || !this.following)) {
        this.publish({ unread: this.state.unread + 1 });
      }
    } else if (message.type === 'deleted') {
      this.deleted.add(message.id); this.publish({ messages: this.state.messages.filter(item => item.id !== message.id) });
    } else if (message.type === 'muted') {
      this.publish({ mutedUntil: message.until, notice: message.until > Date.now() ? '当前处于禁言期间。' : '禁言已解除。' });
    } else if (message.type === 'displaced') {
      this.displaced = true;
      this.publish({ status: 'displaced', notice: '另一设备已接入社交，当前设备不再展示位置。' });
    } else if (message.type === 'interaction-request') {
      try { this.send({ type: 'interaction-reply', requestId: message.requestId, data: this.providers[message.action]() }); }
      catch { this.send({ type: 'interaction-reply', requestId: message.requestId, data: null }); }
    } else if (message.type === 'result' || message.type === 'error') {
      const id = message.type === 'result' ? message.requestId : message.requestId;
      const request = id ? this.requests.get(id) : undefined;
      if (request) {
        this.requests.delete(id!); clearTimeout(request.timer);
        if (message.type === 'result') request.resolve(message.data); else request.reject(new Error(message.message));
      } else if (message.type === 'error') this.publish({ notice: message.message });
    }
  }
  private async loadLatest() {
    this.publish({ loading: true });
    try {
      const result = chatHistorySchema.parse(await this.request({ type: 'history', requestId: crypto.randomUUID() }));
      this.merge(result.messages, true); this.publish({ hasMore: result.hasMore });
    } catch (error) { this.publish({ notice: error instanceof Error ? error.message : '消息读取失败。' }); }
    finally { this.publish({ loading: false }); }
  }
  loadOlder = async () => {
    if (this.state.loading || !this.state.hasMore || !this.state.messages.length) return;
    this.publish({ loading: true });
    try {
      const result = chatHistorySchema.parse(await this.request({
        type: 'history', requestId: crypto.randomUUID(), before: this.state.messages[0].id,
      }));
      this.merge(result.messages); this.publish({ hasMore: result.hasMore && this.state.messages.length < 2000 });
    } catch (error) { this.publish({ notice: error instanceof Error ? error.message : '消息读取失败。' }); }
    finally { this.publish({ loading: false }); }
  };
  setDraft = (draft: string) => {
    if (this.state.sending) return;
    if (this.pendingChat?.text !== draft.trim()) this.pendingChat = null;
    this.publish({ draft: draft.slice(0, CHAT_TEXT_LIMIT), sendFailed: Boolean(this.pendingChat) });
  };
  sendChat = async () => {
    if (this.state.sending) return;
    const parsed = chatTextSchema.safeParse(this.state.draft);
    if (!parsed.success) return;
    this.pendingChat ??= { requestId: crypto.randomUUID(), text: parsed.data };
    const pending = this.pendingChat;
    this.publish({ sending: true, notice: null });
    try {
      chatReceiptSchema.parse(await this.request({ type: 'chat', ...pending }));
      if (this.pendingChat === pending) this.pendingChat = null;
      this.publish({ draft: '', sendFailed: false });
    } catch (error) {
      this.publish({ sendFailed: true, notice: error instanceof Error ? error.message : '消息暂未确认。' });
    } finally { this.publish({ sending: false }); }
  };
  interact = (action: PlayerInteractionId, target: string, fresh = false): Promise<unknown> =>
    this.request({ type: 'interaction', requestId: crypto.randomUUID(), action, target, fresh });
  moderate = async (operation: Omit<Extract<SocialClientMessage, { type: 'moderate' }>, 'type' | 'requestId'>) => {
    try { await this.request({ type: 'moderate', requestId: crypto.randomUUID(), ...operation }); this.publish({ notice: '操作已完成。' }); }
    catch (error) { this.publish({ notice: error instanceof Error ? error.message : '操作未完成。' }); }
  };
  setReading = (reading: boolean, following = this.following) => {
    this.reading = reading; this.following = following;
    if (reading && following && this.state.unread) this.publish({ unread: 0 });
  };
  reconnectNow = () => {
    this.generation++; this.displaced = false; this.clearTimers(); this.reconnect = undefined;
    const old = this.socket; this.socket = null; old?.close();
    this.rejectRequests(); void this.connect();
  };
}
