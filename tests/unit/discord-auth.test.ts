import { describe, expect, it, vi } from 'vitest';
import { checkActivityRequest, DiscordAuth, type DiscordIdentityStore } from '../../server/client/discord-auth';

const clientId = '123456789012345678';
const userId = '234567890123456789';
const characterId = '00000000-0000-4000-8000-000000000001';
const sessionToken = 's'.repeat(43);
const config = { clientId, clientSecret: 'server-only-secret' };
const input = { code: 'one-time-code', codeVerifier: 'v'.repeat(64) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fixture() {
  const sessions = new Map<string, { clientId: string; expiresAt: number }>();
  const store: DiscordIdentityStore = {
    connectDiscordAccount: vi.fn(async (app, _user, expiresAt) => {
      sessions.set(sessionToken, { clientId: app, expiresAt });
      return { characterId, sessionToken };
    }),
    findDiscordSession: vi.fn(async (token, app, now) => {
      const session = sessions.get(token);
      return session && session.clientId === app && session.expiresAt > now ? characterId : null;
    }),
  };
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: 'discord-token', token_type: 'Bearer', expires_in: 3600, scope: 'identify' }))
    .mockResolvedValueOnce(json({ id: userId, username: 'test.user', global_name: '<name>', avatar: null }));
  let now = 1000;
  return { store, fetcher, auth: new DiscordAuth(config, store, fetcher, () => now), setNow: (value: number) => { now = value; } };
}

describe('Discord identity boundary', () => {
  it('exchanges PKCE codes server-side and derives identity only from Discord /users/@me', async () => {
    const { auth, store, fetcher } = fixture();
    const session = await auth.login(input);
    expect(session).toMatchObject({
      clientId, characterId, sessionToken, expiresAt: 3_601_000,
      user: { id: userId, username: 'test.user', displayName: '<name>', avatar: null },
    });
    expect(store.connectDiscordAccount).toHaveBeenCalledWith(clientId, session.user, 3_601_000, 1000);
    expect(fetcher.mock.calls[0][0]).toBe('https://discord.com/api/v10/oauth2/token');
    const body = new URLSearchParams(String(fetcher.mock.calls[0][1]!.body));
    expect(body.get('client_secret')).toBe(config.clientSecret);
    expect(body.get('code_verifier')).toBe(input.codeVerifier);
    expect(fetcher.mock.calls[1][0]).toBe('https://discord.com/api/v10/users/@me');
    expect(fetcher.mock.calls[1][1]!.headers).toEqual({ Authorization: 'Bearer discord-token' });
    expect(JSON.stringify(session)).not.toContain(config.clientSecret);
  });

  it('rejects supplied user identities, invalid authorization and missing identify scope before creating accounts', async () => {
    const invalidInput = fixture();
    await expect(invalidInput.auth.login({ ...input, userId })).rejects.toThrow();
    expect(invalidInput.fetcher).not.toHaveBeenCalled();
    expect(invalidInput.store.connectDiscordAccount).not.toHaveBeenCalled();

    for (const response of [
      json({ secret: 'must-not-be-relayed' }, 400),
      json({ access_token: 'discord-token', token_type: 'Bearer', expires_in: 3600, scope: 'guilds' }),
    ]) {
      const { auth, store, fetcher } = fixture();
      fetcher.mockReset().mockResolvedValueOnce(response);
      await expect(auth.login(input)).rejects.not.toThrow('must-not-be-relayed');
      expect(store.connectDiscordAccount).not.toHaveBeenCalled();
    }
  });

  it('accepts only current game sessions belonging to this application, never Discord tokens or cookies', async () => {
    const { auth, store, setNow } = fixture();
    await auth.login(input);
    expect(await auth.identity(`Bearer ${sessionToken}`)).toBe(characterId);
    expect(await auth.identity('Bearer discord-token')).toBeNull();
    expect(await auth.identity(undefined)).toBeNull();
    setNow(3_601_000);
    expect(await auth.identity(`Bearer ${sessionToken}`)).toBeNull();
    const otherApp = new DiscordAuth({ ...config, clientId: '345678901234567890' }, store);
    expect(await otherApp.identity(`Bearer ${sessionToken}`)).toBeNull();
  });

  it('allows the configured Activity origin through the loopback gateway without trusting forwarded identity', () => {
    const request = { method: 'POST', ip: '127.0.0.1', headers: { origin: `https://${clientId}.discordsays.com` } };
    expect(() => checkActivityRequest(request, clientId)).not.toThrow();
    for (const rejected of [
      { ...request, headers: {} },
      { ...request, headers: { origin: 'https://discord.com' } },
      { ...request, headers: { origin: 'https://other.discordsays.com' } },
      { ...request, ip: '203.0.113.1' },
    ]) expect(() => checkActivityRequest(rejected, clientId)).toThrow();
    expect(() => checkActivityRequest({ method: 'GET', ip: '127.0.0.1', headers: {} }, clientId)).not.toThrow();
  });

  it('accepts deployed proxy connections but still requires the real Activity Origin for writes', () => {
    const request = { method: 'POST', ip: '172.18.0.2', headers: { origin: `https://${clientId}.discordsays.com` } };
    expect(() => checkActivityRequest(request, clientId, 'deployed')).not.toThrow();
    for (const headers of [
      {},
      { origin: 'https://game.example.com' },
      { origin: 'https://other.discordsays.com' },
      { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-origin': request.headers.origin },
    ]) expect(() => checkActivityRequest({ ...request, headers }, clientId, 'deployed')).toThrow();
    expect(() => checkActivityRequest({ method: 'GET', ip: '172.18.0.2', headers: {} }, clientId, 'deployed')).not.toThrow();
  });
});
