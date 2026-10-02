import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { createCharacter } from '../../core/prototype/character-state';
import { publicCharacterInfo } from '../../src/public-player';
import { publicCharacterSchema, SOCIAL_PROTOCOL, type ChatMessage, type SocialServerMessage } from '../../shared/social';
import { registerSocial, type SocialIdentity } from '../../server/client/social';
import type { SocialStore } from '../../server/client/social-store';
import { ApiError } from '../../server/errors';

class MemoryChat implements SocialStore {
  messages: ChatMessage[] = [];
  receipts = new Map<string, { id: string; deleted: boolean; message: ChatMessage | null; fresh: boolean }>();
  async history() { return { messages: [...this.messages], hasMore: false }; }
  async post(player: Pick<ChatMessage, 'playerId' | 'name' | 'avatarUrl'>, requestId: string, text: string) {
    const key = `${player.playerId}:${requestId}`;
    const previous = this.receipts.get(key);
    if (previous) return { ...previous, fresh: false };
    const message = { ...player, id: String(this.receipts.size + 1), text, createdAt: Date.now() };
    this.messages.push(message);
    const receipt = { id: message.id, deleted: false, message, fresh: true };
    this.receipts.set(key, receipt);
    return receipt;
  }
  async deleteMessage(id: string) {
    this.messages = this.messages.filter(item => item.id !== id);
    for (const [key, value] of this.receipts) if (value.id === id) this.receipts.set(key, { ...value, deleted: true, message: null });
  }
  async mute() {}
  async prune() {}
}
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function mailbox(socket: WebSocket) {
  const items: SocialServerMessage[] = [];
  socket.on('message', data => items.push(JSON.parse(data.toString())));
  return async (test: (message: SocialServerMessage) => boolean) => {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const index = items.findIndex(test);
      if (index !== -1) return items.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Missing message; received: ${JSON.stringify(items)}`);
  };
}
async function setup() {
  const app = Fastify();
  apps.push(app);
  const identities = new Map<string, SocialIdentity>();
  const revisions = new Map<string, string>();
  const store = new MemoryChat();
  const hub = await registerSocial(app, { applicationId: '123456789012345678',
    identity: async token => identities.get(token) ?? null, store, moderators: new Set(['100000000000000001']),
    cloudRevision: async characterId => revisions.get(characterId) ?? '0' });
  await app.ready();
  const open = async (index: number, locationId = 'qingshi-village') => {
    const token = String(index).padStart(43, 'a');
    const characterId = randomUUID();
    identities.set(token, { characterId, userId: `10000000000000000${index}`, expiresAt: Date.now() + 600_000,
      profile: { name: `Player ${index}`, avatarUrl: null } });
    const socket = await app.injectWS('/api/client/social', { headers: { origin: 'https://123456789012345678.discordsays.com' } });
    const take = mailbox(socket);
    const auth = { type: 'auth', protocol: SOCIAL_PROTOCOL, token, characterId, cloudRevision: '0',
      presence: { locationId, level: 0, activity: 'idle' } };
    socket.send(JSON.stringify(auth));
    const ready = await take(item => item.type === 'ready') as Extract<SocialServerMessage, { type: 'ready' }>;
    return { socket, take, ready, auth };
  };
  return { app, identities, revisions, store, hub, open };
}
describe('social boundaries', () => {
  it('rejects foreign origins and never sends public data before identity verification', async () => {
    const { app } = await setup();
    await expect(app.injectWS('/api/client/social', { headers: { origin: 'https://another.example' } })).rejects.toThrow();
    const socket = await app.injectWS('/api/client/social', { headers: { origin: 'https://123456789012345678.discordsays.com' } });
    const closed = new Promise<number>(resolve => socket.on('close', resolve));
    socket.send(JSON.stringify({ type: 'ping' }));
    expect(await closed).toBe(4401);
  });
  it('shows only same-location peers, follows movement and prevents a displaced device from reclaiming presence', async () => {
    const { app, open } = await setup();
    const a = await open(1);
    const b = await open(2);
    await open(3, 'hillside-market');
    const nearby = await a.take(item => item.type === 'nearby' && item.players.length === 1);
    expect(nearby).toMatchObject({ players: [{ playerId: b.ready.playerId, name: 'Player 2' }] });
    const replacement = await app.injectWS('/api/client/social', { headers: { origin: 'https://123456789012345678.discordsays.com' } });
    const take = mailbox(replacement);
    replacement.send(JSON.stringify(b.auth));
    await take(item => item.type === 'ready');
    await b.take(item => item.type === 'displaced');
    replacement.send(JSON.stringify({ type: 'presence', presence: { locationId: 'hillside-market', level: 0, activity: 'idle' } }));
    await a.take(item => item.type === 'nearby' && item.players.length === 0);
    replacement.close();
  });
  it('rejects a stale cloud revision without displacing a valid online device', async () => {
    const { app, open, revisions } = await setup();
    const active = await open(1), other = await open(2);
    revisions.set(active.auth.characterId, '1');
    const socket = await app.injectWS('/api/client/social', { headers: { origin: 'https://123456789012345678.discordsays.com' } });
    const take = mailbox(socket);
    const closed = new Promise<number>(resolve => socket.on('close', resolve));
    socket.send(JSON.stringify(active.auth));
    expect(await take(message => message.type === 'error')).toMatchObject({ message: expect.stringContaining('云端存档') });
    expect(await closed).toBe(4410);
    const requestId = randomUUID();
    active.socket.send(JSON.stringify({ type: 'chat', requestId, text: 'still online' }));
    await active.take(message => message.type === 'result' && message.requestId === requestId);
    await other.take(message => message.type === 'chat' && message.message.text === 'still online');
  });
  it('relays concurrent profile requests without a cyclic wait and rejects a third-party reply', async () => {
    const { open } = await setup();
    const a = await open(1), b = await open(2), c = await open(3);
    const one = randomUUID(), two = randomUUID();
    a.socket.send(JSON.stringify({ type: 'interaction', requestId: one, action: 'view-profile', target: b.ready.playerId }));
    b.socket.send(JSON.stringify({ type: 'interaction', requestId: two, action: 'view-profile', target: a.ready.playerId }));
    const atB = await b.take(item => item.type === 'interaction-request') as Extract<SocialServerMessage, { type: 'interaction-request' }>;
    const atA = await a.take(item => item.type === 'interaction-request') as Extract<SocialServerMessage, { type: 'interaction-request' }>;
    c.socket.send(JSON.stringify({ type: 'interaction-reply', requestId: atB.requestId, data: publicCharacterInfo(createCharacter(Date.now(), 3)) }));
    const data = publicCharacterInfo(createCharacter(Date.now(), 7));
    b.socket.send(JSON.stringify({ type: 'interaction-reply', requestId: atB.requestId, data }));
    a.socket.send(JSON.stringify({ type: 'interaction-reply', requestId: atA.requestId, data }));
    expect(await a.take(item => item.type === 'result' && item.requestId === one)).toMatchObject({
      data: { player: { name: 'Player 2' }, character: data },
    });
    await b.take(item => item.type === 'result' && item.requestId === two);
  });
  it('rechecks the target location when a profile response arrives', async () => {
    const { open } = await setup();
    const a = await open(1), b = await open(2);
    const requestId = randomUUID();
    a.socket.send(JSON.stringify({ type: 'interaction', requestId, action: 'view-profile', target: b.ready.playerId }));
    const request = await b.take(item => item.type === 'interaction-request') as Extract<SocialServerMessage, { type: 'interaction-request' }>;
    b.socket.send(JSON.stringify({ type: 'presence', presence: { locationId: 'hillside-market', level: 0, activity: 'idle' } }));
    b.socket.send(JSON.stringify({ type: 'interaction-reply', requestId: request.requestId, data: publicCharacterInfo(createCharacter(Date.now(), 7)) }));
    await a.take(item => item.type === 'error' && item.requestId === requestId);
  });
  it('deduplicates chat requests and protects moderation from ordinary players', async () => {
    const { open, store } = await setup();
    const admin = await open(1), b = await open(2);
    const requestId = randomUUID();
    const input = { type: 'chat', requestId, text: '<script>literal text</script>' };
    b.socket.send(JSON.stringify(input));
    const result = await b.take(item => item.type === 'result' && item.requestId === requestId) as Extract<SocialServerMessage, { type: 'result' }>;
    b.socket.send(JSON.stringify(input));
    await b.take(item => item.type === 'result' && item.requestId === requestId);
    expect(store.messages).toHaveLength(1);
    const unauthorized = randomUUID();
    b.socket.send(JSON.stringify({ type: 'moderate', requestId: unauthorized, action: 'delete', messageId: '1' }));
    await b.take(item => item.type === 'error' && item.requestId === unauthorized);
    const deletion = randomUUID();
    admin.socket.send(JSON.stringify({ type: 'moderate', requestId: deletion, action: 'delete', messageId: '1' }));
    await admin.take(item => item.type === 'result' && item.requestId === deletion);
    b.socket.send(JSON.stringify(input));
    expect(await b.take(item => item.type === 'result' && item.requestId === requestId)).toMatchObject({ data: { id: '1', deleted: true } });
    expect(result.data).toEqual({ id: '1', deleted: false });
    expect(store.messages).toHaveLength(0);
  });
  it('projects only public character data and does not modify the source save', () => {
    const character = createCharacter(Date.now(), 19);
    const original = structuredClone(character);
    const result = publicCharacterInfo(character);
    expect(result.stats).toBeDefined();
    expect(Object.keys(result).sort()).toEqual(['abilities', 'equipment', 'realmName', 'score', 'stats']);
    expect(publicCharacterSchema.safeParse({ ...result, inventory: character.inventory }).success).toBe(false);
    expect(character).toEqual(original);
    expect(() => publicCharacterSchema.parse({ ...result, money: '1' })).toThrow();
  });
});
