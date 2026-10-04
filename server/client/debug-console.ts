import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { executeDebugCommand } from '../../core/prototype/debug';
import { CharacterCommandError } from '../../core/prototype/command-error';
import { checkSaveCapacity } from '../../shared/client-save';
import { debugRequestSchema } from '../../shared/debug-console';
import { ApiError } from '../errors';

export function readModeratorIds(raw = ''): ReadonlySet<string> {
  const ids = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (ids.some(id => !/^\d{17,20}$/.test(id))) throw new Error('SOCIAL_MODERATOR_IDS must contain Discord user IDs.');
  return new Set(ids);
}

export interface ConsoleIdentity { characterId: string; userId: string }
export function registerDebugConsole(app: FastifyInstance, options: {
  identity: (request: FastifyRequest) => Promise<ConsoleIdentity | null>;
  moderators: ReadonlySet<string>;
}) {
  async function authenticate(request: FastifyRequest) {
    const identity = await options.identity(request);
    if (!identity) throw new ApiError(401, 'UNAUTHENTICATED', '请先连接 Discord 身份。');
    return identity;
  }
  const characterQuery = z.object({ characterId: z.uuid() }).strict();
  app.get('/api/client/debug', async request => {
    const identity = await authenticate(request);
    const query = characterQuery.parse(request.query);
    if (query.characterId !== identity.characterId) throw new ApiError(409, 'IDENTITY_CONFLICT', '控制台身份与当前角色不一致。');
    return { characterId: identity.characterId, allowed: options.moderators.has(identity.userId) };
  });
  app.post('/api/client/debug', async request => {
    const identity = await authenticate(request);
    if (!options.moderators.has(identity.userId)) throw new ApiError(403, 'NOT_ADMINISTRATOR', '没有测试控制台权限。');
    const input = debugRequestSchema.parse(request.body);
    if (input.characterId !== identity.characterId) throw new ApiError(409, 'IDENTITY_CONFLICT', '只能调整管理员自己的角色。');
    try {
      const character = executeDebugCommand(input.character, input.command);
      checkSaveCapacity(character);
      return { characterId: identity.characterId, character };
    } catch (error) {
      throw new ApiError(422, 'DEBUG_REJECTED', error instanceof CharacterCommandError
        ? error.message : '测试参数或角色状态不符合规则，原进度保留。');
    }
  });
}
