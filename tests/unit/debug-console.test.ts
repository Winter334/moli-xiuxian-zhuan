import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createCharacter } from '../../core/prototype/character-state';
import { registerDebugConsole, readModeratorIds } from '../../server/client/debug-console';
import { ApiError } from '../../server/errors';
import { FATE_IDS } from '../../core/prototype/fates';

const characterId = '00000000-0000-4000-8000-000000000001';
const anotherId = '00000000-0000-4000-8000-000000000002';
const adminId = '123456789012345678';

describe('administrator console authorization', () => {
  it('defaults to no administrators and validates the existing Discord allowlist', () => {
    expect(readModeratorIds().size).toBe(0);
    expect(readModeratorIds(` ${adminId},${adminId} `)).toEqual(new Set([adminId]));
    expect(() => readModeratorIds('true')).toThrow('Discord user IDs');
  });

  it('checks verified identity for discovery and every operation, rejecting ordinary and other-character requests', async () => {
    const app = Fastify();
    const moderators = new Set([adminId]);
    registerDebugConsole(app, { moderators, identity: async request => {
      if (request.headers.authorization === 'Bearer admin') return { characterId, userId: adminId };
      if (request.headers.authorization === 'Bearer player') return { characterId, userId: '234567890123456789' };
      return null;
    } });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ApiError) reply.code(error.statusCode).send({ code: error.code });
      else reply.code(400).send({});
    });
    const character = createCharacter(0, 19);
    const fateId = FATE_IDS.find(id => id !== character.fateId)!;
    const payload = { characterId, character, command: { type: 'fate', fateId } };
    const post = (authorization: string, body: Record<string, unknown> = payload) => app.inject({
      method: 'POST', url: '/api/client/debug', headers: { authorization }, payload: body,
    });
    try {
      expect((await app.inject({ url: `/api/client/debug?characterId=${characterId}`, headers: { authorization: 'Bearer player' } })).json())
        .toEqual({ characterId, allowed: false });
      expect((await post('')).statusCode).toBe(401);
      expect((await post('Bearer player')).statusCode).toBe(403);
      expect((await post('Bearer admin', { ...payload, characterId: anotherId })).statusCode).toBe(409);
      const result = await post('Bearer admin');
      expect(result.statusCode).toBe(200);
      expect(result.json().character).toMatchObject({ fateId, history: { testAssisted: false } });
      expect(character.history.testAssisted).toBe(false);
      const marked = structuredClone(character);
      marked.history.testAssisted = true;
      const cleared = await post('Bearer admin', { characterId, character: marked, command: { type: 'clear-test-marker' } });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().character.history.testAssisted).toBe(false);
      expect(marked.history.testAssisted).toBe(true);
      moderators.clear();
      expect((await post('Bearer admin')).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
