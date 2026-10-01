import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import { createPool } from '../database';
import { readConfig } from '../config';
import { ApiError, errorResponse } from '../errors';
import { initializeStorage, OpeningRepository } from './repository';
import { OpeningService, requestSchema } from './service';

export const SESSION_COOKIE = 'moli_opening_session';
const uuid = z.uuid();

function checkLocalRequest(request: FastifyRequest) {
  const host = request.headers.host;
  let authority: URL;
  try { authority = new URL(`http://${host ?? ''}`); }
  catch { throw new ApiError(403, 'ORIGIN_REJECTED', '仅限本机同源访问。'); }
  if (!host || authority.host !== host || !['127.0.0.1', 'localhost', '[::1]'].includes(authority.hostname) ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) {
    throw new ApiError(403, 'ORIGIN_REJECTED', '仅限本机同源访问。');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (request.headers.origin !== authority.origin ||
       (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin'))) {
    throw new ApiError(403, 'ORIGIN_REJECTED', '不接受跨站操作。');
  }
}

export async function createOpeningApp() {
  const config = readConfig();
  if (config.nodeEnv === 'production') throw new Error('Production authentication is not implemented.');
  const pool = createPool(config.databaseUrl);
  const app = Fastify({ logger: false, bodyLimit: 4096, trustProxy: false });
  const repository = new OpeningRepository(pool);
  const service = new OpeningService(repository);
  app.addHook('onClose', () => pool.end());
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send(errorResponse(error));
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'INVALID_REQUEST', message: '请求格式不正确。' });
    }
    console.error('Opening request failed:', error instanceof Error ? error.name : 'UnknownError');
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: '暂时无法完成操作，请稍后重试。' });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    checkLocalRequest(request);
  });
  await app.register(cookie);

  function requireAuthEnabled() {
    if (!config.devAuth) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', '尚未开启本机身份服务。');
  }
  async function authenticate(request: FastifyRequest) {
    requireAuthEnabled();
    const token = request.cookies[SESSION_COOKIE];
    const characterId = token && uuid.safeParse(token).success ? await repository.findSession(token) : null;
    if (!characterId) throw new ApiError(401, 'UNAUTHENTICATED', '请重新连接角色。');
    return characterId;
  }

  app.get('/api/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true, database: 'ok', mode: 'local-opening' };
    } catch {
      return reply.code(503).send({ ok: false, database: 'unavailable', mode: 'local-opening' });
    }
  });
  app.post('/api/dev/session', async (request, reply) => {
    requireAuthEnabled();
    const token = request.cookies[SESSION_COOKIE];
    const existing = token && uuid.safeParse(token).success ? await repository.findSession(token) : null;
    if (existing) return service.getGame(existing);
    // A supplied but invalid new-profile cookie never silently replaces a character.
    if (token) throw new ApiError(401, 'SESSION_INVALID', '角色身份已失效，未自动创建或覆盖角色。');
    const session = await service.createSession();
    reply.setCookie(SESSION_COOKIE, session.token, {
      httpOnly: true, sameSite: 'strict', secure: false, path: '/api', maxAge: 60 * 60 * 24 * 365,
    });
    return service.getGame(session.characterId);
  });
  app.get('/api/game', async (request) => service.getGame(await authenticate(request)));
  app.post('/api/command', async (request, reply) => {
    const characterId = await authenticate(request);
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'INVALID_COMMAND', '请求编号或操作格式不正确。');
    const response = await service.command(characterId, parsed.data.requestId, parsed.data.command);
    return reply.code(response.statusCode).send(response.body);
  });
  try {
    await initializeStorage(pool);
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function start() {
  loadEnv({ quiet: true });
  const app = await createOpeningApp();
  try {
    const address = await app.listen({ host: '127.0.0.1', port: readConfig().port });
    console.log(`Opening API listening at ${address}`);
  } catch (error) {
    await app.close();
    throw error;
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch((error: unknown) => {
    console.error('Opening API startup failed:', error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]') : 'Unknown error');
    process.exitCode = 1;
  });
}
