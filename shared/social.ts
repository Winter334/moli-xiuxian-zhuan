import { z } from 'zod';
import { statsSchema } from '../core/prototype/types';
import { playerAvatarUrlSchema, playerNameSchema } from './player-profile';
import { revisionSchema } from './client-save';
import { EMPTY_PVP, pvpStateSchema } from './pvp';

export const SOCIAL_PROTOCOL = 3;
export const SOCIAL_HEARTBEAT_MS = 15_000;
export const SOCIAL_TIMEOUT_MS = 75_000;
export const CHAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const CHAT_PAGE_SIZE = 50;
export const CHAT_TEXT_LIMIT = 500;
export const publicPlayerIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const requestId = z.uuid();
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const messageId = z.string().regex(/^[1-9]\d{0,19}$/);
const bonuses = z.object({ flat: statsSchema.partial().optional(), multiplier: statsSchema.partial().optional() }).strict();
export const presenceSchema = z.object({
  locationId: z.string().min(1).max(80),
  level: z.number().int().min(0).max(1000),
  activity: z.enum(['idle', 'rest', 'meditation', 'combat', 'training', 'gathering']),
}).strict();
export const publicCharacterSchema = z.object({
  realmName: z.string().min(1).max(80),
  score: z.string().regex(/^\d{1,1000}$/),
  stats: statsSchema,
  equipment: z.array(z.object({
    slot: z.enum(['weapon', 'head', 'body', 'legs', 'feet', 'accessory', 'artifact', 'special']),
    itemId: z.string().min(1).max(100), name: z.string().min(1).max(80),
    quality: z.number().int().nonnegative(), bonuses,
  }).strict()).max(8),
  abilities: z.array(z.object({
    kind: z.enum(['manual', 'divine']), id: z.string().min(1).max(100),
    name: z.string().min(1).max(80), level: z.number().int().nonnegative().nullable(), bonuses,
  }).strict()).max(16),
}).strict();
export type PublicCharacter = z.infer<typeof publicCharacterSchema>;

// One declaration drives availability, dispatch and response validation.
export const PLAYER_INTERACTIONS = [{
  id: 'view-profile', label: '查看信息', scope: 'same-location', transport: 'snapshot', response: publicCharacterSchema,
}, {
  id: 'attack', label: '袭击', scope: 'same-location', transport: 'pvp',
}] as const;
export type PlayerInteractionId = typeof PLAYER_INTERACTIONS[number]['id'];
export type SnapshotInteractionId = Extract<typeof PLAYER_INTERACTIONS[number], { transport: 'snapshot' }>['id'];
export const interactionIdSchema = z.enum(PLAYER_INTERACTIONS.map(entry => entry.id));
export const snapshotInteractionIdSchema = z.enum(PLAYER_INTERACTIONS.filter(entry => entry.transport === 'snapshot').map(entry => entry.id));
const playerFields = {
  playerId: publicPlayerIdSchema, name: playerNameSchema, avatarUrl: playerAvatarUrlSchema,
};
export const nearbyPlayerSchema = z.object({
  ...playerFields, realmName: z.string().max(80), activity: presenceSchema.shape.activity,
  interactions: z.array(interactionIdSchema), updatedAt: timestamp,
  pvp: pvpStateSchema.default(EMPTY_PVP),
}).strict();
export type NearbyPlayer = z.infer<typeof nearbyPlayerSchema>;
export const chatMessageSchema = z.object({
  id: messageId, ...playerFields, text: z.string().min(1).max(CHAT_TEXT_LIMIT), createdAt: timestamp,
}).strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatTextSchema = z.string().trim().min(1).max(CHAT_TEXT_LIMIT)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
export const socialClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), protocol: z.literal(SOCIAL_PROTOCOL), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    characterId: z.uuid(), cloudRevision: revisionSchema, presence: presenceSchema,
    pendingBattleId: z.uuid().nullable().default(null) }).strict(),
  z.object({ type: z.literal('presence'), presence: presenceSchema }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
  z.object({ type: z.literal('history'), requestId, before: messageId.optional(), after: messageId.optional() }).strict()
    .refine(value => !(value.before && value.after)),
  z.object({ type: z.literal('chat'), requestId, text: chatTextSchema }).strict(),
  z.object({ type: z.literal('interaction'), requestId, action: snapshotInteractionIdSchema, target: publicPlayerIdSchema,
    fresh: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('interaction-reply'), requestId, data: z.unknown() }).strict(),
  z.object({ type: z.literal('moderate'), requestId, action: z.enum(['delete', 'mute', 'unmute']),
    messageId: messageId.optional(), target: publicPlayerIdSchema.optional(),
    minutes: z.number().int().min(1).max(10080).optional() }).strict(),
]);
export type SocialClientMessage = z.infer<typeof socialClientMessageSchema>;
export const socialServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), playerId: publicPlayerIdSchema, moderator: z.boolean(),
    pvp: pvpStateSchema.default(EMPTY_PVP) }).strict(),
  z.object({ type: z.literal('nearby'), players: z.array(nearbyPlayerSchema).max(1000) }).strict(),
  z.object({ type: z.literal('chat'), message: chatMessageSchema }).strict(),
  z.object({ type: z.literal('deleted'), id: messageId }).strict(),
  z.object({ type: z.literal('muted'), until: timestamp }).strict(),
  z.object({ type: z.literal('pong') }).strict(),
  z.object({ type: z.literal('interaction-request'), requestId, action: snapshotInteractionIdSchema }).strict(),
  z.object({ type: z.literal('pvp-prepare'), battleId: z.uuid() }).strict(),
  z.object({ type: z.literal('pvp-state'), state: pvpStateSchema, battleId: z.uuid().optional() }).strict(),
  z.object({ type: z.literal('result'), requestId, data: z.unknown() }).strict(),
  z.object({ type: z.literal('error'), requestId: requestId.optional(), message: z.string().max(300) }).strict(),
  z.object({ type: z.literal('displaced') }).strict(),
]);
export type SocialServerMessage = z.infer<typeof socialServerMessageSchema>;
export const chatHistorySchema = z.object({
  messages: z.array(chatMessageSchema).max(CHAT_PAGE_SIZE), hasMore: z.boolean(),
}).strict();
export const chatReceiptSchema = z.object({ id: messageId, deleted: z.boolean() }).strict();
export const profileResultSchema = z.object({
  player: nearbyPlayerSchema, character: publicCharacterSchema, capturedAt: timestamp,
}).strict();
export type PublicPlayerInfo = z.infer<typeof profileResultSchema>;
