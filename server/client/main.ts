import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { z } from 'zod';
import { MAX_SAVE_BYTES } from '../../shared/client-save';
import { rankingIdSchema } from '../../shared/rankings';
import { createPool } from '../database';
import { DEFAULT_ACTIVITY_DATABASE_URL, readConfig } from '../config';
import { ApiError, errorResponse } from '../errors';
import { ClientRepository, initializeStorage } from './repository';
import { ClientSaveService } from './service';
import { RankingsService } from './rankings';
import { ConsignmentRepository } from './consignment-store';
import { ConsignmentService } from './consignment';
import { ReincarnationRepository } from './reincarnation-store';
import { ReincarnationService } from './reincarnation';
import { checkActivityRequest, DiscordAuth } from './discord-auth';
import { readClientAuthMode, readDiscordConfig } from './discord-config';

export const SESSION_COOKIE = 'moli_client_session';

function checkLocalRequest(request: FastifyRequest) {
  const host = request.headers.host;
  let authority: URL;
  try { authority = new URL(`http://${host ?? ''}`); }
  catch { throw new ApiError(403, 'ORIGIN_REJECTED', '仅限本机同源访问。'); }
  if (!host || authority.host !== host || !['127.0.0.1', 'localhost', '[::1]'].includes(authority.hostname) ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) ||
      (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        (request.headers.origin !== authority.origin ||
          (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')))) {
    throw new ApiError(403, 'ORIGIN_REJECTED', '不接受跨站操作。');
  }
}

export async function createClientApp(
  { serveWeb = false, deployment = false }: { serveWeb?: boolean; deployment?: boolean } = {},
) {
  const config = readConfig();
  const authMode = readClientAuthMode();
  if (deployment) {
    if (config.nodeEnv !== 'production' || authMode !== 'discord' || config.devAuth) {
      throw new Error('Activity deployment requires NODE_ENV=production, CLIENT_AUTH_MODE=discord and DEV_AUTH=false.');
    }
    if (!process.env.ACTIVITY_DATABASE_URL) throw new Error('Configure ACTIVITY_DATABASE_URL before starting the deployed Activity.');
  } else if (config.nodeEnv === 'production') {
    throw new Error('Use the dedicated Activity deployment entry point in production.');
  }
  const discordConfig = authMode === 'discord' ? readDiscordConfig() : null;
  const databaseUrl = discordConfig ? process.env.ACTIVITY_DATABASE_URL ?? DEFAULT_ACTIVITY_DATABASE_URL : config.databaseUrl;
  if (discordConfig && !deployment && new URL(databaseUrl).pathname !== '/moli_activity') {
    throw new Error('Discord Activity development requires the isolated moli_activity database.');
  }
  const pool = createPool(databaseUrl, false, deployment ? 'activity-deployment' : 'local');
  const scope = discordConfig ? { kind: 'discord' as const, applicationId: discordConfig.clientId }
    : { kind: 'development' as const };
  const repository = new ClientRepository(pool, scope);
  const discord = discordConfig ? new DiscordAuth(discordConfig, repository) : null;
  const service = new ClientSaveService(repository);
  const rankings = new RankingsService(repository);
  const consignment = new ConsignmentService(new ConsignmentRepository(pool, scope));
  const reincarnation = new ReincarnationService(new ReincarnationRepository(pool));
  const app = Fastify({ logger: false, bodyLimit: MAX_SAVE_BYTES });
  app.addHook('onClose', () => pool.end());
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (discordConfig) checkActivityRequest(request, discordConfig.clientId, deployment ? 'deployed' : 'local');
    else checkLocalRequest(request);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send(errorResponse(error));
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'INVALID_REQUEST', message: '请求格式或版本不匹配，云端未修改。' });
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'INVALID_REQUEST', message: '请求格式或大小不正确。' });
    }
    console.error('Client save request failed:', error instanceof Error ? error.name : 'UnknownError');
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: '云存档暂不可用，本地进度不受影响。' });
  });
  await app.register(cookie);

  async function identity(request: FastifyRequest) {
    if (discord) return discord.identity(request.headers.authorization);
    if (!config.devAuth) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', '尚未开启本机身份服务。');
    const token = request.cookies[SESSION_COOKIE];
    return token && z.uuid().safeParse(token).success ? repository.findSession(token) : null;
  }
  async function authenticate(request: FastifyRequest) {
    const id = await identity(request);
    if (!id) throw new ApiError(401, 'UNAUTHENTICATED', '云存档身份未连接，本地进度保留。');
    return id;
  }

  const healthMode = discord ? deployment ? 'discord-activity-deployed' : 'discord-activity-development' : 'client-opening';
  app.get('/api/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true, database: 'ok', mode: healthMode };
    } catch { return reply.code(503).send({ ok: false, database: 'unavailable',
      mode: healthMode }); }
  });
  if (discord) {
    app.get('/api/discord/config', async () => ({ clientId: discord.config.clientId }));
    app.post('/api/discord/token', { bodyLimit: 4096 }, async request => discord.login(request.body));
  }
  app.get('/api/client/time', async () => ({ serverTime: Date.now() }));
  app.post('/api/client/session', async (request, reply) => {
    if (discord) return service.getProfile(await authenticate(request));
    const existing = await identity(request);
    if (existing) return service.getProfile(existing);
    if (request.cookies[SESSION_COOKIE]) throw new ApiError(401, 'SESSION_INVALID', '云存档身份失效，未自动替换角色。');
    const session = await service.createSession();
    reply.setCookie(SESSION_COOKIE, session.token, {
      httpOnly: true, sameSite: 'strict', secure: false, path: '/api', maxAge: 60 * 60 * 24 * 365,
    });
    return service.getProfile(session.characterId);
  });
  app.get('/api/client/save', async request => service.getProfile(await authenticate(request)));
  app.get('/api/client/rankings/:board', async request => {
    const id = await authenticate(request);
    const params = z.object({ board: rankingIdSchema }).parse(request.params);
    const query = z.object({ characterId: z.uuid() }).parse(request.query);
    if (query.characterId !== id) throw new ApiError(409, 'IDENTITY_CONFLICT', '榜单身份与本地角色不一致，本地进度保留。');
    return rankings.getBoard(id, params.board);
  });
  app.post('/api/client/save', async request => {
    const id = await authenticate(request);
    return service.upload(id, request.body);
  });
  app.post('/api/client/consignment/view', async request =>
    consignment.view(await authenticate(request), request.body));
  app.post('/api/client/consignment/command', async request =>
    consignment.execute(await authenticate(request), request.body));
  app.post('/api/client/reincarnation', async request =>
    reincarnation.execute(await authenticate(request), request.body));
  app.get('/api/client/reincarnation/receipts/:requestId', async request => {
    const id = await authenticate(request);
    const params = z.object({ requestId: z.uuid() }).strict().parse(request.params);
    const query = z.object({ characterId: z.uuid() }).strict().parse(request.query);
    if (query.characterId !== id) throw new ApiError(409, 'IDENTITY_CONFLICT', '轮回身份与当前角色不一致。');
    return reincarnation.lookup(id, params.requestId);
  });
  app.get('/api/client/consignment/receipts/:requestId', async request => {
    const id = await authenticate(request);
    const params = z.object({ requestId: z.uuid() }).strict().parse(request.params);
    const query = z.object({ characterId: z.uuid() }).strict().parse(request.query);
    if (query.characterId !== id) throw new ApiError(409, 'IDENTITY_CONFLICT', '寄售身份与当前角色不一致。');
    return consignment.lookup(id, params.requestId);
  });
  if (serveWeb) {
    if (!discord) throw new Error('The Activity web endpoint requires Discord authentication.');
    await app.register(staticFiles, { root: resolve('dist/web'), index: ['index.html'] });
  }
  try {
    await initializeStorage(pool);
    await app.ready();
    return app;
  } catch (error) { await app.close(); throw error; }
}

async function start() {
  loadEnv({ quiet: true });
  const app = await createClientApp();
  try {
    console.log(`Client save API listening at ${await app.listen({ host: '127.0.0.1', port: readConfig().port })}`);
  } catch (error) { await app.close(); throw error; }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch((error: unknown) => {
    console.error('Client save API startup failed:', error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]') : 'Unknown error');
    process.exitCode = 1;
  });
}
