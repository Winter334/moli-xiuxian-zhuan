import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { discordLoginSchema, discordSessionSchema, type DiscordSession, type DiscordUser } from '../../shared/discord';
import { ApiError } from '../errors';
import type { DiscordConfig } from './discord-config';

export interface DiscordIdentityStore {
  connectDiscordAccount(clientId: string, userId: string, expiresAt: number, now: number):
    Promise<{ characterId: string; sessionToken: string }>;
  findDiscordSession(token: string, clientId: string, now: number): Promise<string | null>;
}

const oauthTokenSchema = z.object({
  access_token: z.string().min(1).max(4096),
  token_type: z.string().refine(value => value.toLowerCase() === 'bearer'),
  expires_in: z.number().int().positive(),
  scope: z.string().refine(value => value.split(/\s+/).includes('identify')),
});
const apiUserSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1).max(128),
  global_name: z.string().min(1).max(128).nullable().optional(),
  avatar: z.string().regex(/^(a_)?[a-f0-9]{32}$/).nullable(),
});
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export function checkActivityRequest(
  request: Pick<FastifyRequest, 'headers' | 'method' | 'ip'>,
  clientId: string,
  mode: 'local' | 'deployed' = 'local',
) {
  const origin = `https://${clientId}.discordsays.com`;
  if ((mode === 'local' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) ||
      (request.headers.origin !== undefined && request.headers.origin !== origin) ||
      (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin)) {
    throw new ApiError(403, 'ORIGIN_REJECTED', '请从此应用的 Discord Activity 入口访问。');
  }
}

export class DiscordAuth {
  private exchanges = 0;

  constructor(readonly config: DiscordConfig, private readonly store: DiscordIdentityStore,
    private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  private async discordRequest(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`https://discord.com/api/v10${path}`, {
        ...init, signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiError(503, 'DISCORD_UNAVAILABLE', '暂时无法连接 Discord，请稍后重新登录。');
    }
    if (!response.ok) {
      if (response.status === 429) throw new ApiError(429, 'DISCORD_RATE_LIMIT', 'Discord 授权请求过于频繁，请稍后重试。');
      if (response.status >= 500) throw new ApiError(503, 'DISCORD_UNAVAILABLE', 'Discord 授权服务暂不可用，请稍后重试。');
      throw new ApiError(401, 'DISCORD_AUTH_REJECTED', 'Discord 授权已失效或应用配置不匹配，请重新登录。');
    }
    try { return await response.json(); }
    catch { throw new ApiError(502, 'DISCORD_RESPONSE_INVALID', 'Discord 授权响应异常，请稍后重试。'); }
  }

  async login(raw: unknown): Promise<DiscordSession> {
    const input = discordLoginSchema.parse(raw);
    if (this.exchanges >= 4) throw new ApiError(429, 'LOGIN_BUSY', '当前登录请求较多，请稍后重试。');
    this.exchanges++;
    try {
      const token = oauthTokenSchema.safeParse(await this.discordRequest('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.clientId, client_secret: this.config.clientSecret,
          grant_type: 'authorization_code', code: input.code, code_verifier: input.codeVerifier,
        }).toString(),
      }));
      if (!token.success) throw new ApiError(502, 'DISCORD_RESPONSE_INVALID', 'Discord 授权范围或响应不符合要求。');
      const userResult = apiUserSchema.safeParse(await this.discordRequest('/users/@me', {
        headers: { Authorization: `Bearer ${token.data.access_token}` },
      }));
      if (!userResult.success) throw new ApiError(502, 'DISCORD_RESPONSE_INVALID', '无法核实 Discord 账号身份。');
      const apiUser = userResult.data;
      const user: DiscordUser = {
        id: apiUser.id, username: apiUser.username,
        displayName: apiUser.global_name ?? apiUser.username, avatar: apiUser.avatar,
      };
      const now = this.now();
      const expiresAt = now + Math.min(SESSION_TTL_MS, token.data.expires_in * 1000);
      const account = await this.store.connectDiscordAccount(this.config.clientId, user.id, expiresAt, now);
      return discordSessionSchema.parse({
        clientId: this.config.clientId, user, ...account, expiresAt, accessToken: token.data.access_token,
      });
    } finally { this.exchanges--; }
  }

  async identity(authorization: string | undefined): Promise<string | null> {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
    if (!match) return null;
    return this.store.findDiscordSession(match[1], this.config.clientId, this.now());
  }
}
