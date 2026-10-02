import { z } from 'zod';
import { clientSaveSchema, revisionSchema } from './client-save';
import { instanceSchema } from '../core/prototype/equipment';
import { countSchema, nonnegativeSchema, simulationSchema, sourceSchema, statsSchema } from '../core/prototype/types';
import { playerAvatarUrlSchema } from './player-profile';

export const PVP_RULES = {
  notorietyPerWin: 1, redThreshold: 3, modeCooldownMs: 5000, attackCooldownMs: 10_000,
  defeatProtectionMs: 30_000, preparationMs: 10_000, settlementMs: 150_000, combatLimitMs: 120_000,
} as const;
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const pvpStateSchema = z.object({
  enabled: z.boolean(), notoriety: z.number().int().min(0).max(1_000_000),
  red: z.boolean(), busy: z.boolean(), modeAfter: time, attackAfter: time, protectedUntil: time,
}).strict();
export type PvpState = z.infer<typeof pvpStateSchema>;
export const EMPTY_PVP: PvpState = {
  enabled: false, notoriety: 0, red: false, busy: false, modeAfter: 0, attackAfter: 0, protectedUntil: 0,
};
export const pvpCheckpointSchema = z.object({ baseRevision: revisionSchema, save: clientSaveSchema }).strict();
export const pvpStartSchema = pvpCheckpointSchema.extend({
  battleId: z.uuid(), target: z.string().regex(/^[a-f0-9]{32}$/),
}).strict();
export const pvpJoinSchema = pvpCheckpointSchema.extend({ battleId: z.uuid() }).strict();
export const pvpFighterSchema = z.object({
  name: z.string().min(1).max(128), realmName: z.string().max(100).default(''),
  avatarUrl: playerAvatarUrlSchema.default(null), hp: nonnegativeSchema, base: statsSchema,
  sources: z.array(sourceSchema).max(100), basicAttackOrdinal: countSchema,
  effects: z.array(z.object({
    id: z.string(), remainingMs: time, source: sourceSchema,
  }).strict()).max(100),
}).strict();
export type PvpFighter = z.infer<typeof pvpFighterSchema>;
export const pvpBattleSchema = z.object({
  battleId: z.uuid(), seed: z.number().int().min(1).max(0xffffffff), expiresAt: time,
  attacker: pvpFighterSchema, defender: pvpFighterSchema,
}).strict();
export type PvpBattleInfo = z.infer<typeof pvpBattleSchema>;
export const pvpCombatSchema = z.object({ attacker: simulationSchema, defender: simulationSchema }).strict();
export const pvpOutcomeSchema = z.object({
  winner: z.enum(['attacker', 'defender']), attackerHp: nonnegativeSchema, defenderHp: nonnegativeSchema,
  elapsedMs: z.number().int().min(0).max(PVP_RULES.combatLimitMs),
  timedOut: z.boolean(),
}).strict();
export type PvpOutcome = z.infer<typeof pvpOutcomeSchema>;
export const pvpFinishSchema = z.object({ battleId: z.uuid(), outcome: pvpOutcomeSchema }).strict();
export const pvpLossSchema = z.object({
  uid: z.string().regex(/^item-[1-9]\d*$/),
  slot: z.enum(['weapon', 'head', 'body', 'legs', 'feet', 'accessory', 'artifact', 'special']),
  instance: instanceSchema,
}).strict();
export const pvpReceiptSchema = z.object({
  battleId: z.uuid(), characterId: z.uuid(), status: z.enum(['settled', 'cancelled']),
  baseRevision: revisionSchema, revision: revisionSchema, tradeRevision: revisionSchema,
  life: countSchema, checkpointClockMs: time, playedMs: time, settledAt: time,
  opponent: z.string().max(128), won: z.boolean(), hp: nonnegativeSchema,
  lost: pvpLossSchema.nullable(), gained: instanceSchema.nullable(), state: pvpStateSchema,
  message: z.string().max(500), requiresRecovery: z.boolean().default(false),
}).strict();
export type PvpReceipt = z.infer<typeof pvpReceiptSchema>;
export const pvpStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unknown') }).strict(),
  z.object({ status: z.literal('pending'), expiresAt: time }).strict(),
  z.object({ status: z.literal('active'), battle: pvpBattleSchema.nullable() }).strict(),
  z.object({ status: z.literal('finished'), receipt: pvpReceiptSchema }).strict(),
]);
export type PvpStatus = z.infer<typeof pvpStatusSchema>;
export const pendingPvpSchema = z.object({
  battleId: z.uuid(), role: z.enum(['attacker', 'defender']), target: z.string().nullable(),
  baseRevision: revisionSchema, outcome: pvpOutcomeSchema.nullable().default(null),
  battle: pvpBattleSchema.nullable().default(null), combat: pvpCombatSchema.nullable().default(null),
}).strict();
export type PendingPvp = z.infer<typeof pendingPvpSchema>;
export const pvpOverviewSchema = z.object({
  state: pvpStateSchema, battleId: z.uuid().nullable(), serverTime: time,
}).strict();
