import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { REGIONS, SAFE_LOCATIONS } from '../../core/prototype/content';
import { LEVEL_CAP, realmName } from '../../core/prototype/growth';
import { PLAYER_INTERACTIONS, SOCIAL_TIMEOUT_MS, socialClientMessageSchema,
  type NearbyPlayer, type PlayerInteractionId, type SocialClientMessage, type SocialServerMessage } from '../../shared/social';
import type { PublicPlayerProfile } from '../../shared/player-profile';
import { ApiError } from '../errors';
import { playerInteractionHandlers } from './player-interactions';
import type { SocialStore } from './social-store';

export interface SocialIdentity {
  characterId: string; userId: string; expiresAt: number; profile: PublicPlayerProfile;
}
interface Peer {
  socket: WebSocket; identity: SocialIdentity; player: NearbyPlayer;
  locationId: string; seenAt: number; moderator: boolean;
}
interface PendingInteraction {
  source: Peer; target: Peer; action: PlayerInteractionId; timer: ReturnType<typeof setTimeout>;
  resolve: (value: { data: unknown; capturedAt: number }) => void; reject: (reason: Error) => void;
}
const unavailable = () => new ApiError(409, 'PLAYER_UNAVAILABLE', '对方已离开或不在线。');

export class SocialHub {
  private readonly peers = new Map<string, Peer>();
  private readonly pending = new Map<string, PendingInteraction>();
  private readonly cache = new Map<string, { data: unknown; capturedAt: number; peer: Peer }>();
  private readonly sockets = new Set<WebSocket>();
  constructor(private readonly identity: (token: string) => Promise<SocialIdentity | null>,
    private readonly store: SocialStore, private readonly applicationId: string,
    private readonly moderators: ReadonlySet<string>, private readonly now = Date.now) {}

