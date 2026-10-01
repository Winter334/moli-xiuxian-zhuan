import { DiscordSDK } from '@discord/embedded-app-sdk';
import { discordConfigSchema, discordSessionSchema, type DiscordSession } from '../shared/discord';

export class ActivityLoginError extends Error {}

export function isDiscordActivity(search = location.search, hostname = location.hostname): boolean {
  const params = new URLSearchParams(search);
  return params.has('frame_id') || params.has('instance_id') || hostname.endsWith('.discordsays.com');
}

function timeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ActivityLoginError(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function requestJson(url: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(35_000),
    });
  } catch { throw new ActivityLoginError('无法连接登录服务，请稍后重试。'); }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new ActivityLoginError('登录服务响应异常，请检查 Activity 的 URL 映射。'); }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
      ? data.message : 'Discord 登录暂不可用，请稍后重试。';
    throw new ActivityLoginError(message);
  }
  return data;
}

async function pkce() {
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

export class DiscordActivityConnection {
  private sdk: DiscordSDK | null = null;
  private session: DiscordSession | null = null;
  private identity: { userId: string; characterId: string } | null = null;
  private loginFlight: Promise<DiscordSession> | null = null;

  login(onPhase: (message: string) => void = () => {}): Promise<DiscordSession> {
    if (this.loginFlight) return this.loginFlight;
    const work = async () => {
      if (!isDiscordActivity()) throw new ActivityLoginError('请从 Discord 的应用启动器打开茉莉修仙传。');
      onPhase('正在连接 Discord');
      const config = discordConfigSchema.parse(await requestJson('/api/discord/config'));
      if (!this.sdk) {
        const params = new URLSearchParams(location.search);
        if (!params.get('frame_id') || !params.get('instance_id') || !['desktop', 'mobile'].includes(params.get('platform') ?? '')) {
          throw new ActivityLoginError('Activity 启动参数不完整，请关闭后从 Discord 重新打开。');
        }
        this.sdk = new DiscordSDK(config.clientId, { disableConsoleLogOverride: true });
      }
      if (this.sdk.clientId !== config.clientId) throw new ActivityLoginError('Discord 应用配置已变化，请关闭后重新打开。');
      await timeout(this.sdk.ready(), 20_000, 'Discord 连接超时，请关闭 Activity 后重新打开。');
      onPhase('等待 Discord 授权');
      const { verifier, challenge } = await pkce();
      const authorization = await timeout(this.sdk.commands.authorize({
        client_id: config.clientId, response_type: 'code', prompt: 'none', scope: ['identify'],
        state: crypto.randomUUID(), code_challenge: challenge, code_challenge_method: 'S256',
      }), 180_000, 'Discord 授权未完成，请重新登录。');
      onPhase('正在核实账号');
      const session = discordSessionSchema.parse(await requestJson('/api/discord/token', {
        code: authorization.code, codeVerifier: verifier,
      }));
      if (session.clientId !== config.clientId) throw new ActivityLoginError('登录服务的应用身份不匹配。');
      const authenticated = await timeout(this.sdk.commands.authenticate({ access_token: session.accessToken }),
        20_000, 'Discord 认证超时，请重新登录。');
      if (authenticated.user.id !== session.user.id) throw new ActivityLoginError('Discord 身份核对失败，未读取角色。');
      if (this.identity && (this.identity.userId !== session.user.id || this.identity.characterId !== session.characterId)) {
        throw new ActivityLoginError('Discord 账号已变化，当前角色未被覆盖，请关闭 Activity 后重新打开。');
      }
      this.identity = { userId: session.user.id, characterId: session.characterId };
      this.session = session;
      return session;
    };
    const flight = work().finally(() => { if (this.loginFlight === flight) this.loginFlight = null; });
    this.loginFlight = flight;
    return flight;
  }

  fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/client/')) {
      throw new Error('不向其它地址发送游戏身份。');
    }
    const send = (session: DiscordSession) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${session.sessionToken}`);
      return fetch(input, { ...init, headers, credentials: 'omit' });
    };
    const session = this.session && this.session.expiresAt > Date.now() + 60_000 ? this.session : await this.login();
    const response = await send(session);
    if (response.status !== 401) return response;
    if (this.session === session) this.session = null;
    return send(this.session ?? await this.login());
  };
}
