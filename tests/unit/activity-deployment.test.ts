import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertActivityDeploymentDatabaseUrl, assertLocalDatabaseUrl } from '../../server/config';
import { createClientApp } from '../../server/client/main';
import { MAX_SAVE_BYTES } from '../../shared/client-save';

const pool = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  end: vi.fn(async () => {}),
}));
vi.mock('../../server/database', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/database')>(),
  createPool: vi.fn(() => pool),
}));
vi.mock('../../server/client/repository', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/client/repository')>(),
  initializeStorage: vi.fn(async () => {}),
}));

const clientId = '123456789012345678';
const databaseUrl = `postgres://moli_activity_vps:${'a'.repeat(64)}@postgres:5432/moli_activity_vps`;

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CLIENT_AUTH_MODE', 'discord');
  vi.stubEnv('DEV_AUTH', 'false');
  vi.stubEnv('DISCORD_CLIENT_ID', clientId);
  vi.stubEnv('DISCORD_CLIENT_SECRET', 'server-only-test-secret');
  vi.stubEnv('ACTIVITY_DATABASE_URL', databaseUrl);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Activity deployment boundary', () => {
  it('uses the shared save request limit before authentication without accepting oversized requests', async () => {
    const app = await createClientApp({ deployment: true });
    try {
      const payload = JSON.stringify({ data: 'x'.repeat(MAX_SAVE_BYTES - 11) });
      expect(Buffer.byteLength(payload)).toBe(MAX_SAVE_BYTES);
      const request = { method: 'POST' as const, url: '/api/client/save', remoteAddress: '172.18.0.2',
        headers: { origin: `https://${clientId}.discordsays.com`, 'content-type': 'application/json' } };
      expect((await app.inject({ ...request, payload })).statusCode).toBe(401);
      expect((await app.inject({ ...request, payload: `${payload} ` })).statusCode).toBe(413);
      expect(pool.query).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('allows only an explicit isolated deployment database without weakening the local guard', () => {
    expect(() => assertActivityDeploymentDatabaseUrl(databaseUrl)).not.toThrow();
    expect(() => assertLocalDatabaseUrl(databaseUrl)).toThrow();
    for (const rejected of [
      '',
      databaseUrl.replace('/moli_activity_vps', '/moli_dev'),
      databaseUrl.replace('moli_activity_vps:', 'postgres:'),
      databaseUrl.replace('a'.repeat(64), 'local_only'),
      `${databaseUrl}?host=another-host`,
      `${databaseUrl}#fragment`,
      databaseUrl.replace('a'.repeat(64), '%invalid'),
    ]) {
      expect(() => assertActivityDeploymentDatabaseUrl(rejected)).toThrow();
      try { assertActivityDeploymentDatabaseUrl(rejected); }
      catch (error) { expect((error as Error).message).not.toContain('postgres://'); }
    }
  });

  it('rejects production through the development entry and never enables development identities', async () => {
    await expect(createClientApp()).rejects.toThrow('dedicated Activity deployment');
    vi.stubEnv('CLIENT_AUTH_MODE', 'local');
    await expect(createClientApp({ deployment: true })).rejects.toThrow('CLIENT_AUTH_MODE=discord');
    vi.stubEnv('CLIENT_AUTH_MODE', 'discord');
    vi.stubEnv('DEV_AUTH', 'true');
    await expect(createClientApp({ deployment: true })).rejects.toThrow('DEV_AUTH=false');
    vi.stubEnv('DEV_AUTH', 'false');
    vi.stubEnv('ACTIVITY_DATABASE_URL', '');
    await expect(createClientApp({ deployment: true })).rejects.toThrow('ACTIVITY_DATABASE_URL');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('serves health and public app ID through a proxy without exposing the secret', async () => {
    const app = await createClientApp({ deployment: true });
    try {
      const health = await app.inject({ url: '/api/health', remoteAddress: '172.18.0.2' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ ok: true, mode: 'discord-activity-deployed' });
      const config = await app.inject({ url: '/api/discord/config', remoteAddress: '172.18.0.2' });
      expect(config.json()).toEqual({ clientId });
      expect(config.body).not.toContain('server-only-test-secret');
    } finally { await app.close(); }
  });

  it('rejects proxy writes without the app origin and refuses cookies or forwarded user identities', async () => {
    const app = await createClientApp({ deployment: true });
    try {
      for (const origin of [undefined, 'https://game.example.com']) {
        const response = await app.inject({
          method: 'POST', url: '/api/client/session', remoteAddress: '172.18.0.2',
          headers: origin ? { origin } : { 'x-forwarded-origin': `https://${clientId}.discordsays.com` },
          payload: {},
        });
        expect(response.statusCode).toBe(403);
      }
      const response = await app.inject({
        method: 'POST', url: '/api/client/session', remoteAddress: '172.18.0.2',
        headers: {
          origin: `https://${clientId}.discordsays.com`,
          cookie: 'moli_client_session=00000000-0000-4000-8000-000000000001',
          'x-discord-user-id': '234567890123456789', 'x-forwarded-for': '127.0.0.1',
        },
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
