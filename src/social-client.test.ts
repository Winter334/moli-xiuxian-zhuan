import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialClient } from './social-client';
import type { GameClient } from './game-client';
import { createCharacter, getCharacterView } from '../core/prototype';
import type { SocialClientMessage, SocialServerMessage } from '../shared/social';
import { EMPTY_PVP } from '../shared/pvp';

class Socket {
  readyState = 0;
  sent: SocialClientMessage[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(value: string) {
    const message = JSON.parse(value) as SocialClientMessage;
    this.sent.push(message);
    if (message.type === 'history') this.receive({ type: 'result', requestId: message.requestId, data: { messages: [], hasMore: false } });
  }
  receive(message: SocialServerMessage) { this.onmessage?.({ data: JSON.stringify(message) }); }
  open() { this.readyState = 1; this.onopen?.(); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
}
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(stop => stop()); vi.useRealTimers(); });
async function setup(credentials?: () => Promise<{ token: string; characterId: string; expiresAt: number }>, ready = true) {
  vi.useFakeTimers();
  const listeners = new Set<() => void>();
  const state = { response: { characterId: '00000000-0000-4000-8000-000000000001',
    game: getCharacterView(createCharacter(Date.now(), 9)) }, blocked: false, recoveryBusy: false, reincarnationBusy: false,
    onlineReady: true, onlineMessage: null as string | null };
  const game = { getSnapshot: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    getPublicCharacter: vi.fn(), prepareOnlineConnection: async () => '0', getPendingBattleId: () => null,
    updatePvpState: vi.fn(),
    blockOnlineSource: vi.fn(async (message: string) => {
      state.onlineReady = false; state.onlineMessage = message; listeners.forEach(fn => fn());
    }) } as unknown as GameClient;
  const sockets: Socket[] = [];
  const client = new SocialClient(game, credentials ?? (async () => ({
    token: 'a'.repeat(43), characterId: state.response.characterId, expiresAt: Date.now() + 600_000,
  })), () => {
    const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket;
  }, () => 'wss://test.invalid/api/client/social');
  cleanup.push(client.start());
  await vi.advanceTimersByTimeAsync(0);
  const socket = sockets[0];
  if (ready) {
    socket.open();
    await vi.advanceTimersByTimeAsync(0);
    socket.receive({ type: 'ready', playerId: 'a'.repeat(32), moderator: false, pvp: { ...EMPTY_PVP } });
    await vi.advanceTimersByTimeAsync(0);
  }
  return { client, socket, sockets, state, listeners };
}
describe('social client lifecycle', () => {
  it('does not attach an obsolete asynchronous connection after an explicit reconnect', async () => {
    const pending: ((session: { token: string; characterId: string; expiresAt: number }) => void)[] = [];
    const { client, sockets, state } = await setup(() => new Promise(resolve => pending.push(resolve)), false);
    client.reconnectNow();
    const session = { token: 'a'.repeat(43), characterId: state.response.characterId, expiresAt: Date.now() + 600_000 };
    pending[1](session);
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    pending[0](session);
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
  });
  it('keeps draft and reuses the same request after an uncertain send, without automatic resend', async () => {
    const { client, socket } = await setup();
    client.setDraft('message');
    const first = client.sendChat();
    const input = socket.sent.find(message => message.type === 'chat')!;
    await vi.advanceTimersByTimeAsync(12_001); await first;
    expect(client.getSnapshot()).toMatchObject({ draft: 'message', sendFailed: true, sending: false });
    expect(socket.sent.filter(message => message.type === 'chat')).toHaveLength(1);
    const retry = client.sendChat();
    const attempts = socket.sent.filter(message => message.type === 'chat');
    expect(attempts[1]).toEqual(input);
    if (input.type !== 'chat') throw new Error('Missing chat request');
    socket.receive({ type: 'result', requestId: input.requestId, data: { id: '1', deleted: false } });
    await retry;
    expect(client.getSnapshot().draft).toBe('');
  });
  it('does not automatically reclaim a session displaced by another device', async () => {
    const { client, socket, sockets } = await setup();
    socket.receive({ type: 'displaced' }); socket.close(4409);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(client.getSnapshot().status).toBe('displaced');
    expect(sockets).toHaveLength(1);
    client.reconnectNow(); await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
  });
  it('keeps network failure out of game state and excludes credentials from the socket URL', async () => {
    const { client, socket, state } = await setup();
    const before = structuredClone(state);
    socket.close(1006);
    expect(client.getSnapshot().status).toBe('offline');
    expect(state).toEqual(before);
    expect(socket.sent[0]).toMatchObject({ type: 'auth', token: 'a'.repeat(43), cloudRevision: '0' });
  });
  it('disconnects and cannot reconnect while cloud verification is missing, then resumes only when admitted', async () => {
    const { client, sockets, state, listeners } = await setup();
    state.onlineReady = false; state.onlineMessage = '采用云端存档后才可联机';
    listeners.forEach(fn => fn());
    expect(client.getSnapshot()).toMatchObject({ status: 'offline', nearby: [], notice: state.onlineMessage });
    client.reconnectNow();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(sockets).toHaveLength(1);
    state.onlineReady = true; state.onlineMessage = null; listeners.forEach(fn => fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
  });
  it('stops online access instead of retrying a server-rejected cloud revision', async () => {
    const { socket, sockets, state } = await setup();
    socket.close(4410);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(state.onlineReady).toBe(false);
    expect(sockets).toHaveLength(1);
  });
});