  private send(socket: WebSocket, message: SocialServerMessage) {
    if (socket.readyState !== 1) return;
    if (socket.bufferedAmount > 256 * 1024) { socket.terminate(); return; }
    socket.send(JSON.stringify(message));
  }
  private broadcast(message: SocialServerMessage) {
    for (const peer of this.peers.values()) this.send(peer.socket, message);
  }
  private refreshNearby(locationId: string) {
    const peers = [...this.peers.values()].filter(peer => peer.locationId === locationId);
    for (const peer of peers) this.send(peer.socket, {
      type: 'nearby', players: peers.filter(other => other !== peer).map(other => other.player),
    });
  }
  private disconnect(peer: Peer) {
    if (this.peers.get(peer.player.playerId) !== peer) return;
    this.peers.delete(peer.player.playerId);
    for (const [key, item] of this.cache) if (item.peer === peer) this.cache.delete(key);
    for (const [id, request] of this.pending) {
      if (request.source !== peer && request.target !== peer) continue;
      this.pending.delete(id); clearTimeout(request.timer); request.reject(unavailable());
    }
    this.refreshNearby(peer.locationId);
  }
  private checkPeer(peer: Peer) {
    if (this.peers.get(peer.player.playerId) !== peer || peer.identity.expiresAt <= this.now() ||
        this.now() - peer.seenAt > SOCIAL_TIMEOUT_MS) throw unavailable();
  }
  private targetFor(source: Peer, id: string) {
    this.checkPeer(source);
    const target = this.peers.get(id);
    if (!target || source === target || target.locationId !== source.locationId) throw unavailable();
    this.checkPeer(target);
    return target;
  }
  private setPresence(peer: Peer, presence: Extract<SocialClientMessage, { type: 'presence' }>['presence']) {
    if ((!Object.hasOwn(REGIONS, presence.locationId) && !Object.hasOwn(SAFE_LOCATIONS, presence.locationId)) ||
        presence.level > LEVEL_CAP) throw new ApiError(400, 'INVALID_PRESENCE', '地点或境界信息无效。');
    const old = peer.locationId;
    const changed = old !== presence.locationId || peer.player.realmName !== realmName(presence.level) ||
      peer.player.activity !== presence.activity;
    peer.locationId = presence.locationId;
    peer.player = { ...peer.player, realmName: realmName(presence.level), activity: presence.activity, updatedAt: this.now() };
    if (changed) {
      for (const [key, item] of this.cache) if (item.peer === peer) this.cache.delete(key);
      this.refreshNearby(old);
      if (old !== peer.locationId) this.refreshNearby(peer.locationId);
    }
  }
  private requestTarget(source: Peer, target: Peer, action: PlayerInteractionId, fresh: boolean) {
    const key = `${target.player.playerId}:${action}`;
    const cached = this.cache.get(key);
    if (!fresh && cached?.peer === target && this.now() - cached.capturedAt < 15_000) return Promise.resolve(cached);
    if (this.pending.size >= 256) throw new ApiError(429, 'INTERACTION_BUSY', '当前查看请求较多，请稍后重试。');
    return new Promise<{ data: unknown; capturedAt: number }>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ApiError(504, 'PLAYER_TIMEOUT', '对方暂未响应，请稍后刷新。'));
      }, 8000);
      this.pending.set(id, { source, target, action, timer, resolve, reject });
      this.send(target.socket, { type: 'interaction-request', requestId: id, action });
    });
  }

  accept(socket: WebSocket) {
    if (this.sockets.size >= 1000) { socket.close(1013, 'Busy'); return; }
    this.sockets.add(socket);
    let peer: Peer | null = null;
    let closed = false;
    let queue = Promise.resolve();
    let queued = 0;
    let windowStart = this.now();
    let messages = 0;
    const authTimer = setTimeout(() => socket.close(4401, 'Authentication required'), 5000);
    const fail = (error: unknown, requestId?: string) => this.send(socket, {
      type: 'error', ...(requestId ? { requestId } : {}),
      message: error instanceof ApiError ? error.message : '社交服务暂不可用，请稍后重试。',
    });
    const handle = async (message: SocialClientMessage) => {
      if (closed) return;
      if (!peer) {
        if (message.type !== 'auth') { socket.close(4401, 'Authentication required'); return; }
        const verified = await this.identity(message.token);
        if (closed) return;
        if (!verified || verified.characterId !== message.characterId) { socket.close(4401, 'Identity rejected'); return; }
        const playerId = createHash('sha256').update(`${this.applicationId}:${verified.characterId}`).digest('hex').slice(0, 32);
        peer = {
          socket, identity: verified, locationId: '', seenAt: this.now(), moderator: this.moderators.has(verified.userId),
          player: { playerId, ...verified.profile, realmName: '', activity: 'idle',
            interactions: PLAYER_INTERACTIONS.map(entry => entry.id), updatedAt: this.now() },
        };
        // Validate before displacing an existing, valid device.
        this.setPresence(peer, message.presence);
        const previous = this.peers.get(playerId);
        if (previous) {
          this.send(previous.socket, { type: 'displaced' });
          this.disconnect(previous); previous.socket.close(4409, 'Another device is active');
        }
        this.peers.set(playerId, peer);
        clearTimeout(authTimer);
        this.send(socket, { type: 'ready', playerId, moderator: peer.moderator });
        this.refreshNearby(peer.locationId);
        return;
      }
      this.checkPeer(peer);
      peer.seenAt = this.now();
      if (message.type === 'ping') { this.send(socket, { type: 'pong' }); return; }
      if (message.type === 'presence') { this.setPresence(peer, message.presence); return; }
      if (message.type === 'auth') throw new ApiError(400, 'ALREADY_AUTHENTICATED', '请重新建立连接以更新身份。');
      if (message.type === 'interaction-reply') {
        const request = this.pending.get(message.requestId);
        if (!request || request.target !== peer) return;
        const definition = PLAYER_INTERACTIONS.find(entry => entry.id === request.action)!;
        const parsed = definition.response.safeParse(message.data);
        this.pending.delete(message.requestId); clearTimeout(request.timer);
        try {
          if (!parsed.success || this.targetFor(request.source, peer.player.playerId) !== peer) throw unavailable();
          const snapshot = { data: parsed.data, capturedAt: this.now(), peer };
          this.cache.set(`${peer.player.playerId}:${request.action}`, snapshot);
          request.resolve(snapshot);
        } catch (error) { request.reject(error instanceof Error ? error : unavailable()); }
        return;
      }
      if (message.type === 'history') {
        this.send(socket, { type: 'result', requestId: message.requestId, data: await this.store.history(message.before, message.after) });
      } else if (message.type === 'chat') {
        const receipt = await this.store.post(peer.player, message.requestId, message.text);
        this.send(socket, { type: 'result', requestId: message.requestId, data: { id: receipt.id, deleted: receipt.deleted } });
        if (receipt.fresh && receipt.message) this.broadcast({ type: 'chat', message: receipt.message });
      } else if (message.type === 'interaction') {
        const target = this.targetFor(peer, message.target);
        const definition = PLAYER_INTERACTIONS.find(entry => entry.id === message.action)!;
        if (definition.scope !== 'same-location') throw unavailable();
        const source = peer;
        const data = await playerInteractionHandlers[message.action]({
          target: target.player,
          requestTarget: action => this.requestTarget(source, target, action, Boolean(message.fresh)),
        });
        this.targetFor(source, target.player.playerId);
        this.send(socket, { type: 'result', requestId: message.requestId, data });
      } else if (message.type === 'moderate') {
        if (!peer.moderator) throw new ApiError(403, 'NOT_MODERATOR', '没有频道管理权限。');
        if (message.action === 'delete') {
          if (!message.messageId) throw new ApiError(400, 'INVALID_MODERATION', '未指定消息。');
          await this.store.deleteMessage(message.messageId);
          this.broadcast({ type: 'deleted', id: message.messageId });
        } else {
          if (!message.target || message.target === peer.player.playerId) throw new ApiError(400, 'INVALID_MODERATION', '未指定其他玩家。');
          const until = message.action === 'unmute' ? 0 : this.now() + (message.minutes ?? 60) * 60_000;
          await this.store.mute(message.target, until);
          const target = this.peers.get(message.target);
          if (target) this.send(target.socket, { type: 'muted', until });
        }
        this.send(socket, { type: 'result', requestId: message.requestId, data: {} });
      }
    };
    // Attach listeners before the first async identity lookup.
    socket.on('message', (raw, binary) => {
      if (this.now() - windowStart > 60_000) { windowStart = this.now(); messages = 0; }
      if (binary || ++messages > 120 || queued >= 16) { socket.close(1008, 'Message limit'); return; }
      let parsed: ReturnType<typeof socialClientMessageSchema.safeParse>;
      try { parsed = socialClientMessageSchema.safeParse(JSON.parse(raw.toString())); }
      catch { socket.close(1008, 'Invalid message'); return; }
      if (!parsed.success) { socket.close(1008, 'Invalid message'); return; }
      const message = parsed.data;
      if (peer && ['ping', 'presence', 'interaction-reply'].includes(message.type)) {
        void handle(message).catch(error => fail(error));
        return;
      }
      queued++;
      queue = queue.then(() => handle(message)).catch(error => {
        fail(error, 'requestId' in message ? message.requestId : undefined);
        if (!peer || message.type === 'auth') socket.close(4401, 'Authentication rejected');
      }).finally(() => { queued--; });
    });
    socket.on('close', () => {
      closed = true; clearTimeout(authTimer); this.sockets.delete(socket);
      if (peer) this.disconnect(peer);
    });
    socket.on('error', () => socket.terminate());
  }
  sweep() {
    for (const peer of this.peers.values()) {
      if (peer.identity.expiresAt <= this.now() || this.now() - peer.seenAt > SOCIAL_TIMEOUT_MS) {
        this.disconnect(peer); peer.socket.close(4401, 'Session expired or heartbeat lost');
      }
    }
  }
  close() {
    for (const peer of [...this.peers.values()]) this.disconnect(peer);
    for (const socket of this.sockets) socket.terminate();
  }
}

export async function registerSocial(app: FastifyInstance, options: {
  applicationId: string; identity: (token: string) => Promise<SocialIdentity | null>; store: SocialStore; moderators: ReadonlySet<string>;
}) {
  await app.register(websocket, { options: { maxPayload: 32 * 1024 } });
  const hub = new SocialHub(options.identity, options.store, options.applicationId, options.moderators);
  app.get('/api/client/social', {
    websocket: true,
    preValidation: async request => {
      if (request.headers.origin !== `https://${options.applicationId}.discordsays.com`) {
        throw new ApiError(403, 'ORIGIN_REJECTED', '请从此应用的 Discord Activity 入口访问。');
      }
    },
  }, socket => hub.accept(socket));
  const sweep = setInterval(() => hub.sweep(), 15_000);
  const prune = setInterval(() => { void options.store.prune().catch(() => console.error('Chat retention cleanup failed')); }, 60 * 60_000);
  sweep.unref(); prune.unref();
  app.addHook('preClose', async () => { clearInterval(sweep); clearInterval(prune); hub.close(); });
  return hub;
}
