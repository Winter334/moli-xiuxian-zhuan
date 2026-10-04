import { z } from 'zod';
import { characterSchema } from '../core/prototype/character-state';
import { debugCommandSchema } from '../core/prototype/debug';

export const debugAccessSchema = z.object({
  characterId: z.uuid(), allowed: z.boolean(),
}).strict();
export const debugRequestSchema = z.object({
  characterId: z.uuid(), character: characterSchema, command: debugCommandSchema,
}).strict();
export const debugResultSchema = z.object({
  characterId: z.uuid(), character: characterSchema,
}).strict();
