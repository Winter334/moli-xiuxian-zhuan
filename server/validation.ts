import { z } from 'zod';
import { EQUIPMENT_SLOTS, FOUNDATION_METHOD_IDS, type GameCommand } from '../shared/contracts';

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/);
const quantity = z.number().int().min(1).max(1_000);

export const gameCommandSchema: z.ZodType<GameCommand> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fate-draw'), lifeId: id }),
  z.strictObject({ type: z.literal('fate-select'), lifeId: id, slot: z.number().int().min(0).max(7), fateId: id.nullable() }),
  z.strictObject({ type: z.literal('fate-designate'), lifeId: id, slot: z.number().int().min(0).max(7), fateId: id }),
  z.strictObject({ type: z.literal('enter-life'), lifeId: id }),
  z.strictObject({ type: z.literal('reincarnate'), lifeId: id }),
  z.strictObject({ type: z.literal('challenge'), lifeId: id, challengeId: id }),
  z.strictObject({
    type: z.literal('activity'),
    kind: z.enum(['idle', 'meditate', 'dungeon', 'practice']),
    targetId: id.optional(),
  }),
  z.strictObject({ type: z.literal('equip'), slot: z.enum(EQUIPMENT_SLOTS), instanceId: id.nullable() }),
  z.strictObject({ type: z.literal('technique'), techniqueId: id }),
  z.strictObject({ type: z.literal('learn-technique'), techniqueId: id }),
  z.strictObject({
    type: z.literal('supply'),
    enabled: z.boolean(),
    hpThreshold: z.number().min(0).max(1),
  }),
  z.strictObject({
    type: z.literal('mana-supply'),
    enabled: z.boolean(),
    mpThreshold: z.number().min(0).max(1),
  }),
  z.strictObject({ type: z.literal('craft'), recipeId: id, quantity }),
  z.strictObject({ type: z.literal('consume'), itemId: id, quantity }),
  z.strictObject({ type: z.literal('buy'), itemId: id, quantity }),
  z.strictObject({ type: z.literal('sell'), itemId: id, quantity }),
  z.strictObject({ type: z.literal('upgrade-dwelling'), track: z.enum(['tier', 'gathering', 'study']) }),
  z.strictObject({ type: z.literal('breakthrough'), lifeId: id, methodId: z.enum(FOUNDATION_METHOD_IDS) }),
]);

export const commandRequestSchema = z.strictObject({
  requestId: z.uuid(),
  command: gameCommandSchema,
});

export const uuidSchema = z.uuid();
