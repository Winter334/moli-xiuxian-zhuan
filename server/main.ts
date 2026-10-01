import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { Pool } from 'pg';
import { createPool } from './database';
import { readConfig } from './config';
import { ApiError, errorResponse } from './errors';
import { GameService, type GameServiceOptions } from './game-service';
import { migrate } from './migrate';
import { GameRepository } from './repository';
import { commandRequestSchema, uuidSchema } from './validation';
import { loadoutCandidate } from '../core/loadout-candidate';

export const SESSION_COOKIE = 'moli_dev_session';

export interface AppOptions extends GameServiceOptions {
  playtest?: boolean;
  databaseUrl?: string;
  pool?: Pool;
  devAuth?: boolean;
  nodeEnv?: string;
}

const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function checkLocalRequest(request: FastifyRequest): void {
  const host = request.headers.host;
  let authority: URL;
  try {
    authority = new URL(`http://${host ?? ''}`);
  } catch {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'A local same-origin request is required.');
  }
  if (!host || authority.host !== host || !localHosts.has(authority.hostname) ||
      !localAddresses.has(request.ip)) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'A local same-origin request is required.');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    if (request.headers.origin !== authority.origin ||
        (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
      throw new ApiError(403, 'ORIGIN_REJECTED', 'Cross-origin writes are not allowed.');
    }
  }
}

export async function createApp(options: AppOptions = {}) {
  const config = readConfig();
  const devAuth = options.devAuth ?? config.devAuth;
  if ((options.nodeEnv ?? config.nodeEnv) === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('Production authentication is not implemented. Development authentication is forbidden in production.');
  }
  const playtest = options.playtest ?? process.env.GAME_PROFILE === 'playtest';
  const cookieName = playtest ? 'moli_playtest_session' : SESSION_COOKIE;
  const pool = options.pool ?? createPool(options.databaseUrl ?? config.databaseUrl, playtest);
  const ownsPool = !options.pool;
  const app = Fastify({ logger: false, bodyLimit: 16_384, trustProxy: false });
  const repository = new GameRepository(pool);
  app.addHook('onClose', async () => {
    if (ownsPool) await pool.end();
  });
  let service: GameService;
  try {
    service = new GameService(repository, { ...options, content: options.content ?? (playtest ? loadoutCandidate : undefined) });
  } catch (error) {
    await app.close();
    throw error;
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send(errorResponse(error));
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'INVALID_REQUEST', message: 'The request is invalid.' });
    }
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'The request could not be completed.' });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    checkLocalRequest(request);
  });
  await app.register(cookie);

  async function authenticate(request: FastifyRequest): Promise<string> {
    if (!devAuth) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Set DEV_AUTH=true explicitly for local development. Production authentication is not implemented.');
    const token = request.cookies[cookieName];
    const characterId = token && uuidSchema.safeParse(token).success ? await repository.findSession(token) : null;
    if (!characterId) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid local development session is required.');
    return characterId;
  }

  app.get('/api/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true, database: 'ok', mode: 'local-development' };
    } catch {
      return reply.code(503).send({ ok: false, database: 'unavailable', mode: 'local-development' });
    }
  });
  app.post('/api/dev/session', async (request, reply) => {
    if (!devAuth) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Set DEV_AUTH=true explicitly for local development. Production authentication is not implemented.');
    const oldToken = request.cookies[cookieName];
    const oldCharacter = oldToken && uuidSchema.safeParse(oldToken).success
      ? await repository.findSession(oldToken)
      : null;
    if (oldToken && oldCharacter) {
      return service.getGame(oldCharacter);
    }
    const session = await service.createSession();
    reply.setCookie(cookieName, session.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/api',
      maxAge: 60 * 60 * 24 * 365,
    });
    return service.getGame(session.characterId);
  });
  app.get('/api/game', async (request) => service.getGame(await authenticate(request)));
  app.post('/api/command', async (request, reply) => {
    const characterId = await authenticate(request);
    const parsed = commandRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'INVALID_COMMAND', 'A UUID requestId and a valid command are required.');
    const response = await service.command(characterId, parsed.data.requestId, parsed.data.command);
    return reply.code(response.statusCode).send(response.body);
  });
  try {
    if (playtest) {
      // A separate schema and cookie keep prototype saves out of this content profile.
      const scope = await pool.query<{ search_path: string }>('SHOW search_path');
      if (scope.rows[0]?.search_path !== 'moli_playtest') throw new Error('Playtest requires its isolated schema.');
      await pool.query('CREATE SCHEMA IF NOT EXISTS moli_playtest');
    }
    await migrate(pool);
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

export const buildApp = createApp;

async function start(): Promise<void> {
  loadEnv({ quiet: true });
  const app = await createApp();
  try {
    const address = await app.listen({ host: '127.0.0.1', port: readConfig().port });
    console.log(`Local development API listening at ${address}`);
  } catch (error) {
    await app.close();
    throw error;
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => { process.exitCode = 1; });
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(() => {
    console.error('API startup failed. Production auth is not implemented; check DEV_AUTH and the local database.');
    process.exitCode = 1;
  });
}
